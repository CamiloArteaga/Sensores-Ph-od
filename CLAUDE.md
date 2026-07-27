# CLAUDE.md — Algae Monitor

Contexto para agentes IA que trabajen en este repositorio.

## ¿Qué hace este sistema?

Monitor de calidad de agua en tiempo real para cultivos de algas marinas.
Mide pH, oxígeno disuelto (DO) y temperatura vía Arduino Uno + sensores DFRobot Gravity + MAX6675.

**Dos caminos de datos en paralelo:**
- **Producción (WiFi):** Arduino → ESP8266 (`arduino/esp8266_bridge/`) → sube a Supabase cada 60s → frontend lee Supabase directo cada 60s. No depende de una PC encendida.
- **Legacy/desarrollo local (USB):** Arduino → `pusher/pusher.py` (serial→HTTP) → FastAPI backend → WebSocket → dashboard React.

El backend puede opcionalmente reenviar también a Supabase (`SUPABASE_URL`/`SUPABASE_KEY` en su entorno).

**Son 2 Arduinos independientes**, no un solo Arduino con 4 sensores: `arduino/algae_monitor/` (device `pH_DO_1`) y `arduino/algae_monitor_2/` (device `pH_DO_2`), mismo pinout en ambos.

---

## Hardware físico (no tocar en código sin verificar primero)

| Sensor | Modelo | Pin Arduino |
|---|---|---|
| pH | DFRobot SEN0161-V2 + electrodo H-101 (BNC) | A0 |
| DO | DFRobot SEN0237 | A1 |
| Temperatura | MAX6675 + termocouple K | D13=SCK, D10=CS, D9=SO |

Puerto serial: **COM3** en Windows, `/dev/ttyUSB0` en Linux/RPi.
Baud rate: **9600**.
Device IDs: `pH_DO_1` (Arduino #1), `pH_DO_2` (Arduino #2).

**Funcionando:** shield PCB propio "CL-001" (apilado sobre el Arduino Uno #1, saca 5V/3.3V/GND/Vin/A0-A5 por header) + módulo ESP8266MOD WiFi con regulador LM1117T. Ver `docs/pcb-cl-001-hardware.md` antes de tocar el pinout — la conexión Arduino↔ESP ya NO es solo USB/serial, hay un enlace SoftwareSerial permanente en D2/D5.

---

## Estructura de archivos clave

```
arduino/algae_monitor/algae_monitor.ino   — sketch Arduino #1, habla con el ESP8266 por D2/D5
arduino/algae_monitor_2/algae_monitor_2.ino — sketch Arduino #2 (pH_DO_2)
arduino/esp8266_bridge/esp8266_bridge.ino — puente WiFi Arduino #1: Supabase + web de calibración (mDNS `algae.local`, portal `AlgaeMonitor-Setup`)
arduino/esp8266_bridge/secrets.h          — WiFi + Supabase credentials (gitignored)
arduino/esp8266_bridge_2/esp8266_bridge_2.ino — mismo puente para Arduino #2 (mDNS `algae2.local`, portal `AlgaeMonitor-Setup-2`, evita chocar con el #1 si ambos están encendidos)
arduino/esp8266_bridge_2/secrets.h        — WiFi + Supabase credentials del puente #2 (gitignored)
backend/main.py                           — FastAPI (SQLite, WebSocket, command queue, push opcional a Supabase)
pusher/pusher.py                          — bridge serial ↔ HTTP (camino legacy/local)
frontend/src/App.jsx                      — dashboard React — lee Supabase directo (no WebSocket)
pusher/.env                               — config local (gitignored)
frontend/.env                             — config local (gitignored), incluye VITE_SUPABASE_*
docs/pcb-cl-001-hardware.md               — hardware PCB + pinout ESP8266 (fuente de verdad de pines)
docs/deploy-railway.md                    — deploy backend en Railway (opcional, no bloqueante)
docs/migration-v2.md                      — plan de migración a RPi/Supabase (Fase 3 en curso)
```

---

## Reglas críticas del sketch Arduino

### 1. Calibración de pH — recta propia de 2 puntos (NO usa `DFRobot_PH`)

La librería `DFRobot_PH` **fue eliminada** (commit `d49a6bd`). Asumía un centro fijo en 1500mV y rangos que no calzaban con este board/electrodo. El sketch ahora guarda directamente el voltaje medido en buffer 7.0 (`phCalV7`) y en buffer 4.0 (`phCalV4`), e interpola linealmente con `computePH()`:

```cpp
float computePH(float mv) {
  float dv = phCalV4 - phCalV7;
  if (fabs(dv) < 1.0) return -1.0;   // sin calibrar válido
  return 7.0 + (mv - phCalV7) * (4.0 - 7.0) / dv;
}
```

No hay orden obligatorio entre `CAL7` y `CAL4` — cada uno graba su propio punto independientemente. El viejo gotcha de `strupr()` con string literals ya no aplica (no queda código de DFRobot en el repo).

**Promedio de ADC:** toda lectura de pH/DO pasa por `readAnalogMv()`, que promedia 16 muestras de `analogRead()` antes de convertir a mV — reduce ruido pero también significa que una lectura tarda ~16 ciclos de ADC, no instantánea.

### 2. Filtro de temperatura

El filtro es `5.0 < tRead < 60.0` (no `−10..100`).
Razón: con MISO (D9) flotante y MAX6675 desconectado, `readCelsius()` devuelve `0.0°C` exacto, que pasa el filtro amplio. A 0°C la tabla DO_Table devuelve 14460 µg/L → DO falso de ~14.4 mg/L.

### 3. EEPROM layout

| Bytes | Dato |
|---|---|
| 0–3 | `phCalV7` (voltaje del buffer pH 7.0) — float |
| 4–7 | `phCalV4` (voltaje del buffer pH 4.0) — float |
| 40–43 | `doCalVoltage` — float |

`RESETCAL` escribe `0xFF` en bytes 0–39 y reinicializa `phCalV7=1500.0`, `phCalV4=2032.0`, `doCalVoltage=1600.0`.

### 4. Comandos seriales

Cada línea que llega por serial (USB **o** por el ESP8266 vía `espSerial`) es un comando, procesado con `readStringUntil('\n')` en ambos canales por igual.

| Comando | Acción |
|---|---|
| `CAL7` | Guarda el voltaje actual como punto de calibración pH 7.0 |
| `CAL4` | Guarda el voltaje actual como punto de calibración pH 4.0 |
| `RESETCAL` | Borra EEPROM bytes 0–39, resetea pH y DO a valores de fábrica |
| `DOCAL` | Guarda voltaje actual DO como referencia de aire |
| `TEMP:xx.x` | Setea temperatura manualmente |

No hay comandos legacy (`ENTERPH`/`CALPH`/`EXITPH`) — se retiraron junto con `DFRobot_PH`.

### 5. Salida JSON

```json
{"id":"pH_DO_1","pH":7.02,"DO":8.23,"temp":23.5,"tc":23.5,"phmv":1502,"domv":1598,"v7":1500,"v4":2032,"ts":12000}
```

`phmv`/`domv` son los voltajes crudos; `v7`/`v4` son los puntos de calibración actuales — ambos los consume la web de calibración del ESP8266, no solo el dashboard.

Los JSONs de **evento** llevan el campo `"event"` en lugar de `"pH"/"DO"/"temp"`:
```json
{"event":"PH_CAL_DONE","id":"pH_DO_1","msg":"pH 7 (1502mV) pH=7.00"}
```

Cada línea (lectura o evento) se emite **por los dos canales a la vez**: `Serial` (USB, para `pusher.py`) y `espSerial` (SoftwareSerial hacia el ESP8266, para Supabase + web de calibración). El pusher y el ESP8266 distinguen lectura vs. evento por la presencia del campo `"event"`.

---

## ESP8266 (`arduino/esp8266_bridge/esp8266_bridge.ino`)

Puente WiFi — **no reemplaza** a `pusher.py`/backend, es un canal de producción adicional que no depende de una PC encendida.

**Qué hace:**
1. Conecta a WiFi (`WiFiMulti` con redes de `secrets.h`; si ninguna conecta en 15s, portal cautivo `AlgaeMonitor-Setup` vía `WiFiManager` — permite agregar una red sin reflashear).
2. Cada 60s (`UPLOAD_MS`), sube la última lectura del Arduino a Supabase: `POST https://{SUPABASE_HOST}/rest/v1/readings` con headers `apikey`/`Authorization: Bearer` (PostgREST). Traduce campos: `id→device_id`, `pH→ph`, `DO→do_mgl`, `temp→temperature`.
3. Sirve una web de calibración self-contained (HTML/JS inline en `PROGMEM`) en `http://algae.local` (mDNS) o por IP:
   - `GET /` → página HTML (incluye enlace "Configurar WiFi" hacia `/wifi`)
   - `GET /live` → `{"reading":{...},"event":{...}}` (poll cada 1s desde el navegador)
   - `GET /cmd?c=CAL7|CAL4|DOCAL|RESETCAL` → reenvía el comando al Arduino por `arduinoLink` (SoftwareSerial D7/D6 del ESP)
4. Sirve una página separada de configuración WiFi (sin botones de calibración, para evitar toques accidentales):
   - `GET /wifi` → página HTML con la red/IP actual y un botón "Configurar nueva red"
   - `GET /wifi/status` → `{"ssid":"...","ip":"..."}`
   - `GET /wifi/start` → marca una bandera (`wifiPortalRequested`) atendida en `loop()`; ahí se hace `server.close()`, se abre `wm.startConfigPortal("AlgaeMonitor-Setup")` (portal forzado aunque ya esté conectado, con lista de redes escaneadas como un selector de WiFi normal) y al terminar se llama `server.begin()` de nuevo. **El `server.close()`/`server.begin()` es necesario**: sin eso, el portal de WiFiManager compite por el puerto 80 con nuestro propio servidor y la página del portal no carga (se queda cargando indefinidamente).

**`WiFiClientSecure.setInsecure()`** — no valida el certificado TLS de Supabase. Es una decisión consciente (frágil de mantener certificados en un ESP8266), aceptable para datos de sensores no sensibles. No “arreglar” esto sin discutirlo primero — cambiarlo puede romper la subida si no se gestiona la cadena de certificados correctamente.

**`secrets.h`** (gitignored, no existe en el repo — crear manualmente antes de compilar): define `WIFI_CREDENTIALS[]`, `SUPABASE_HOST`, `SUPABASE_KEY` (service_role, con permiso de INSERT en la tabla `readings`).

---

## Backend (FastAPI)

**Endpoints que NO se deben romper:**

- `POST /api/ingest` — llamado por el pusher cada segundo
- `GET /api/command/pending?device_id=pH_DO_1` — polling del pusher
- `POST /api/event` — recibe eventos de calibración, hace broadcast WS
- `WebSocket /ws` — dashboard se conecta aquí

**Auth:** `x-api-key` header. En desarrollo local la clave está vacía (no se valida). En producción se setea en Railway env vars.

**Base de datos:** SQLite (`readings.db`). No hay migraciones automáticas — `init_db()` crea las tablas en startup con `CREATE TABLE IF NOT EXISTS`. Se pierde en cada redeploy de Railway (SQLite no persiste entre deploys) — migración a Supabase planeada, ver `docs/migration-v2.md`.

**Deploy:** guía paso a paso completa en `docs/deploy-railway.md` (Railway root dir = `backend`, variables `API_KEY` y `DB_PATH`, luego actualizar secret `VITE_API_URL` de GitHub Actions). Aún no ejecutado — el backend corre solo en local por ahora.

---

## Pusher (`pusher/pusher.py`)

Lee serial línea a línea. Si la línea es JSON válido:
- **Sin campo `"event"`** → llama `ingest()` → `POST /api/ingest`
- **Con campo `"event"`** → llama `forward_event()` → `POST /api/event`

El pusher también hace polling a `GET /api/command/pending` cada `POLL_INTERVAL` segundos y escribe los comandos pendientes al serial.

**Reinicio del Arduino:** cada vez que el pusher abre el puerto serial, el DTR togglea y el Arduino se reinicia. La calibración sobrevive porque está en EEPROM.

---

## Frontend (`frontend/src/App.jsx`)

Componente único `App`. **Ya no usa WebSocket como fuente principal** — lee directo de Supabase:

1. `fetch` periódico (cada `REFRESH_MS`=60000ms) a `{SUPABASE_URL}/rest/v1/readings` vía PostgREST, con headers `apikey`/`Authorization: Bearer {SUPABASE_ANON_KEY}` (clave `sb_publishable_...`, pública por diseño — RLS de Supabase solo permite SELECT con esa key, el ESP8266 escribe con la `service_role` key que sí es secreta)
2. Primera carga: últimas 1440 filas (`order=timestamp.desc&limit=1440`, se revierte a ascendente). Cargas siguientes: solo filas con `timestamp gt` la última vista (`lastTs`)
3. `setConnected(...)` se deriva de la frescura del dato: `true` si la lectura más reciente tiene menos de 2.5 minutos — no hay conexión persistente que monitorear, es polling
4. `POST /api/command` (al backend FastAPI) sigue existiendo para los botones de calibración del dashboard — **eso sigue yendo por el camino legacy**, no por Supabase. Si el backend no está corriendo, los botones del dashboard no funcionan (usar la web del ESP8266 en su lugar, que si sirve calibración sin el backend)

**Botones de calibración actuales (dashboard):**
- Borrar EEPROM → `RESETCAL`
- Calibrar pH 7 → `CAL7`
- Calibrar pH 4 → `CAL4`
- Cal. oxígeno → `DOCAL`

Variables de entorno nuevas en `frontend/.env` (ver `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## Gotchas frecuentes

| Síntoma | Causa raíz | Fix |
|---|---|---|
| pH muestra −12 | BNC suelto del board Gravity | Re-sentar BNC firmemente |
| DO ~14.4 mg/L constante | Temperatura leyendo 0°C (MISO D12 flotante) | Conectar MAX6675 o desconectar TODOS sus cables |
| Dashboard no calibra pero `algae.local` sí | El backend FastAPI no está corriendo — el dashboard depende de él para `/api/command`, la web del ESP no | Levantar el backend, o calibrar desde `algae.local` directamente |
| Frontend "desconectado" aunque el ESP sí sube datos | `setConnected` exige lectura de menos de 2.5 min; el ESP sube cada 60s — normal que haya un margen | Esperar hasta 2-3 min antes de asumir que algo falla |
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
