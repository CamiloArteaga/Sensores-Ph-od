# Migración v2 — Raspberry Pi + Supabase + nuevo repo

## Objetivo

Pasar de "PC del desarrollador + túnel" a una instalación permanente en las piscinas
que funcione 24/7 sin depender de que nadie tenga su computador encendido.

## Estado al momento de escribir esto (junio 2026)

- [x] Arduino Uno + sensor H-101 (pH, DO, temp) funcionando y calibrado
- [x] Backend FastAPI con arquitectura pusher/cloud separados
- [x] Frontend React en GitHub Pages (dashboard funcional, mobile-ready)
- [x] pusher.py listo — solo cambia SERIAL_PORT en .env para RPi
- [ ] Backend aún no deployado en Railway (pendiente paso a paso en `docs/deploy-railway.md`)
- [ ] Base de datos aún en SQLite (histórico se pierde en redeploy)
- [ ] Raspberry Pi no adquirida todavía

---

## Fase 1 — Deploy inmediato (sin cambiar hardware)

Solo mover el backend a Railway para que el dashboard funcione para cualquiera.
Instrucciones completas en `docs/deploy-railway.md`.

**Resultado:** frontend + backend siempre disponibles. El pusher sigue corriendo en
el PC del desarrollador mientras haya una sesión activa.

---

## Fase 2 — Raspberry Pi en la piscina

### Hardware necesario
- Raspberry Pi 4 (o 3B+) con Raspberry Pi OS Lite
- Cable USB-A → USB-B (Arduino → RPi)
- Alimentación para RPi (adaptador 5V 3A)
- Conexión WiFi o cable Ethernet en la piscina

### Cambios de código
El `pusher.py` corre igual en RPi. Solo cambiar `.env`:

```
SERIAL_PORT=/dev/ttyUSB0    # o /dev/ttyACM0 según el CH340
CLOUD_URL=https://...railway.app
DEVICE_ID=piscina_1
API_KEY=...
```

### Correr pusher como servicio systemd (RPi)

```bash
# /etc/systemd/system/algae-pusher.service
[Unit]
Description=Algae Monitor Pusher
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/algae-monitor/pusher
EnvironmentFile=/home/pi/algae-monitor/pusher/.env
ExecStart=/usr/bin/python3 pusher.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable algae-pusher
sudo systemctl start algae-pusher
```

### Para múltiples piscinas
Cada RPi tiene su propio `.env` con un `DEVICE_ID` distinto (`piscina_1`, `piscina_2`...).
El backend y frontend ya soportan múltiples dispositivos — no hay cambios de código.

---

## Fase 3 — Migración a Supabase

### Por qué
SQLite en Railway pierde datos en cada redeploy. Para históricos largos
(meses de lecturas) se necesita una base de datos persistente.

### Crear proyecto en Supabase
1. [supabase.com](https://supabase.com) → New project
2. Crear tabla `readings`:

```sql
CREATE TABLE readings (
  id          BIGSERIAL PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_id   TEXT,
  ph          FLOAT,
  do_mgl      FLOAT,
  temperature FLOAT
);

CREATE INDEX ON readings(timestamp);
CREATE INDEX ON readings(device_id);
```

### Cambios en backend/main.py

Reemplazar la capa SQLite por el cliente Supabase:

```python
# pip install supabase
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")  # service_role key (no anon)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# En ingest():
supabase.table("readings").insert({
    "timestamp": data["timestamp"],
    "device_id": body.id,
    "ph": body.pH,
    "do_mgl": body.DO,
    "temperature": body.temp,
}).execute()

# En get_history():
result = supabase.table("readings") \
    .select("timestamp, device_id, ph, do_mgl, temperature") \
    .gte("timestamp", cutoff_iso) \
    .execute()
```

Agregar a Railway → Variables:
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=service_role_key_aqui
```

---

## Fase 4 — Nuevo repo

Cuando el proyecto sea lo suficientemente estable para producción, mover a un
repo separado (sin el historial de experimentación de este repo).

### Qué copiar al nuevo repo
- `arduino/` — sketch final (el que esté funcionando)
- `backend/` — main.py con Supabase + railway.toml
- `pusher/` — pusher.py + requirements.txt + .env.example
- `frontend/` — todo
- `docs/` — estos docs actualizados
- `.github/workflows/deploy.yml`

### Qué NO copiar
- `start_tunnel.sh` — ya no se necesita
- `free_com3.ps1` — específico de Windows dev
- `readings.db` — datos locales

### Checklist antes de migrar
- [ ] Backend en Railway estable por al menos 1 semana
- [ ] Pusher corriendo en RPi sin supervisión
- [ ] Supabase con datos históricos acumulando
- [ ] Dashboard probado desde móvil en la piscina
- [ ] Calibración documentada (neutralVoltage, acidVoltage en EEPROM)

---

## Notas técnicas

**¿Por qué Railway y no Heroku/Render?**
Railway da mejor DX y el free tier no pausa el servicio por inactividad
(a diferencia de Render free). Para monitoreo 24/7 es importante que el
backend responda rápido sin cold starts.

**¿Por qué pusher separado y no el backend con serial?**
El serial port (COM3 / /dev/ttyUSB0) es un recurso del OS local. No se puede
abrir remotamente. Al separar el pusher, el backend puede vivir en cualquier
cloud y múltiples dispositivos pueden empujar datos desde múltiples ubicaciones.

**WebSocket en producción**
Railway soporta WebSockets nativamente. La URL `wss://` funciona igual que `ws://`
en desarrollo. El frontend ya usa `.replace(/^http/, "ws")` que convierte
`https://` → `wss://` correctamente.
