# CLAUDE.md — Algae Monitor

Contexto para agentes IA que trabajen en este repositorio.

## ¿Qué hace este sistema?

Monitor de calidad de agua en tiempo real para cultivos de algas marinas.
Mide pH, oxígeno disuelto (DO) y temperatura vía Arduino Uno + sensores DFRobot Gravity + MAX6675.
Los datos fluyen: Arduino → pusher (serial→HTTP) → FastAPI backend → WebSocket → dashboard React.

---

## Hardware físico (no tocar en código sin verificar primero)

| Sensor | Modelo | Pin Arduino |
|---|---|---|
| pH | DFRobot SEN0161-V2 + electrodo H-101 (BNC) | A0 |
| DO | DFRobot SEN0237 | A1 |
| Temperatura | MAX6675 + termocouple K | D13=SCK, D10=CS, D12=SO |

Puerto serial: **COM3** en Windows, `/dev/ttyUSB0` en Linux/RPi.
Baud rate: **9600**.
Device ID: `pH_DO_1`.

---

## Estructura de archivos clave

```
arduino/algae_monitor/algae_monitor.ino   — sketch principal
backend/main.py                           — FastAPI (SQLite, WebSocket, command queue)
pusher/pusher.py                          — bridge serial ↔ HTTP
frontend/src/App.jsx                      — dashboard React (componente único)
pusher/.env                               — config local (gitignored)
frontend/.env                             — config local (gitignored)
```

---

## Reglas críticas del sketch Arduino

### 1. `strupr()` y strings mutables

La librería `DFRobot_PH v1.0.0` llama internamente `strupr(cmd)` en `calibration()`.
`strupr()` requiere un buffer mutable — NO funciona con string literals (`const char*`).

**Correcto:**
```cpp
char enter[] = "ENTERPH";
char cal[]   = "CALPH";
char ex[]    = "EXITPH";
ph.calibration(v, temperature, enter);
ph.calibration(v, temperature, cal);
ph.calibration(v, temperature, ex);
```

**Incorrecto (calibración silenciosa — no escribe en EEPROM):**
```cpp
ph.calibration(v, temperature, "enterph");  // strupr sobre literal = UB
```

### 2. Filtro de temperatura

El filtro es `5.0 < tRead < 60.0` (no `−10..100`).
Razón: con MISO (D12) flotante y MAX6675 desconectado, `readCelsius()` devuelve `0.0°C` exacto, que pasa el filtro amplio. A 0°C la tabla DO_Table devuelve 14460 µg/L → DO falso de ~14.4 mg/L.

### 3. EEPROM layout

| Bytes | Dato |
|---|---|
| 0–3 | `neutralVoltage` (pH 7) — float |
| 4–7 | `acidVoltage` (pH 4) — float |
| 40–43 | `doCalVoltage` — float |

`RESETCAL` escribe `0xFF` en bytes 0–39 y reinicializa doCalVoltage a 1600.0.

### 4. Comandos seriales

Cada línea que llega por serial es un comando. El sketch procesa con `Serial.readStringUntil('\n')`.

| Comando | Acción |
|---|---|
| `CAL7` | Ciclo completo: enterph + calph + exitph para buffer pH 7 |
| `CAL4` | Ciclo completo para buffer pH 4 |
| `RESETCAL` | Borra EEPROM bytes 0–43 |
| `DOCAL` | Guarda voltaje actual DO como referencia de aire |
| `TEMP:xx.x` | Setea temperatura manualmente |
| `ENTERPH` / `CALPH` / `EXITPH` | Comandos legacy (obsoletos, conservar por compatibilidad) |

### 5. Salida JSON

```json
{"id":"pH_DO_1","pH":7.02,"DO":8.23,"temp":23.5,"tc":23.5,"ts":12000}
```

Los JSONs de **evento** llevan el campo `"event"` en lugar de `"pH"/"DO"/"temp"`:
```json
{"event":"PH_CAL_DONE","id":"pH_DO_1","msg":"pH 7 (1437mV) pH=7.00"}
```

El pusher distingue ambos tipos y los enruta a endpoints distintos del backend.

---

## Backend (FastAPI)

**Endpoints que NO se deben romper:**

- `POST /api/ingest` — llamado por el pusher cada segundo
- `GET /api/command/pending?device_id=pH_DO_1` — polling del pusher
- `POST /api/event` — recibe eventos de calibración, hace broadcast WS
- `WebSocket /ws` — dashboard se conecta aquí

**Auth:** `x-api-key` header. En desarrollo local la clave está vacía (no se valida). En producción se setea en Railway env vars.

**Base de datos:** SQLite (`readings.db`). No hay migraciones automáticas — `init_db()` crea las tablas en startup con `CREATE TABLE IF NOT EXISTS`.

---

## Pusher (`pusher/pusher.py`)

Lee serial línea a línea. Si la línea es JSON válido:
- **Sin campo `"event"`** → llama `ingest()` → `POST /api/ingest`
- **Con campo `"event"`** → llama `forward_event()` → `POST /api/event`

El pusher también hace polling a `GET /api/command/pending` cada `POLL_INTERVAL` segundos y escribe los comandos pendientes al serial.

**Reinicio del Arduino:** cada vez que el pusher abre el puerto serial, el DTR togglea y el Arduino se reinicia. La calibración sobrevive porque está en EEPROM.

---

## Frontend (`frontend/src/App.jsx`)

Componente único `App`. Flujo de datos:
1. WebSocket a `ws://{VITE_API_URL}/ws` para lecturas en tiempo real
2. `GET /api/latest` al montar para datos iniciales
3. `POST /api/command` cuando el usuario presiona un botón de calibración

Los eventos de calibración llegan por WebSocket con `data.event` (campo `"event"` presente) y se muestran en el EventLog:
```jsx
if (data.event) {
  addLog(`[Arduino] ${data.event}${data.msg ? ': ' + data.msg : ''}`);
  return;
}
```

**Botones de calibración actuales:**
- Borrar EEPROM → `RESETCAL`
- Calibrar pH 7 → `CAL7`
- Calibrar pH 4 → `CAL4`
- Cal. oxígeno → `DOCAL`

---

## Gotchas frecuentes

| Síntoma | Causa raíz | Fix |
|---|---|---|
| pH muestra −12 | BNC suelto del board Gravity | Re-sentar BNC firmemente |
| DO ~14.4 mg/L constante | Temperatura leyendo 0°C (MISO D12 flotante) | Conectar MAX6675 o desconectar TODOS sus cables |
| Calibración sin efecto | `strupr()` sobre literal string (ver §1 arriba) | Usar `char[]` mutable siempre |
| Temperatura stuck 25.0°C | MAX6675 no conectado, usa fallback | Verificar GND + VCC + señales del MAX6675 |
| Lecturas locas al conectar MAX6675 | Backpowering vía pines SPI sin VCC/GND | Conectar GND y VCC primero |

---

## Comandos útiles para desarrollo

```bash
# Levantar todo en local (3 terminales separadas):
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
cd pusher  && python pusher.py
cd frontend && npm run dev

# Compilar y cargar sketch:
arduino-cli compile --fqbn arduino:avr:uno arduino/algae_monitor/
arduino-cli upload  --fqbn arduino:avr:uno --port COM3 arduino/algae_monitor/

# Ver serial del Arduino:
arduino-cli monitor --port COM3 --config baudrate=9600

# Liberar COM3 si MSI Center lo bloquea (Windows):
powershell -ExecutionPolicy Bypass -File free_com3.ps1

# Enviar un comando manual al Arduino via backend:
curl -X POST http://localhost:8000/api/command \
  -H "Content-Type: application/json" \
  -d '{"cmd":"CAL7","device_id":"pH_DO_1"}'
```
