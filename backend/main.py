import serial
import serial.tools.list_ports
import json
import sqlite3
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB_PATH = "readings.db"

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS readings (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp   TEXT    NOT NULL,
                device_id   TEXT,
                ph          REAL,
                do_mgl      REAL,
                temperature REAL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON readings(timestamp)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dev ON readings(device_id)")

# ──────────────────────────────────────────────────────────
# State — keyed by device id so multiple Arduinos work
# ──────────────────────────────────────────────────────────

latest: dict[str, dict] = {}       # {"pH_DO": {...}, "pH2": {...}}
active_ws: list[WebSocket] = []
arduinos: dict[str, serial.Serial] = {}   # port → Serial obj

def find_arduino_ports() -> list[str]:
    ports = []
    for p in serial.tools.list_ports.comports():
        desc = p.description.lower()
        if any(k in desc for k in ("arduino", "ch340", "ch341", "uart", "usb serial")):
            ports.append(p.device)
    return ports

async def read_port(port: str):
    """One task per Arduino port."""
    global arduinos
    while True:
        try:
            ser = serial.Serial(port, 9600, timeout=2)
            arduinos[port] = ser
            print(f"[serial] Connected to {port}")
            await asyncio.sleep(2)

            while True:
                raw = await asyncio.to_thread(ser.readline)
                raw = raw.decode("utf-8", errors="ignore").strip()
                if not raw.startswith("{"):
                    continue

                data = json.loads(raw)
                if "event" in data:
                    continue                         # skip calibration events
                data["timestamp"] = datetime.now().isoformat()
                device_id = data.get("id", "unknown")
                latest[device_id] = data

                with sqlite3.connect(DB_PATH) as conn:
                    conn.execute(
                        "INSERT INTO readings (timestamp, device_id, ph, do_mgl, temperature) VALUES (?,?,?,?,?)",
                        (data["timestamp"], device_id, data.get("pH"), data.get("DO"), data.get("temp")),
                    )

                for ws in active_ws[:]:
                    try:
                        await ws.send_json(data)
                    except Exception:
                        active_ws.remove(ws)

        except Exception as e:
            print(f"[serial] {port} error: {e} — retrying in 5s")
            if port in arduinos:
                try: arduinos[port].close()
                except: pass
                del arduinos[port]
            await asyncio.sleep(5)

async def port_watcher():
    """Spawns a read_port task for each Arduino found. Polls for new ones."""
    running: set[str] = set()
    while True:
        for port in find_arduino_ports():
            if port not in running:
                running.add(port)
                asyncio.create_task(read_port(port))
        await asyncio.sleep(10)

# ──────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    asyncio.create_task(port_watcher())
    yield

app = FastAPI(title="Algae Monitor API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/latest")
def get_latest():
    return latest or {"status": "no_data"}


@app.get("/api/history")
def get_history(hours: int = 24, device: str | None = None):
    with sqlite3.connect(DB_PATH) as conn:
        if device:
            rows = conn.execute(
                "SELECT timestamp, device_id, ph, do_mgl, temperature FROM readings WHERE timestamp > datetime('now',?) AND device_id=? ORDER BY timestamp",
                (f"-{hours} hours", device),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT timestamp, device_id, ph, do_mgl, temperature FROM readings WHERE timestamp > datetime('now',?) ORDER BY timestamp",
                (f"-{hours} hours",),
            ).fetchall()
    return [{"timestamp": r[0], "id": r[1], "pH": r[2], "DO": r[3], "temp": r[4]} for r in rows]


@app.get("/api/status")
def get_status():
    return {
        "connected_ports": list(arduinos.keys()),
        "devices": list(latest.keys()),
        "last_readings": {k: v.get("timestamp") for k, v in latest.items()},
    }


class CommandBody(BaseModel):
    cmd: str
    port: str | None = None   # optional: target specific port

@app.post("/api/command")
def send_command(body: CommandBody):
    targets = [arduinos[body.port]] if body.port and body.port in arduinos else list(arduinos.values())
    if not targets:
        return {"error": "No Arduino connected"}
    for ser in targets:
        if ser.is_open:
            ser.write((body.cmd + "\n").encode())
    return {"sent": body.cmd, "to": [s.port for s in targets]}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    active_ws.append(ws)
    for data in latest.values():
        await ws.send_json(data)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in active_ws:
            active_ws.remove(ws)
