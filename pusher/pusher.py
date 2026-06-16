"""
arduino_pusher — reads serial port and pushes data to the cloud backend.
Runs on your local PC today; drop it on a Raspberry Pi for production.

Config via environment variables (or a .env file):
  SERIAL_PORT   COM3          (Windows) or /dev/ttyUSB0 (Linux/RPi)
  CLOUD_URL     https://your-app.railway.app
  DEVICE_ID     pH_DO_1
  API_KEY       same key set in Railway env vars
  POLL_INTERVAL 2             seconds between command polls
"""

import json
import os
import time

import requests
import serial
from dotenv import load_dotenv

load_dotenv()

SERIAL_PORT   = os.getenv("SERIAL_PORT",   "COM3")
CLOUD_URL     = os.getenv("CLOUD_URL",     "http://localhost:8000")
DEVICE_ID     = os.getenv("DEVICE_ID",     "pH_DO_1")
API_KEY       = os.getenv("API_KEY",       "")
POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "2"))

HEADERS = {"x-api-key": API_KEY, "Content-Type": "application/json"}


def ingest(data: dict):
    try:
        r = requests.post(
            f"{CLOUD_URL}/api/ingest",
            json=data,
            headers=HEADERS,
            timeout=5,
        )
        r.raise_for_status()
    except Exception as e:
        print(f"[push] error: {e}")


def fetch_commands() -> list[str]:
    try:
        r = requests.get(
            f"{CLOUD_URL}/api/command/pending",
            params={"device_id": DEVICE_ID},
            headers=HEADERS,
            timeout=5,
        )
        return [c["cmd"] for c in r.json()]
    except Exception:
        return []


def run():
    last_poll = 0.0
    print(f"[pusher] {DEVICE_ID} → {CLOUD_URL}  (port: {SERIAL_PORT})")

    while True:
        try:
            ser = serial.Serial(SERIAL_PORT, 9600, timeout=2)
            print(f"[pusher] connected to {SERIAL_PORT}")

            while True:
                raw = ser.readline().decode("utf-8", errors="ignore").strip()
                if raw.startswith("{"):
                    try:
                        data = json.loads(raw)
                        if "event" not in data:
                            data["id"] = DEVICE_ID
                            ingest(data)
                            print(f"[push] {data}")
                    except json.JSONDecodeError:
                        pass

                now = time.time()
                if now - last_poll >= POLL_INTERVAL:
                    last_poll = now
                    for cmd in fetch_commands():
                        print(f"[cmd]  → {cmd}")
                        ser.write((cmd + "\n").encode())

        except Exception as e:
            print(f"[pusher] {e} — retrying in 5s")
            time.sleep(5)


if __name__ == "__main__":
    run()
