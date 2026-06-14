// algae_monitor.ino
// pH + Dissolved Oxygen monitor for algae cultivation pools
// Hardware: Arduino Uno + DFRobot Gravity pH (SEN0161) + DFRobot Gravity DO (SEN0237)
//           HAOSHI H-101 probe connected to pH board via BNC

#include <DFRobot_PH.h>
#include <EEPROM.h>

#define PH_PIN  A0
#define DO_PIN  A1

// DO saturation table (µg/L) at temperatures 0–40°C (from DFRobot SEN0237 docs)
const uint16_t DO_Table[41] = {
  14460, 14220, 13820, 13440, 13090, 12740, 12420, 12110, 11810, 11530,
  11260, 11010, 10770, 10530, 10300, 10080,  9860,  9660,  9460,  9270,
   9080,  8900,  8730,  8570,  8410,  8250,  8110,  7960,  7820,  7690,
   7560,  7430,  7300,  7180,  7070,  6950,  6840,  6730,  6630,  6530, 6410
};

#define DO_CAL_EEPROM_ADDR 40

DFRobot_PH ph;

float temperature  = 25.0;   // °C  — update via serial: "TEMP:25.5"
float doCalVoltage = 1600.0; // mV  — voltage in air-saturated water, saved in EEPROM
float phValue, phVoltage;
float doValue, doVoltage;

void setup() {
  Serial.begin(9600);
  ph.begin();

  // Load saved DO calibration voltage from EEPROM
  EEPROM.get(DO_CAL_EEPROM_ADDR, doCalVoltage);
  if (isnan(doCalVoltage) || doCalVoltage < 500 || doCalVoltage > 4500) {
    doCalVoltage = 1600.0;
  }
}

void loop() {
  static unsigned long lastRead = 0;

  // --- Handle serial commands ---
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    // Set water temperature for compensation
    if (cmd.startsWith("TEMP:")) {
      temperature = cmd.substring(5).toFloat();

    // DO calibration: run with probe in air-saturated water
    } else if (cmd == "DOCAL") {
      doCalVoltage = analogRead(DO_PIN) / 1024.0 * 5000.0;
      EEPROM.put(DO_CAL_EEPROM_ADDR, doCalVoltage);
      Serial.print("{\"event\":\"DO_CAL\",\"calVoltage\":");
      Serial.print(doCalVoltage, 1);
      Serial.println("}");
      return;

    // pH calibration (uses DFRobot 2-point cal: pH4 + pH7 buffers)
    } else if (cmd == "ENTERPH") {
      ph.calibration(phVoltage, temperature, "enterph");
    } else if (cmd == "CALPH") {
      ph.calibration(phVoltage, temperature, "calph");
    } else if (cmd == "EXITPH") {
      ph.calibration(phVoltage, temperature, "exitph");
    }
  }

  // --- Read sensors every 2 seconds ---
  if (millis() - lastRead >= 2000) {
    lastRead = millis();

    // pH
    phVoltage = analogRead(PH_PIN) / 1024.0 * 5000.0; // mV
    phValue   = ph.readPH(phVoltage, temperature);

    // DO with temperature compensation
    doVoltage = analogRead(DO_PIN) / 1024.0 * 5000.0; // mV
    uint8_t t = (uint8_t)constrain((int)temperature, 0, 40);
    doValue   = doVoltage / doCalVoltage * (DO_Table[t] / 1000.0); // mg/L

    // Output JSON line — parsed by Python backend
    Serial.print("{\"pH\":");
    Serial.print(phValue, 2);
    Serial.print(",\"DO\":");
    Serial.print(doValue, 2);
    Serial.print(",\"temp\":");
    Serial.print(temperature, 1);
    Serial.print(",\"ts\":");
    Serial.print(millis());
    Serial.println("}");
  }
}
