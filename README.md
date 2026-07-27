# Algae Monitor

Monitor de calidad de agua en tiempo real para cultivos de algas marinas.
Mide **pH**, **oxígeno disuelto (DO)** y **temperatura**. Dashboard web accesible desde cualquier dispositivo en la red local.

---

## Hardware

Hay **dos unidades físicas idénticas** funcionando en paralelo (mismos sensores, mismo pinout, mismo firmware base) — la tabla de identidad más abajo explica cómo distinguirlas.

### Componentes (por unidad)

| Componente | Modelo | Función |
|---|---|---|
| Microcontrolador | Arduino Uno | Lectura de sensores y comunicación serial |
| Sensor pH | DFRobot Gravity pH board V2 (SEN0161-V2) + electrodo H-101 (BNC) | Mide pH del agua |
| Sensor DO | DFRobot Gravity DO board (SEN0237) + electrodo DO | Mide oxígeno disuelto en mg/L |
| Sensor temperatura | MAX6675 + termocouple tipo K | Mide temperatura del agua en °C |
| Puente WiFi | Módulo ESP8266MOD + regulador LM1117T (3.3V), en shield PCB propio "CL-001" apilado sobre el Arduino | Sube lecturas a Supabase y sirve la web de calibración, sin depender de una PC |

### Conexiones — sensores → Arduino (igual en ambas unidades)

| Sensor / Módulo | Pin del módulo | Pin Arduino | Notas |
|---|---|---|---|
| pH board (SEN0161-V2) | Analog out | **A0** | El BNC del electrodo debe quedar bien apretado en el board — si se suelta, el pH cae a −12 |
| DO board (SEN0237) | Analog out | **A1** | |
| pH board | VCC / GND | 5V / GND | |
| DO board | VCC / GND | 5V / GND | |
| MAX6675 | SCK | **D13** | SPI clock |
| MAX6675 | CS | **D10** | Chip select |
| MAX6675 | SO (MISO) | **D9** | Data out — originalmente D12, movido por daño físico de otro pin (ver nota D3 abajo) |
| MAX6675 | VCC / GND | 5V / GND | Conectar VCC+GND **antes** que los pines de señal (evita backpowering) |

> **Importante MAX6675:** conectar siempre GND y VCC antes que SCK/CS/SO. Si se desconecta dejando los pines de señal flotantes, MISO puede hacer que `readCelsius()` devuelva 0.0°C, lo que corrompe el cálculo de DO (sube a ~14 mg/L falso). Filtro de temperatura en el sketch: `5.0 < T < 60.0`.

### Conexiones — Arduino ↔ ESP8266 (enlace bidireccional, igual en ambas unidades)

| Extremo Arduino | → | Extremo ESP8266 | Sentido | Notas |
|---|---|---|---|---|
| **D5** (TX) | → divisor 1kΩ/2.2kΩ → | **D7** / GPIO13 (RX) | Arduino habla, ESP escucha | El divisor es obligatorio: el Arduino es 5V y el ESP es 3.3V |
| **D2** (RX) | ← | **D6** / GPIO12 (TX) | ESP habla, Arduino escucha | Sin divisor — el Arduino ya lee 3.3V como HIGH válido |
| GND | — | GND | común | |

> El plan original usaba D2/D3 del Arduino para este enlace, pero **D3 se dañó físicamente** y se movió a D5 — el pinout real y vigente es D2(RX)/D5(TX) del lado Arduino.

### Identidad de cada unidad — cómo distinguirlas y a dónde suben sus datos

| | **Unidad 1** | **Unidad 2** |
|---|---|---|
| Sketch Arduino | `arduino/algae_monitor/algae_monitor.ino` | `arduino/algae_monitor_2/algae_monitor_2.ino` |
| `device_id` (columna en Supabase) | `pH_DO_1` | `pH_DO_2` |
| Sketch del puente ESP8266 | `arduino/esp8266_bridge/esp8266_bridge.ino` | `arduino/esp8266_bridge_2/esp8266_bridge_2.ino` |
| Web de calibración / config WiFi | `http://algae.local` | `http://algae2.local` |
| SSID del portal de configuración WiFi | `AlgaeMonitor-Setup` | `AlgaeMonitor-Setup-2` |
| Tabla Supabase (misma para ambas) | `readings`, filtrado por `device_id` | `readings`, filtrado por `device_id` |

El `device_id` es lo único que distingue las filas de cada unidad en Supabase — lo pone el propio Arduino en el JSON (`"id":"pH_DO_1"` / `"id":"pH_DO_2"`) y el ESP8266 lo traduce a la columna `device_id` al subir (`id→device_id`, `pH→ph`, `DO→do_mgl`, `temp→temperature`). El mDNS y el SSID del portal están separados entre unidades a propósito, para poder tener las dos encendidas al mismo tiempo sin que compitan por el mismo nombre de red.

---

## Arquitectura del sistema

Hay **dos caminos de datos que funcionan en paralelo**:

**Producción (WiFi, sin depender de una PC encendida):**
```
Arduino Uno (pH_DO_1) ──SoftwareSerial (D2/D5, divisor 1k/2.2k)──► ESP8266 (WiFi)
                                                                      │
                                                    cada 1 min ──►  Supabase (Postgres/PostgREST)
                                                                      │
                                                    cada 1 min ◄──  frontend/ (React, lee Supabase directo)
```
El ESP8266 (`arduino/esp8266_bridge/`) también sirve su propia mini-web de calibración en `http://algae.local` (mDNS), con lecturas en vivo a 1 Hz y botones CAL7/CAL4/DOCAL/RESETCAL — independiente de Supabase y del backend.

**Desarrollo local / legacy (por USB):**
```
Arduino Uno (COM3) ──Serial JSON @ 9600 baud──► pusher/pusher.py ──► backend/main.py (FastAPI :8000)
                                                                          │  SQLite + WebSocket /ws
                                                                          ▼
                                                                  frontend/ (dev, lee WS o Supabase)
```
El backend puede además reenviar cada lectura a Supabase si se configuran `SUPABASE_URL`/`SUPABASE_KEY` (ver `docs/migration-v2.md`).

**Dos Arduinos independientes en el proyecto**, cada uno con 1 sensor de pH + 1 de DO (no 4 sensores en un solo Arduino): `algae_monitor.ino` (device `pH_DO_1`, el que ya tiene el puente ESP8266) y `algae_monitor_2.ino` (device `pH_DO_2`), mismo pinout A0=pH, A1=DO en ambos.

Shield PCB propio ("CL-001") apilado sobre el Arduino Uno #1, con el ESP8266MOD + regulador **LM1117T** (3.3V) ya soldado y funcionando. Detalle completo del hardware y el pinout en [`docs/pcb-cl-001-hardware.md`](docs/pcb-cl-001-hardware.md).

---

## Stack de software

### Arduino (`arduino/algae_monitor/algae_monitor.ino`)

**Librerías requeridas** (Arduino IDE → Herramientas → Administrar librerías):
- `MAX6675 library` v1.1.0
- `EEPROM` y `SoftwareSerial` (incluidas en el IDE)

> **Ya no usa `DFRobot_PH`.** La calibración de pH es una recta propia de 2 puntos (ver abajo) — la librería DFRobot asumía un centro fijo en 1500mV y rangos que no calzaban con este board/electrodo.

**Lectura del ADC:** cada muestra de pH/DO promedia 16 lecturas de `analogRead()` para bajar el ruido (`readAnalogMv()`).

**Salida serial** (JSON cada 1 segundo, por USB **y** por SoftwareSerial hacia el ESP8266 al mismo tiempo):
```json
{"id":"pH_DO_1","pH":7.02,"DO":8.23,"temp":23.5,"tc":23.5,"phmv":1502,"domv":1598,"v7":1500,"v4":2032,"ts":12000}
```
- `temp`: temperatura usada para cálculos (del MAX6675 si es válida, sino 25.0°C como fallback)
- `tc`: lectura cruda del MAX6675 (−999 = NaN / desconectado)
- `phmv`/`domv`: voltaje crudo (mV) de pH y DO — los usa la web de calibración del ESP8266
- `v7`/`v4`: voltajes de calibración actuales (buffer 7.0 y 4.0) — para verificar que la calibración esté cargada
- `ts`: millis() desde el último boot

**Calibración de pH — recta de 2 puntos propia:** se guarda el voltaje medido en el buffer 7.0 y en el 4.0, y el pH se calcula por interpolación lineal entre esos dos puntos (`computePH()`). Así funciona con cualquier electrodo, sin asumir un centro fijo.

**Comandos seriales** (llegan por USB o por el ESP8266, se procesan igual):

| Comando | Acción |
|---|---|
| `CAL7` | Guarda el voltaje actual como punto de pH 7.0 |
| `CAL4` | Guarda el voltaje actual como punto de pH 4.0 |
| `RESETCAL` | Borra EEPROM bytes 0–39, resetea pH (7.0→1500mV, 4.0→2032mV) y DO (1600mV) a valores de fábrica |
| `DOCAL` | Guarda voltaje actual del DO como referencia de saturación en aire |
| `TEMP:xx.x` | Setea temperatura manual (ej: `TEMP:22.5`) |

**Eventos de respuesta** (JSON con campo `event`, van por USB y por el ESP8266):
```json
{"event":"PH_CAL_DONE","id":"pH_DO_1","msg":"pH 7 (1502mV) pH=7.00"}
{"event":"CAL_RESET","id":"pH_DO_1","msg":"EEPROM borrada"}
{"event":"DO_CAL","id":"pH_DO_1","v":1612.3}
```

**EEPROM layout:**
- Bytes 0–3: `phCalV7` (voltaje del buffer pH 7.0, float)
- Bytes 4–7: `phCalV4` (voltaje del buffer pH 4.0, float)
- Bytes 40–43: `doCalVoltage`

### ESP8266 (`arduino/esp8266_bridge/esp8266_bridge.ino`)

Puente WiFi entre el Arduino y la nube. Corre en un módulo ESP8266MOD conectado al Arduino por SoftwareSerial (ver pinout en `docs/pcb-cl-001-hardware.md`).

**Librerías requeridas:** `ESP8266WiFi`, `ESP8266WiFiMulti`, `ESP8266HTTPClient`, `ESP8266WebServer`, `ESP8266mDNS`, `WiFiClientSecure`, `ArduinoJson`, `WiFiManager`, `SoftwareSerial`.

**Qué hace:**
1. Se conecta a una de las redes WiFi conocidas (`secrets.h`, gitignorado); si ninguna conecta en 15s, levanta un portal cautivo `AlgaeMonitor-Setup` para agregar una red nueva sin reflashear.
2. Sube la lectura más reciente del Arduino a Supabase (tabla `readings` vía PostgREST) una vez por minuto.
3. Sirve una web de calibración en `http://algae.local` (mDNS) o por IP — lecturas en vivo a 1 Hz (`GET /live`) y botones que reenvían `CAL7`/`CAL4`/`DOCAL`/`RESETCAL` al Arduino (`GET /cmd?c=...`), sin pasar por Supabase ni por el backend.
4. Sirve una página aparte en `/wifi` (enlazada desde la de calibración, pero separada para no mezclar botones) que muestra la red/IP actual y permite forzar el portal `AlgaeMonitor-Setup` a demanda — útil si la red configurada se vuelve inestable, sin esperar a que falle la conexión.

**Archivo `secrets.h` requerido** (no versionado, crear manualmente):
```cpp
struct { const char* ssid; const char* pass; } WIFI_CREDENTIALS[] = {
  {"MiRed", "miPassword"},
};
const char* SUPABASE_HOST = "TU-PROYECTO.supabase.co";
const char* SUPABASE_KEY  = "service_role_key_aqui";  // clave con permiso de INSERT
```

### Backend (`backend/main.py`)

FastAPI + SQLite. Puerto **8000**.

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/ingest` | POST | Recibe lectura del pusher, guarda en SQLite + broadcast WS |
| `/api/latest` | GET | Última lectura por dispositivo |
| `/api/history` | GET | Historial (params: `hours=24`, `device=pH_DO_1`) |
| `/api/command` | POST | Encola un comando `{"cmd":"CAL7","device_id":"pH_DO_1"}` |
| `/api/command/pending` | GET | Pusher consulta comandos pendientes (param: `device_id`) |
| `/api/event` | POST | Recibe eventos de calibración y los broadcast via WS |
| `/ws` | WebSocket | Push de lecturas en tiempo real al dashboard |

### Pusher (`pusher/pusher.py`)

Puente entre el Arduino (serial) y el backend (HTTP). Corre en la PC local con el Arduino conectado (o en una Raspberry Pi en producción).

**Variables de entorno** (crear `pusher/.env`, está en `.gitignore`):
```env
SERIAL_PORT=COM3          # Windows: COM3 | Linux/RPi: /dev/ttyUSB0
CLOUD_URL=http://localhost:8000
DEVICE_ID=pH_DO_1
API_KEY=                  # vacío en local; rellenar si el backend tiene auth
POLL_INTERVAL=1           # segundos entre polls de comandos
```

### Frontend (`frontend/`)

React + Vite + Tailwind CSS + Recharts + Framer Motion.

**Variables de entorno** (crear `frontend/.env`, está en `.gitignore`):
```env
VITE_API_URL=http://localhost:8000
```

---

## Setup en PC nueva

### 1. Clonar el repositorio
```bash
git clone https://github.com/CamiloArteaga/Sensores-Ph-od.git
cd Sensores-Ph-od
```

### 2. Instalar librerías Arduino
Arduino IDE → Herramientas → Administrar librerías:
- `MAX6675 library` (v1.1.0)

Si además vas a compilar el puente ESP8266 (`arduino/esp8266_bridge/`), instalar también: `ESP8266WiFi`, `ESP8266WiFiMulti`, `ESP8266HTTPClient`, `ESP8266WebServer`, `ESP8266mDNS`, `WiFiClientSecure`, `ArduinoJson`, `WiFiManager` (todas vía el gestor de librerías, con soporte de placas ESP8266 instalado).

### 3. Cargar el sketch en el Arduino
```bash
# Con arduino-cli:
arduino-cli compile --fqbn arduino:avr:uno arduino/algae_monitor/
arduino-cli upload  --fqbn arduino:avr:uno --port COM3 arduino/algae_monitor/

# O abrir arduino/algae_monitor/algae_monitor.ino desde el IDE y cargar
```

### 4. Backend
```bash
cd backend
pip install fastapi uvicorn python-dotenv
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 5. Pusher
```bash
cd pusher
pip install pyserial requests python-dotenv

# Crear archivo de configuración (no se commitea):
# Windows:
copy NUL .env & echo SERIAL_PORT=COM3>> .env & echo CLOUD_URL=http://localhost:8000>> .env & echo DEVICE_ID=pH_DO_1>> .env & echo API_KEY=>> .env & echo POLL_INTERVAL=1>> .env
# Linux/Mac:
# cat > .env << EOF
# SERIAL_PORT=/dev/ttyUSB0
# CLOUD_URL=http://localhost:8000
# DEVICE_ID=pH_DO_1
# API_KEY=
# POLL_INTERVAL=1
# EOF

python pusher.py
```

### 6. Frontend
```bash
cd frontend
echo VITE_API_URL=http://localhost:8000 > .env
npm install
npm run dev
# Dashboard: http://localhost:5173/Sensores-Ph-od/
```

---

## Procedimiento de calibración

Se puede calibrar desde **dos lugares equivalentes** (mandan el mismo comando al Arduino): el dashboard React (`/api/command`) o la web del ESP8266 en `http://algae.local` — esta última es más simple para calibrar in-situ desde el celular, sin depender del backend.

### pH

1. **Borrar EEPROM** (opcional, solo si se quiere recalibrar desde cero) — botón "Borrar EEPROM" / "Borrar calibración"
2. **Buffer pH 7** — sumergir el electrodo, esperar a que se estabilice, presionar "Calibrar pH 7" (guarda el voltaje actual como punto de 7.0)
3. **Buffer pH 4** — enjuagar el electrodo, sumergir en buffer 4, esperar, presionar "Calibrar pH 4" (guarda el voltaje actual como punto de 4.0)

No hay un orden estricto obligatorio entre pH 7 y pH 4 (a diferencia de la versión anterior con DFRobot_PH) — cada botón guarda su propio punto de la recta de calibración de forma independiente.

El log de eventos confirma cada paso:
```
[Arduino] PH_CAL_DONE: pH 7 (1502mV) pH=7.00
[Arduino] PH_CAL_DONE: pH 4 (2035mV) pH=4.00
```

La calibración se guarda en EEPROM y sobrevive reinicios del Arduino. Los campos `v7`/`v4` en el JSON de lectura permiten verificar en cualquier momento qué voltajes quedaron guardados.

### DO (oxígeno disuelto)

1. Sacar el electrodo DO del agua y exponerlo al aire por 30 s
2. Presionar "Cal. oxígeno" / "DOCAL"

### Temperatura

No requiere calibración. El MAX6675 con termocouple tipo K es autocalibrante.

---

## Problemas conocidos y soluciones

| Síntoma | Causa | Solución |
|---|---|---|
| pH muestra −12 o valor absurdo | BNC del electrodo suelto del board Gravity | Re-sentar firmemente el conector BNC |
| Temperatura stuck en 25.0°C | MAX6675 desconectado o SPI flotando | Verificar conexiones |
| DO sube a 14+ mg/L | Temperatura leyendo 0°C (MISO flotante con MAX6675 ausente) | Conectar MAX6675 o desconectar TODOS sus cables |
| Arduino resetea al reconectar pusher | DTR toggling al abrir el puerto serial | Normal — la calibración persiste en EEPROM |
| Lecturas erróneas al conectar MAX6675 | Pines SPI activos sin VCC/GND (backpowering) | Conectar GND y VCC antes que SCK/CS/SO |
| ESP8266 no conecta a WiFi | Ninguna red de `secrets.h` disponible | Conectarse al portal cautivo `AlgaeMonitor-Setup` (aparece como red WiFi) y cargar una red nueva sin reflashear |
| `http://algae.local` no resuelve | mDNS bloqueado por el router/red (común en redes corporativas o de universidad) | Usar la IP directa del ESP8266 (se imprime por Serial al bootear) |
| Frontend no muestra datos nuevos | Lee Supabase cada 60s — el ESP8266 también sube cada 60s | Esperar hasta 2 minutos; si sigue sin datos, revisar `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` en `frontend/.env` |

---

## Estructura del repositorio

```
Sensores-Ph-od/
├── arduino/
│   ├── algae_monitor/
│   │   └── algae_monitor.ino      # Sketch Arduino #1 (pH_DO_1) — pH+DO+Temp, habla con el ESP8266
│   ├── algae_monitor_2/
│   │   └── algae_monitor_2.ino    # Sketch Arduino #2 (pH_DO_2) — mismo firmware que #1
│   ├── esp8266_bridge/
│   │   ├── esp8266_bridge.ino     # Puente WiFi unidad 1: Supabase + web calibración (algae.local)
│   │   └── secrets.h              # WiFi + Supabase credentials (gitignored, crear manualmente)
│   └── esp8266_bridge_2/
│       ├── esp8266_bridge_2.ino   # Puente WiFi unidad 2: mismo código, mDNS algae2.local
│       └── secrets.h              # WiFi + Supabase credentials (gitignored, crear manualmente)
├── backend/
│   ├── main.py                    # FastAPI app (push opcional a Supabase)
│   ├── requirements.txt
│   └── readings.db                # SQLite (generado al correr)
├── pusher/
│   ├── pusher.py                  # Bridge serial ↔ backend (camino legacy/local)
│   ├── requirements.txt
│   └── .env                       # Config local (gitignored)
├── frontend/
│   ├── src/
│   │   └── App.jsx                # Dashboard React — lee Supabase directo cada 60s
│   ├── .env                       # Config local (gitignored) — incluye VITE_SUPABASE_URL/ANON_KEY
│   ├── .env.example
│   └── package.json
├── docs/
│   ├── pcb-cl-001-hardware.md     # Shield PCB CL-001 + puente WiFi ESP8266 (funcionando)
│   ├── deploy-railway.md          # Guía paso a paso deploy backend en Railway
│   └── migration-v2.md            # Plan de migración a Raspberry Pi + Supabase
├── CLAUDE.md                      # Contexto para agentes IA
├── free_com3.ps1                  # Mata MSI Center si bloquea COM3 (Windows)
└── README.md
```

## Estado actual

| Componente | Estado |
|---|---|
| Arduino #1 (pH_DO_1) + sensores pH/DO/Temp | Funcionando, calibración de 2 puntos propia |
| ESP8266 unidad 1 (`algae.local`) | **Funcionando** — sube a Supabase cada minuto + web de calibración + reconfiguración WiFi a demanda (`/wifi`) |
| Arduino #2 (pH_DO_2) + sensores pH/DO/Temp | Funcionando, mismo firmware que #1 |
| ESP8266 unidad 2 (`algae2.local`) | Flasheado y probado; pendiente de verificar en la instalación final |
| `pusher/pusher.py` + backend + WebSocket | Camino de desarrollo local, funcional |
| `frontend/` React dashboard | Lee directo de Supabase cada 60s (producción) — GitHub Pages |
| Deploy del backend en Railway | Documentado en `docs/deploy-railway.md`, no es indispensable ya que el camino de producción actual no depende del backend |
| Migración a Raspberry Pi (Fase 2, `docs/migration-v2.md`) | Parcialmente superada — el ESP8266 ya resuelve la conectividad 24/7 sin depender de una PC ni de una RPi |
