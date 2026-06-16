# Algae Monitor

Monitor de calidad de agua en tiempo real para cultivos de algas marinas.
Mide pH, oxígeno disuelto (DO) y temperatura. Dashboard web accesible desde cualquier dispositivo.

## Estado actual

| Componente | Estado | Dónde corre |
|---|---|---|
| Arduino Uno + sensor H-101 (pH/DO/temp) | Funcionando en COM3 | Hardware local |
| `pusher/pusher.py` | Listo para usar | PC local / Raspberry Pi |
| `backend/` FastAPI | **Pendiente deploy** | Railway (cloud) |
| `frontend/` React dashboard | Live en GitHub Pages | [ver dashboard](https://camiloarteaga.github.io/Sensores-Ph-od/) |

> El backend aún no está en Railway — ver `docs/deploy-railway.md` para completar el deploy.

## Arquitectura

```
Arduino (COM3 / /dev/ttyUSB0)
    ↓  serial JSON
pusher/pusher.py  ←── corre en PC hoy, en Raspberry Pi en producción
    ↓  POST /api/ingest  (con API_KEY)
Railway — FastAPI backend  ←── siempre encendido, URL fija
    ↓  SQLite (histórico en memoria de proceso / volumen Railway)
    ↑  WebSocket /ws  +  GET /api/latest  +  GET /api/history
GitHub Pages — React dashboard  ←── cualquiera lo abre en el browser
```

Comandos de calibración (ENTERPH / CALPH / EXITPH) van por la ruta inversa:
dashboard → POST /api/command → queue en DB → pusher los recoge con GET /api/command/pending → escribe al serial del Arduino.

## Estructura del repo

```
algae-monitor/
├── arduino/          sketch Arduino (DFRobot_PH + DO sensor)
├── backend/          FastAPI cloud — deploy en Railway
│   ├── main.py
│   ├── requirements.txt
│   └── railway.toml
├── pusher/           script local — corre en PC/RPi, lee serial y envía al backend
│   ├── pusher.py
│   ├── requirements.txt
│   └── .env.example  ← copiar a .env y rellenar
├── frontend/         React + Tailwind v4 + Framer Motion — deploy en GitHub Pages
├── free_com3.ps1     mata MSI Center si bloquea COM3 (Windows)
└── start_tunnel.sh   legacy — solo necesario sin Railway
```

## Quick start (desarrollo local)

```bash
# 1. Backend local (mientras no esté en Railway)
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000

# 2. Pusher (apunta a localhost en dev)
cd pusher
cp .env.example .env
# editar .env: CLOUD_URL=http://localhost:8000, SERIAL_PORT=COM3
pip install -r requirements.txt
python pusher.py

# 3. Frontend
cd frontend
npm install
npm run dev
```

## Sensores

| Sensor | Modelo | Device ID | Puerto |
|---|---|---|---|
| pH + DO + Temp | DFRobot / HAOSHI H-101 | `pH_DO_1` | COM3 (Windows) / `/dev/ttyUSB0` (RPi) |

### Calibración pH (DFRobot_PH library)

Desde el dashboard → botones de calibración, o via curl:

```bash
BASE=https://tu-app.railway.app

# 1. Sumergir electrodo en buffer pH 7, esperar 5 min
curl -X POST $BASE/api/command -H "Content-Type: application/json" -d '{"cmd":"ENTERPH"}'
# cuando se estabilice:
curl -X POST $BASE/api/command -H "Content-Type: application/json" -d '{"cmd":"CALPH"}'

# 2. (opcional) buffer pH 4
curl -X POST $BASE/api/command -H "Content-Type: application/json" -d '{"cmd":"CALPH"}'

# 3. Guardar a EEPROM
curl -X POST $BASE/api/command -H "Content-Type: application/json" -d '{"cmd":"EXITPH"}'
```

La calibración se guarda en EEPROM del Arduino — sobrevive reinicios de poder.

## Documentación adicional

- `docs/deploy-railway.md` — cómo deployar el backend en Railway
- `docs/migration-v2.md` — roadmap: Raspberry Pi + Supabase + nuevo repo
