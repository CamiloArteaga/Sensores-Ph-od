// algae_monitor.ino
// Arduino Uno: pH (H-101 + DFRobot board) + DO (SEN0237) + Temperatura (MAX6675)
//
// Analog:  A0 = pH  |  A1 = DO
// SPI:     D13=SCK  |  D12=SO(MISO)  |  D10=CS

#include <DFRobot_PH.h>
#include <EEPROM.h>
#include <max6675.h>

#define PH_PIN      A0
#define DO_PIN      A1
#define MAX_SCK     13
#define MAX_CS      10
#define MAX_SO      12
#define DEVICE_ID   "pH_DO_1"
#define DO_CAL_ADDR 40
#define READ_MS     1000

const uint16_t DO_Table[41] = {
  14460, 14220, 13820, 13440, 13090, 12740, 12420, 12110, 11810, 11530,
  11260, 11010, 10770, 10530, 10300, 10080,  9860,  9660,  9460,  9270,
   9080,  8900,  8730,  8570,  8410,  8250,  8110,  7960,  7820,  7690,
   7560,  7430,  7300,  7180,  7070,  6950,  6840,  6730,  6630,  6530, 6410
};

DFRobot_PH ph;
MAX6675    thermocouple(MAX_SCK, MAX_CS, MAX_SO);

float temperature  = 25.0;
float doCalVoltage = 1600.0;
float phVoltage, phValue;
float doVoltage, doValue;

void sendEvent(const char* event, const char* msg = "") {
  Serial.print("{\"event\":\""); Serial.print(event);
  Serial.print("\",\"id\":\"");  Serial.print(DEVICE_ID);
  if (msg[0]) { Serial.print("\",\"msg\":\""); Serial.print(msg); }
  Serial.println("\"}");
}

// Lee voltage actual del pH (siempre fresco)
float readPhVoltage() {
  return analogRead(PH_PIN) / 1024.0 * 5000.0;
}

void calibratePH(const char* label) {
  float v = readPhVoltage();
  // strupr() de la lib requiere strings mutables — NO pasar literales const
  char enter[] = "ENTERPH";
  char cal[]   = "CALPH";
  char ex[]    = "EXITPH";
  ph.calibration(v, temperature, enter);
  delay(50);
  ph.calibration(v, temperature, cal);
  delay(50);
  ph.calibration(v, temperature, ex);
  delay(100);
  phVoltage = readPhVoltage();
  phValue   = ph.readPH(phVoltage, temperature);
  char buf[80];
  snprintf(buf, sizeof(buf), "%s (%.0fmV) pH=%.2f", label, v, phValue);
  sendEvent("PH_CAL_DONE", buf);
}

void setup() {
  Serial.begin(9600);
  ph.begin();
  EEPROM.get(DO_CAL_ADDR, doCalVoltage);
  if (isnan(doCalVoltage) || doCalVoltage < 500 || doCalVoltage > 4500)
    doCalVoltage = 1600.0;
  delay(500);
}

void loop() {
  static unsigned long lastRead = 0;

  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "CAL7") {
      // Electrodo ya estabilizado en buffer pH 7 — calibra y guarda
      calibratePH("pH 7");

    } else if (cmd == "CAL4") {
      // Electrodo ya estabilizado en buffer pH 4 — calibra y guarda
      calibratePH("pH 4");

    } else if (cmd == "RESETCAL") {
      for (int i = 0; i < 40; i++) EEPROM.write(i, 0xFF);
      doCalVoltage = 1600.0;
      EEPROM.put(DO_CAL_ADDR, doCalVoltage);
      ph.begin();
      sendEvent("CAL_RESET", "EEPROM borrada");

    } else if (cmd == "DOCAL") {
      doCalVoltage = analogRead(DO_PIN) / 1024.0 * 5000.0;
      EEPROM.put(DO_CAL_ADDR, doCalVoltage);
      Serial.print("{\"event\":\"DO_CAL\",\"id\":\""); Serial.print(DEVICE_ID);
      Serial.print("\",\"v\":"); Serial.print(doCalVoltage, 1);
      Serial.println("}");

    } else if (cmd.startsWith("TEMP:")) {
      temperature = cmd.substring(5).toFloat();
      sendEvent("TEMP_SET");

    // Comandos legacy — se mantienen por compatibilidad
    } else if (cmd == "ENTERPH") {
      ph.calibration(phVoltage, temperature, "enterph");
    } else if (cmd == "CALPH") {
      ph.calibration(phVoltage, temperature, "calph");
    } else if (cmd == "EXITPH") {
      ph.calibration(phVoltage, temperature, "exitph");
      sendEvent("PH_CAL_SAVED");
    }
  }

  if (millis() - lastRead >= READ_MS) {
    lastRead = millis();

    float tRead = thermocouple.readCelsius();
    if (!isnan(tRead) && tRead > 5.0 && tRead < 60.0)
      temperature = tRead;

    phVoltage = readPhVoltage();
    phValue   = ph.readPH(phVoltage, temperature);

    doVoltage = analogRead(DO_PIN) / 1024.0 * 5000.0;
    uint8_t t = (uint8_t)constrain((int)temperature, 0, 40);
    doValue   = doVoltage / doCalVoltage * (DO_Table[t] / 1000.0);

    Serial.print("{\"id\":\"");   Serial.print(DEVICE_ID);
    Serial.print("\",\"pH\":");   Serial.print(phValue, 2);
    Serial.print(",\"DO\":");     Serial.print(doValue, 2);
    Serial.print(",\"temp\":");   Serial.print(temperature, 1);
    Serial.print(",\"tc\":");     Serial.print(isnan(tRead) ? -999.0 : tRead, 1);
    Serial.print(",\"ts\":");     Serial.print(millis());
    Serial.println("}");
  }
}
