// algae_monitor.ino
// Arduino Uno: pH (electrodo + board Gravity) + DO (SEN0237) + Temperatura (MAX6675)
//
// Analog:  A0 = pH  |  A1 = DO
// SPI:     D13=SCK  |  D12=SO(MISO)  |  D10=CS
//
// Calibración de pH por 2 puntos propia (no DFRobot_PH): se guardan los voltajes
// medidos en buffer 7.0 y 4.0 y se interpola linealmente. Así funciona con
// cualquier electrodo, sin los rangos fijos (1322-1678 / 1854-2210 mV) ni el
// centro en 1500 mV que asume la librería DFRobot y que no cuadran con este board.

#include <EEPROM.h>
#include <max6675.h>
#include <SoftwareSerial.h>

#define PH_PIN      A0
#define DO_PIN      A1
#define MAX_SCK     13
#define MAX_CS      10
#define MAX_SO      12
#define DEVICE_ID   "pH_DO_1"
#define PH_V7_ADDR  0     // float: voltaje en buffer 7.0
#define PH_V4_ADDR  4     // float: voltaje en buffer 4.0
#define DO_CAL_ADDR 40    // float: voltaje de referencia del DO (aire)
#define READ_MS     1000

const uint16_t DO_Table[41] = {
  14460, 14220, 13820, 13440, 13090, 12740, 12420, 12110, 11810, 11530,
  11260, 11010, 10770, 10530, 10300, 10080,  9860,  9660,  9460,  9270,
   9080,  8900,  8730,  8570,  8410,  8250,  8110,  7960,  7820,  7690,
   7560,  7430,  7300,  7180,  7070,  6950,  6840,  6730,  6630,  6530, 6410
};

MAX6675    thermocouple(MAX_SCK, MAX_CS, MAX_SO);
SoftwareSerial espSerial(2, 5); // RX=D2 (ESP TX) | TX=D5 (ESP RX, vía divisor 1k/2.2k) — D3 quedó dañado

float temperature  = 25.0;
float doCalVoltage = 1600.0;
float phCalV7 = 1500.0;   // voltaje medido en buffer 7.0 (se calibra)
float phCalV4 = 2032.0;   // voltaje medido en buffer 4.0 (se calibra)
float phVoltage, phValue;
float doVoltage, doValue;

void sendEvent(const char* event, const char* msg = "") {
  String line = "{\"event\":\"" + String(event) + "\",\"id\":\"" + DEVICE_ID + "\"";
  if (msg[0]) line += ",\"msg\":\"" + String(msg) + "\"";
  line += "}";
  Serial.println(line);
  espSerial.println(line);
}

// Promedia 16 muestras del ADC para bajar el ruido (mV)
float readAnalogMv(uint8_t pin) {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(pin);
  return (sum / 16.0) / 1024.0 * 5000.0;
}

float readPhVoltage() {
  return readAnalogMv(PH_PIN);
}

// pH por recta de 2 puntos: (phCalV7, 7.0) y (phCalV4, 4.0)
float computePH(float mv) {
  float dv = phCalV4 - phCalV7;
  if (fabs(dv) < 1.0) return -1.0;   // sin calibrar válido
  return 7.0 + (mv - phCalV7) * (4.0 - 7.0) / dv;
}

// Guarda el voltaje actual como punto de calibración (buffer 7 o 4)
void calibratePH(bool isPH7) {
  float v = readPhVoltage();
  if (isPH7) { phCalV7 = v; EEPROM.put(PH_V7_ADDR, v); }
  else       { phCalV4 = v; EEPROM.put(PH_V4_ADDR, v); }
  phVoltage = v;
  phValue   = computePH(v);
  String msg = String(isPH7 ? "pH 7" : "pH 4") + " (" + String(v, 0) + "mV) pH=" + String(phValue, 2);
  sendEvent("PH_CAL_DONE", msg.c_str());
}

void setup() {
  Serial.begin(9600);
  espSerial.begin(9600);

  EEPROM.get(PH_V7_ADDR, phCalV7);
  if (isnan(phCalV7) || phCalV7 < 100 || phCalV7 > 5000) phCalV7 = 1500.0;
  EEPROM.get(PH_V4_ADDR, phCalV4);
  if (isnan(phCalV4) || phCalV4 < 100 || phCalV4 > 5000) phCalV4 = 2032.0;
  EEPROM.get(DO_CAL_ADDR, doCalVoltage);
  if (isnan(doCalVoltage) || doCalVoltage < 500 || doCalVoltage > 4500) doCalVoltage = 1600.0;

  delay(500);
}

void processCommand(String cmd) {
  if (cmd == "CAL7") {
    calibratePH(true);

  } else if (cmd == "CAL4") {
    calibratePH(false);

  } else if (cmd == "RESETCAL") {
    for (int i = 0; i < 40; i++) EEPROM.write(i, 0xFF);
    phCalV7 = 1500.0;
    phCalV4 = 2032.0;
    doCalVoltage = 1600.0;
    EEPROM.put(DO_CAL_ADDR, doCalVoltage);
    sendEvent("CAL_RESET", "EEPROM borrada");

  } else if (cmd == "DOCAL") {
    doCalVoltage = readAnalogMv(DO_PIN);
    EEPROM.put(DO_CAL_ADDR, doCalVoltage);
    String line = "{\"event\":\"DO_CAL\",\"id\":\"" + String(DEVICE_ID) + "\",\"v\":" + String(doCalVoltage, 1) + "}";
    Serial.println(line);
    espSerial.println(line);

  } else if (cmd.startsWith("TEMP:")) {
    temperature = cmd.substring(5).toFloat();
    sendEvent("TEMP_SET");
  }
}

void loop() {
  static unsigned long lastRead = 0;

  // Comandos desde el USB (monitor serial) o desde el ESP (web de calibración)
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    processCommand(cmd);
  }
  if (espSerial.available() > 0) {
    String cmd = espSerial.readStringUntil('\n');
    cmd.trim();
    processCommand(cmd);
  }

  if (millis() - lastRead >= READ_MS) {
    lastRead = millis();

    float tRead = thermocouple.readCelsius();
    if (!isnan(tRead) && tRead > 5.0 && tRead < 60.0)
      temperature = tRead;

    phVoltage = readPhVoltage();
    phValue   = computePH(phVoltage);

    doVoltage = readAnalogMv(DO_PIN);
    uint8_t t = (uint8_t)constrain((int)temperature, 0, 40);
    doValue   = doVoltage / doCalVoltage * (DO_Table[t] / 1000.0);

    String line = "{\"id\":\"" + String(DEVICE_ID) +
                  "\",\"pH\":" + String(phValue, 2) +
                  ",\"DO\":" + String(doValue, 2) +
                  ",\"temp\":" + String(temperature, 1) +
                  ",\"tc\":" + String(isnan(tRead) ? -999.0 : tRead, 1) +
                  ",\"phmv\":" + String(phVoltage, 0) +
                  ",\"domv\":" + String(doVoltage, 0) +
                  ",\"v7\":" + String(phCalV7, 0) +
                  ",\"v4\":" + String(phCalV4, 0) +
                  ",\"ts\":" + String(millis()) + "}";
    Serial.println(line);
    espSerial.println(line);
  }
}
