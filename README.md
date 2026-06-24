# Algae Monitor

Monitor de calidad de agua en tiempo real para cultivos de algas marinas.
Mide **pH**, **oxígeno disuelto (DO)** y **temperatura**. Dashboard web accesible desde cualquier dispositivo en la red local.

---

## Hardware

### Componentes

| Componente | Modelo | Función |
|---|---|---|
| Microcontrolador | Arduino Uno | Lectura de sensores y comunicación serial |
| Sensor pH | DFRobot Gravity pH board V2 (SEN0161-V2) + electrodo H-101 (BNC) | Mide pH del agua |
| Sensor DO | DFRobot Gravity DO board (SEN0237) + electrodo DO | Mide oxígeno disuelto en mg/L |
| Sensor temperatura | MAX6675 + termocouple tipo K | Mide temperatura del agua en °C |

### Conexiones (pinout)

| Sensor / Módulo | Pin del módulo | Pin Arduino | Notas |
|---|---|---|---|
| pH board (SEN0161-V2) | Analog out | **A0** | El BNC del electrodo debe quedar bien apretado en el board |
| DO board (SEN0237) | Analog out | **A1** | |
| pH board | VCC | 5V | |
| pH board | GND | GND | |
| DO board | VCC | 5V | |
| DO board | GND | GND | |
| MAX6675 | SCK | **D13** | SPI clock |
| MAX6675 | CS | **D10** | Chip select |
| MAX6675 | SO (MISO) | **D12** | Data out |
| MAX6675 | VCC | 5V | Conectar VCC+GND **antes** que los pines de señal |
| MAX6675 | GND | GND | |

> **Importante MAX6675:** Conectar siempre GND y VCC antes que SCK/CS/SO. Si se conectan señales sin alimentación, el chip se alimenta inversamente a través de los pines SPI y devuelve lecturas erróneas. Si se desconecta dejando los pines de señal flotantes, MISO (D12) puede hacer que `readCelsius()` devuelva 0.0°C, lo que corrompe el cálculo de DO.

---

## Arquitectura del sistema

```
Arduino Uno (COM3 / /dev/ttyUSB0)
   │   Serial JSON @ 9600 baud (cada 1s)
   ▼
pusher/pusher.py  ──────►  backend/main.py (FastAPI :8000)
   │   poll cada 1s              │   SQLite readings.db
   │   /api/command/pending      │   WebSocket /ws
   │                             ▼
   ◄── serial write cmd    frontend/ (React :5173)
                                     Dashboard en tiempo real
```

---

## Stack de software

### Arduino (`arduino/algae_monitor/algae_monitor.ino`)

**Librerías requeridas** (Arduino IDE → Herramientas → Administrar librerías):
- `DFRobot_PH` v1.0.0
- `MAX6675 library` v1.1.0
- `EEPROM` (incluida en el IDE)

**Salida serial** (JSON cada 1 segundo):
```json
{"id":"pH_DO_1","pH":7.02,"DO":8.23,"temp":23.5,"tc":23.5,"ts":12000}
```
- `temp`: temperatura usada para cálculos (del MAX6675 si es válida, sino 25.0°C como fallback)
- `tc`: lectura cruda del MAX6675 (−999 = NaN / desconectado)
- `ts`: millis() desde el último boot

**Comandos seriales** (enviados desde el dashboard):

| Comando | Acción |
|---|---|
| `CAL7` | Calibra punto pH 7 con el voltaje actual (ciclo completo: enterph → calph → exitph) |
| `CAL4` | Calibra punto pH 4 con el voltaje actual |
| `RESETCAL` | Borra EEPROM bytes 0–43, resetea calibración a fábrica |
| `DOCAL` | Guarda voltaje actual del DO como referencia de saturación en aire |
| `TEMP:xx.x` | Setea temperatura manual (ej: `TEMP:22.5`) |

**Eventos de respuesta** (JSON con campo `event`, van por WebSocket al dashboard):
```json
{"event":"PH_CAL_DONE","id":"pH_DO_1","msg":"pH 7 (1437mV) pH=7.00"}
{"event":"CAL_RESET","id":"pH_DO_1","msg":"EEPROM borrada"}
{"event":"DO_CAL","id":"pH_DO_1","v":1612.3}
```

**EEPROM layout:**
- Bytes 0–3: `neutralVoltage` (pH 7)
- Bytes 4–7: `acidVoltage` (pH 4)
- Bytes 40–43: `doCalVoltage`

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
- `DFRobot_PH` (v1.0.0)
- `MAX6675 library` (v1.1.0)

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

### pH (en este orden estricto)

1. **Borrar EEPROM** — presionar "Borrar EEPROM" en el dashboard
2. **Buffer pH 7** — sumergir el electrodo, esperar 2 min a que se estabilice, presionar "Calibrar pH 7"
3. **Buffer pH 4** — enjuagar el electrodo, sumergir en buffer 4, esperar 2 min, presionar "Calibrar pH 4"

El Event Log del dashboard confirma cada paso:
```
[Arduino] PH_CAL_DONE: pH 7 (1437mV) pH=7.00
[Arduino] PH_CAL_DONE: pH 4 (1965mV) pH=4.00
```

La calibración se guarda en EEPROM y sobrevive reinicios del Arduino.

**Rangos esperados de voltaje** (A0, 5V ref):
- Buffer pH 7 → ~1322–1678 mV
- Buffer pH 4 → ~1854–2210 mV

### DO (oxígeno disuelto)

1. Sacar el electrodo DO del agua y exponerlo al aire por 30 s
2. Presionar "Cal. oxígeno" en el dashboard

### Temperatura

No requiere calibración. El MAX6675 con termocouple tipo K es autocalibrante.

---

## Problemas conocidos y soluciones

| Síntoma | Causa | Solución |
|---|---|---|
| pH muestra −12 o valor absurdo | BNC del electrodo suelto del board Gravity | Re-sentar firmemente el conector BNC |
| Temperatura stuck en 25.0°C | MAX6675 desconectado o SPI flotando | Verificar conexiones |
| DO sube a 14+ mg/L | Temperatura leyendo 0°C (MISO flotante con MAX6675 ausente) | Conectar MAX6675 o desconectar TODOS sus cables |
| Calibración pH sin efecto | `strupr()` de DFRobot_PH requiere strings mutables | El sketch usa `char[]` — no pasar literales `const char*` |
| Arduino resetea al reconectar pusher | DTR toggling al abrir el puerto serial | Normal — la calibración persiste en EEPROM |
| Lecturas erróneas al conectar MAX6675 | Pines SPI activos sin VCC/GND (backpowering) | Conectar GND y VCC antes que SCK/CS/SO |

---

## Estructura del repositorio

```
Sensores-Ph-od/
├── arduino/
│   └── algae_monitor/
│       └── algae_monitor.ino      # Sketch principal
├── backend/
│   ├── main.py                    # FastAPI app
│   ├── requirements.txt
│   └── readings.db                # SQLite (generado al correr)
├── pusher/
│   ├── pusher.py                  # Bridge serial ↔ backend
│   ├── requirements.txt
│   └── .env                       # Config local (gitignored)
├── frontend/
│   ├── src/
│   │   └── App.jsx                # Dashboard React (componente único)
│   ├── .env                       # Config local (gitignored)
│   └── package.json
├── CLAUDE.md                      # Contexto para agentes IA
├── free_com3.ps1                  # Mata MSI Center si bloquea COM3 (Windows)
└── README.md
```

## Estado actual

| Componente | Estado |
|---|---|
| Arduino + sensores pH/DO/Temp | Funcionando (COM3) |
| `pusher/pusher.py` | Listo (corre en PC local) |
| `backend/` FastAPI | Funcional en local; pendiente deploy en Railway |
| `frontend/` React dashboard | Funcional en local + GitHub Pages |
