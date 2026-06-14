import sqlite3
import asyncio
import os
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB_PATH = os.getenv("DB_PATH", "readings.db")
API_KEY = os.getenv("API_KEY", "")          # set in Railway env vars


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
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ts  ON readings(timestamp)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dev ON readings(device_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS command_queue (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id  TEXT NOT NULL,
                cmd        TEXT NOT NULL,
                created_at TEXT NOT NULL,
                consumed   INTEGER DEFAULT 0
            )
        """)


latest:    dict[str, dict]    = {}
active_ws: list[WebSocket]    = []


def verify_key(x_api_key: str):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Algae Monitor API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Ingest (called by pusher running on PC/RPi) ────────────────────────────

class IngestBody(BaseModel):
    id:   str
    pH:   float | None = None
    DO:   float | None = None
    temp: float | None = None
    ts:   int   | None = None


@app.post("/api/ingest")
async def ingest(body: IngestBody, x_api_key: str = Header(default="")):
    verify_key(x_api_key)
    data = body.model_dump()
    data["timestamp"] = datetime.now().isoformat()
    latest[body.id] = data

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO readings (timestamp, device_id, ph, do_mgl, temperature) VALUES (?,?,?,?,?)",
            (data["timestamp"], body.id, body.pH, body.DO, body.temp),
        )

    for ws in active_ws[:]:
        try:
            await ws.send_json(data)
        except Exception:
            active_ws.remove(ws)

    return {"ok": True}


# ── Public read endpoints ──────────────────────────────────────────────────

@app.get("/api/latest")
def get_latest():
    return latest or {"status": "no_data"}


@app.get("/api/history")
def get_history(hours: int = 24, device: str | None = None):
    with sqlite3.connect(DB_PATH) as conn:
        if device:
            rows = conn.execute(
                "SELECT timestamp, device_id, ph, do_mgl, temperature "
                "FROM readings WHERE timestamp > datetime('now',?) AND device_id=? ORDER BY timestamp",
                (f"-{hours} hours", device),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT timestamp, device_id, ph, do_mgl, temperature "
                "FROM readings WHERE timestamp > datetime('now',?) ORDER BY timestamp",
                (f"-{hours} hours",),
            ).fetchall()
    return [{"timestamp": r[0], "id": r[1], "pH": r[2], "DO": r[3], "temp": r[4]} for r in rows]


@app.get("/api/status")
def get_status():
    return {
        "connected_ports": [],
        "devices": list(latest.keys()),
        "last_readings": {k: v.get("timestamp") for k, v in latest.items()},
    }


# ── Commands (queued for pusher to pick up) ────────────────────────────────

class CommandBody(BaseModel):
    cmd:       str
    device_id: str | None = None


@app.post("/api/command")
def send_command(body: CommandBody):
    device_id = body.device_id or (list(latest.keys())[0] if latest else None)
    if not device_id:
        return {"error": "No device connected"}

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO command_queue (device_id, cmd, created_at) VALUES (?,?,?)",
            (device_id, body.cmd, datetime.now().isoformat()),
        )
    return {"queued": body.cmd, "for": device_id}


@app.get("/api/command/pending")
def get_pending(device_id: str, x_api_key: str = Header(default="")):
    """Pusher polls this to get commands to forward to the Arduino."""
    verify_key(x_api_key)
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, cmd FROM command_queue WHERE device_id=? AND consumed=0 ORDER BY id",
            (device_id,),
        ).fetchall()
        if rows:
            ids = [r[0] for r in rows]
            conn.execute(
                f"UPDATE command_queue SET consumed=1 WHERE id IN ({','.join('?'*len(ids))})",
                ids,
            )
    return [{"id": r[0], "cmd": r[1]} for r in rows]


# ── WebSocket ──────────────────────────────────────────────────────────────

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
