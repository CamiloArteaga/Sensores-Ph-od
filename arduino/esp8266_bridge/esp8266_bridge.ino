// esp8266_bridge.ino
// ESP8266: puente entre el Arduino y la nube + calibración local en tiempo real.
//
// Dos funciones:
//  1) Sube la última lectura del Arduino a Supabase (PostgREST) una vez por minuto.
//  2) Sirve una web de calibración en http://<IP-del-ESP> (red local): muestra las
//     lecturas en vivo (1/s) y reenvía comandos (CAL7/CAL4/DOCAL/RESETCAL) al Arduino.
//     Así la calibración es en tiempo real sin pasar por Supabase ni backend.
//
// Cableado (enlace bidireccional con el Arduino):
//   Arduino D5 (TX) -> divisor 1k(a D5)/2.2k(a GND) -> D7 (GPIO13) del ESP   [ESP recibe]
//   D6 (GPIO12) del ESP -> D2 del Arduino (sin divisor; 3.3V los lee el Arduino) [ESP envía]
//   GND común. Alimentación por cargador aparte.
//
// WiFi: intenta las redes conocidas de secrets.h; si ninguna conecta, levanta el
// portal cautivo "AlgaeMonitor-Setup" para agregar una red nueva SIN reflashear.

#include <ESP8266WiFi.h>
#include <ESP8266WiFiMulti.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>
#include <SoftwareSerial.h>

#include "secrets.h"  // WIFI_CREDENTIALS[], SUPABASE_HOST, SUPABASE_KEY (gitignorado)

const unsigned long UPLOAD_MS = 60000;  // subir a Supabase cada 1 minuto
unsigned long lastUpload = 0;

String rxBuf = "";           // acumulador de la línea en curso del Arduino
String lastReading = "";     // última lectura JSON (para la web /live)
String lastEvent = "";       // último evento de calibración (para la web /live)
String pendingReading = "";  // lectura a subir en el próximo ciclo de minuto

ESP8266WiFiMulti wifiMulti;
SoftwareSerial arduinoLink(13, 12);   // RX=D7 (recibe), TX=D6 (envía comandos)
ESP8266WebServer server(80);

// --- Web de calibración (servida desde el propio ESP) ---
const char CAL_PAGE[] PROGMEM = R"HTML(<!doctype html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Calibración Algae</title><style>
body{font-family:system-ui,sans-serif;background:#0f1720;color:#e6edf3;margin:0;padding:16px}
h1{font-size:1.2rem}.v{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.card{background:#1b2733;border-radius:12px;padding:14px 18px;flex:1;min-width:90px}
.card b{display:block;font-size:1.8rem;margin-top:4px}
button{width:100%;padding:16px;margin:6px 0;font-size:1rem;border:0;border-radius:10px;color:#fff}
.b7{background:#2563eb}.b4{background:#7c3aed}.bo{background:#0891b2}.br{background:#b91c1c}
#evt{background:#1b2733;border-radius:10px;padding:12px;margin-top:12px;min-height:1.2em;font-size:.9rem}
small{color:#8b98a5}</style></head><body>
<h1>Calibración — pH_DO_1</h1>
<div class="v">
<div class="card">pH<b id="vph">--</b></div>
<div class="card">pH (mV)<b id="vphmv">--</b></div>
<div class="card">OD (mg/L)<b id="vdo">--</b></div>
<div class="card">OD (mV)<b id="vdomv">--</b></div>
<div class="card">Temp °C<b id="vtemp">--</b></div>
</div>
<small>Mete el electrodo en el buffer, espera a que el valor se estabilice y pulsa el botón.</small>
<button class="b7" onclick="cmd('CAL7')">Calibrar pH 7.0</button>
<button class="b4" onclick="cmd('CAL4')">Calibrar pH 4.0</button>
<button class="bo" onclick="cmd('DOCAL')">Calibrar oxígeno (en aire)</button>
<button class="br" onclick="if(confirm('¿Borrar toda la calibración?'))cmd('RESETCAL')">Borrar calibración</button>
<div id="evt">Sin eventos aún.</div>
<script>
const g=id=>document.getElementById(id);
async function tick(){try{
 const d=await(await fetch('/live')).json();
 const r=d.reading;
 if(r){g('vph').textContent=r.pH??'--';g('vphmv').textContent=r.phmv??'--';g('vdo').textContent=r.DO??'--';g('vdomv').textContent=r.domv??'--';g('vtemp').textContent=r.temp??'--';}
 if(d.event){g('evt').textContent='['+d.event.event+'] '+(d.event.msg||('v='+d.event.v)||'');}
}catch(e){}}
async function cmd(c){g('evt').textContent='Enviando '+c+'…';await fetch('/cmd?c='+c);}
setInterval(tick,1000);tick();
</script></body></html>)HTML";

void handleRoot()  {
  server.sendHeader("Cache-Control", "no-store");   // evita que el navegador sirva una versión vieja de la página
  server.send_P(200, "text/html", CAL_PAGE);
}

void handleLive() {
  String out = "{\"reading\":";
  out += lastReading.length() ? lastReading : "null";
  out += ",\"event\":";
  out += lastEvent.length() ? lastEvent : "null";
  out += "}";
  server.send(200, "application/json", out);
}

void handleCmd() {
  String c = server.arg("c");
  if (c == "CAL7" || c == "CAL4" || c == "DOCAL" || c == "RESETCAL") {
    arduinoLink.println(c);           // reenvía al Arduino por D6
    Serial.print("[cmd] "); Serial.println(c);
    server.send(200, "text/plain", "OK " + c);
  } else {
    server.send(400, "text/plain", "comando no permitido");
  }
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long start = millis();
  while (wifiMulti.run() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    WiFiManager wm;
    wm.setConfigPortalTimeout(180);
    wm.autoConnect("AlgaeMonitor-Setup");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi conectado, IP: ");
    Serial.println(WiFi.localIP());
  }
}

// Traduce el JSON del Arduino {id,pH,DO,temp,...} a las columnas de Supabase
// {device_id,ph,do_mgl,temperature} y lo inserta vía PostgREST (timestamp DEFAULT now()).
void uploadToSupabase(const String& arduinoJson) {
  JsonDocument in;
  if (deserializeJson(in, arduinoJson)) return;   // JSON inválido → descarta

  JsonDocument out;
  out["device_id"]   = in["id"];
  out["ph"]          = in["pH"];
  out["do_mgl"]      = in["DO"];
  out["temperature"] = in["temp"];
  String body;
  serializeJson(out, body);

  WiFiClientSecure client;
  client.setInsecure();  // ponytail: no valida el cert TLS de Supabase — frágil de
                         // mantener en el ESP. Suficiente para datos de sensores.
  HTTPClient http;
  http.begin(client, String("https://") + SUPABASE_HOST + "/rest/v1/readings");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");
  int code = http.POST(body);
  Serial.print("[supabase] HTTP "); Serial.println(code);
  http.end();
}

void setup() {
  Serial.begin(9600);        // USB: debug
  arduinoLink.begin(9600);   // enlace con el Arduino (D7 rx / D6 tx)
  delay(200);
  Serial.println("BOOT_OK");

  WiFi.mode(WIFI_STA);
  const int count = sizeof(WIFI_CREDENTIALS) / sizeof(WIFI_CREDENTIALS[0]);
  for (int i = 0; i < count; i++)
    wifiMulti.addAP(WIFI_CREDENTIALS[i].ssid, WIFI_CREDENTIALS[i].pass);

  ensureWiFi();

  server.on("/", handleRoot);
  server.on("/live", handleLive);
  server.on("/cmd", handleCmd);
  server.begin();

  // mDNS: acceso por http://algae.local sin depender de la IP (que da el DHCP)
  MDNS.begin("algae");
  MDNS.addService("http", "tcp", 80);

  Serial.print("Web de calibración en http://algae.local  (o http://");
  Serial.print(WiFi.localIP());
  Serial.println(")");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    ensureWiFi();
    return;
  }
  server.handleClient();
  MDNS.update();

  // Lee del Arduino carácter a carácter y arma líneas. Separa lecturas de eventos.
  while (arduinoLink.available()) {
    char c = arduinoLink.read();
    if (c == '\n') {
      rxBuf.trim();
      if (rxBuf.startsWith("{")) {
        if (rxBuf.indexOf("\"event\"") >= 0) {
          lastEvent = rxBuf;
        } else {
          lastReading = rxBuf;
          pendingReading = rxBuf;
        }
      }
      rxBuf = "";
    } else if (c != '\r' && rxBuf.length() < 200) {
      rxBuf += c;
    }
  }

  // Sube la lectura más fresca una vez por minuto
  if (millis() - lastUpload >= UPLOAD_MS && pendingReading.length() > 0) {
    lastUpload = millis();
    uploadToSupabase(pendingReading);
    pendingReading = "";
  }
}
