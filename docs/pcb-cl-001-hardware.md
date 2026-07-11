# PCB CL-001 — Notas de ensamblaje (shield sobre Arduino Uno)

Notas de la sesión de soldadura, para continuar en la próxima. Complementa
[[Algae-Monitor-Hardware]] en el vault y el pinout de `CLAUDE.md`.

## Diseño físico del shield

Pines apilados que van encima del Arduino (la PCB queda encima, el Arduino debajo):

```
5V, 3.3V, GND, GND, Vin, A0, A1, A2, A3, A4, A5
```

**Pendiente:** esta primera revisión de la PCB NO incluye pads para los pines
digitales D10/D12/D13 (MAX6675 — CS/SO/SCK). Se agregan en una siguiente
revisión, una vez validadas las conexiones analógicas.

## Mapeo de sensores analógicos (confirmado contra el repo)

Mismo mapeo que usan `algae_monitor.ino` y `algae_monitor_2.ino`:

| Sensor | Pin |
|---|---|
| pH (DFRobot SEN0161-V2) | **A0** |
| DO (DFRobot SEN0237) | **A1** |

## Convención de colores de cable usada en esta PCB

| Línea | Color |
|---|---|
| GND | Negro |
| 5V | Rojo |
| 3.3V | Naranja (reservado, sin uso en sensores por ahora) |
| Señal A0 (pH) | Amarillo |
| Señal A1 (DO) | Blanco |
| SPI SCK/CS/SO (futuro, MAX6675) | Verde / Azul / Gris |

## Expansión WiFi: ESP8266MOD + LM1117T (planeada, aún sin soldar)

### Pines Arduino a usar

| Pin | Uso |
|---|---|
| D2 | RX Arduino ← TX ESP8266 (SoftwareSerial) |
| D3 | TX Arduino → RX ESP8266 (SoftwareSerial, vía divisor de voltaje) |
| D4 (opcional) | RST del ESP8266, si se quiere resetear por software |

CH_PD/EN y GPIO0 del ESP8266 van directo a 3.3V (con pull-up 10kΩ), no consumen
pin del Arduino.

**Pendiente de decidir:** si el ESP8266 reemplaza el bridge USB serial actual
(`pusher.py`) o es un canal adicional. Afecta la arquitectura del backend.

### LM1117T — regulador dedicado para el ESP8266

El pin de 3.3V del Arduino Uno solo entrega ~50mA; el ESP8266 puede pedir
picos de 200-300mA en TX WiFi. Por eso se agrega un LM1117T-3.3 dedicado:

- INPUT ← 5V del Arduino (o Vin)
- OUTPUT → 3.3V dedicado exclusivo para VCC/CH_PD/GPIO0 del ESP8266
- GND → GND común
- Capacitores 10µF en entrada y salida

### Divisor de voltaje TX(Arduino, 5V) → RX(ESP8266, 3.3V)

Necesario porque el Arduino trabaja a lógica 5V y el RX del ESP8266 tolera
máximo ~3.6V. La línea RX(ESP)→RX(Arduino) no necesita divisor (3.3V ya se
lee como HIGH en el Arduino).

```
Arduino D3 (TX, 5V) ──[ R 1kΩ ]── nodo A ── RX del ESP8266
                                     │
                               [ R 2.2kΩ ]
                                     │
                                    GND
```

- R1 = 1kΩ, en serie entre D3 y el nodo A
- R2 = 2.2kΩ, entre el nodo A y GND
- Vout = 5V × 2.2kΩ / (1kΩ + 2.2kΩ) ≈ 3.44V — seguro para el RX del ESP8266
- Las resistencias no tienen polaridad: el lado físico no importa, solo el
  orden en el circuito (1kΩ en serie con TX, 2.2kΩ a GND)

## Checklist de continuación

- [ ] Terminar de soldar conectores pH (A0) y DO (A1) sobre la CL-001
- [ ] Verificar continuidad de los 2 GND compartidos
- [ ] Soldar divisor de voltaje (1kΩ + 2.2kΩ) antes del RX del ESP8266
- [ ] Soldar LM1117T-3.3 + capacitores 10µF para alimentar el ESP8266
- [ ] Definir arquitectura: ¿ESP8266 reemplaza `pusher.py` o es canal adicional?
- [ ] Diseñar siguiente revisión de PCB con pads D10/D12/D13 para MAX6675
