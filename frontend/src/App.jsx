import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS  = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/^http/, "ws") + "/ws";

const RANGES = {
  pH: { low: 7.0, high: 8.5, min: 5,  max: 10, unit: "",      label: "pH" },
  DO: { low: 6.0, high: 12,  min: 0,  max: 16, unit: " mg/L", label: "OD" },
};

function statusColor(key, val) {
  if (val == null) return "#6b7280";
  const { low, high } = RANGES[key];
  if (val >= low && val <= high) return "#22c55e";
  if (val < low - 1 || val > high + 1) return "#ef4444";
  return "#f59e0b";
}

function statusLabel(key, val) {
  if (val == null) return "SIN DATOS";
  const { low, high } = RANGES[key];
  if (val >= low && val <= high) return "ÓPTIMO";
  if (val < low - 1 || val > high + 1) return "CRÍTICO";
  return "ALERTA";
}

function GaugeBig({ label, value, unit, color, status, range }) {
  return (
    <div style={{
      background: "#111827", borderRadius: 16, padding: "24px 32px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      border: `2px solid ${color}33`, minWidth: 200,
    }}>
      <span style={{ color: "#9ca3af", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 64, fontWeight: 700, color, lineHeight: 1 }}>
        {value != null ? value.toFixed(2) : "—"}
      </span>
      <span style={{ color: "#6b7280", fontSize: 13 }}>{unit || label}</span>
      <span style={{
        marginTop: 4, padding: "3px 12px", borderRadius: 999,
        fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
        background: `${color}22`, color,
      }}>{status}</span>
      <span style={{ color: "#4b5563", fontSize: 11 }}>
        Óptimo: {range.low} – {range.high}{unit}
      </span>
    </div>
  );
}

function Btn({ onClick, children, color = "#22c55e" }) {
  return (
    <button onClick={onClick} style={{
      background: `${color}22`, border: `1px solid ${color}44`, color,
      borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer",
      fontWeight: 600,
    }}>{children}</button>
  );
}

const TICK_FMT = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

function ChartTooltip({ active, payload, label, unit, color }) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  const d = new Date(label);
  const hora = d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div style={{
      background: "#1f2937", border: `1px solid ${color}44`, borderRadius: 10,
      padding: "10px 14px", minWidth: 160,
    }}>
      <div style={{ color: "#9ca3af", fontSize: 11, marginBottom: 6 }}>
        🕐 {hora}
      </div>
      <div style={{ color, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
        {val != null ? val.toFixed(2) : "—"}<span style={{ fontSize: 12, marginLeft: 4, color: "#6b7280" }}>{unit}</span>
      </div>
    </div>
  );
}

const DEVICE_LABELS = {
  "pH_DO_1": { ph: "pH — H-101",    color: "#22c55e" },
  "pH_DO_2": { ph: "pH — DFRobot",  color: "#a78bfa" },
};

export default function App() {
  // devices: { "pH_DO": {pH, DO, temp, timestamp}, "pH2": {pH, timestamp} }
  const [devices, setDevices] = useState({});
  const [history, setHistory] = useState([]);
  const [connected, setConnected] = useState(false);
  const [log, setLog] = useState([]);
  const [temp, setTemp] = useState("25.0");
  const ws = useRef(null);

  const addLog = (msg) =>
    setLog(l => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l].slice(0, 60));

  useEffect(() => {
    fetch(`${API}/api/history?hours=24`)
      .then(r => r.json())
      .then(rows => setHistory(rows.map(r => ({ ...r, time: r.timestamp }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function connect() {
      const sock = new WebSocket(WS);
      ws.current = sock;
      sock.onopen  = () => { setConnected(true);  addLog("Conectado al backend"); };
      sock.onclose = () => { setConnected(false); addLog("Reconectando..."); setTimeout(connect, 3000); };
      sock.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.event) return;
        const id = data.id || "unknown";
        setDevices(prev => ({ ...prev, [id]: data }));
        setHistory(h => [...h, { ...data, time: data.timestamp }].slice(-720));
      };
    }
    connect();
    return () => ws.current?.close();
  }, []);

  const sendCmd = async (cmd) => {
    await fetch(`${API}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd }),
    });
    addLog(`Enviado: ${cmd}`);
  };

  const d1 = devices["pH_DO_1"] || {};
  const d2 = devices["pH_DO_2"] || {};
  const water = d1.temp ?? d2.temp;
  const lastTs = d1.timestamp ?? d2.timestamp;

  return (
    <div style={{ minHeight: "100vh", background: "#030712", color: "#f9fafb", fontFamily: "system-ui, sans-serif", padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Algae Monitor</h1>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
            Monitoreo pH + Oxígeno Disuelto · Tratamiento de aguas residuales por algas
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {water != null && <span style={{ color: "#9ca3af", fontSize: 13 }}>🌡 {water.toFixed(1)} °C</span>}
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: connected ? "#22c55e" : "#ef4444" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
            {connected ? "En línea" : "Sin conexión"}
          </span>
        </div>
      </div>

      {/* Gauges + Status + Commands */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        {/* Gauges dinámicos — uno por Arduino conectado */}
        {Object.entries(DEVICE_LABELS).map(([id, cfg]) => {
          const dev = devices[id];
          const online = !!dev;
          return (
            <div key={id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ color: "#4b5563", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", textAlign: "center" }}>
                {id} {!online && <span style={{ color: "#ef444488" }}>· offline</span>}
              </div>
              <GaugeBig label={cfg.ph} value={dev?.pH} unit="" color={online ? statusColor("pH", dev?.pH) : "#374151"} status={statusLabel("pH", dev?.pH)} range={RANGES.pH} />
              <GaugeBig label="Oxígeno Disuelto" value={dev?.DO} unit=" mg/L" color={online ? statusColor("DO", dev?.DO) : "#374151"} status={statusLabel("DO", dev?.DO)} range={RANGES.DO} />
            </div>
          );
        })}

        {/* Status panel */}
        <div style={{ flex: 1, minWidth: 200, background: "#111827", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ color: "#9ca3af", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>Estado</span>
          {Object.entries(DEVICE_LABELS).flatMap(([id, cfg]) => {
            const dev = devices[id];
            return [
              { key: "pH", val: dev?.pH,  label: cfg.ph },
              { key: "DO", val: dev?.DO,  label: `DO · ${id}` },
            ];
          }).map(({ key, val, label }, i) => {
            const c = statusColor(key, val);
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", background: `${c}11`, borderRadius: 8, border: `1px solid ${c}22` }}>
                <span style={{ fontSize: 12, color: "#d1d5db" }}>{label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: c }}>{statusLabel(key, val)}</span>
              </div>
            );
          })}
          <div style={{ marginTop: "auto", color: "#4b5563", fontSize: 11 }}>
            {lastTs ? `Última lectura: ${new Date(lastTs).toLocaleTimeString()}` : "Esperando Arduino..."}
          </div>
        </div>

        {/* Commands */}
        <div style={{ minWidth: 220, background: "#111827", borderRadius: 16, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ color: "#9ca3af", fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}>Comandos</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#6b7280", fontSize: 12 }}>Temp (°C):</span>
            <input value={temp} onChange={e => setTemp(e.target.value)}
              style={{ width: 60, background: "#1f2937", border: "1px solid #374151", borderRadius: 6, color: "#fff", padding: "4px 8px", fontSize: 12 }} />
            <Btn onClick={() => sendCmd(`TEMP:${temp}`)}>Set</Btn>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn onClick={() => sendCmd("DOCAL")}   color="#3b82f6">Cal. DO</Btn>
            <Btn onClick={() => sendCmd("ENTERPH")} color="#22c55e">pH iniciar</Btn>
            <Btn onClick={() => sendCmd("CALPH")}   color="#22c55e">pH punto</Btn>
            <Btn onClick={() => sendCmd("EXITPH")}  color="#22c55e">pH guardar</Btn>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* pH chart — una línea por Arduino */}
        <div style={{ background: "#111827", borderRadius: 16, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 12, color: "#9ca3af", letterSpacing: 2, textTransform: "uppercase" }}>
            pH — últimas 24h
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tickFormatter={TICK_FMT} tick={{ fill: "#4b5563", fontSize: 10 }} minTickGap={40} allowDuplicatedCategory={false} />
              <YAxis domain={[5, 10]} tick={{ fill: "#4b5563", fontSize: 10 }} width={32} />
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                labelFormatter={v => `🕐 ${new Date(v).toLocaleTimeString("es-CO")}`}
                formatter={(v, name) => [v?.toFixed(2), DEVICE_LABELS[name]?.ph ?? name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={n => DEVICE_LABELS[n]?.ph ?? n} />
              <ReferenceLine y={7.0} stroke="#f59e0b" strokeDasharray="4 4" />
              <ReferenceLine y={8.5} stroke="#f59e0b" strokeDasharray="4 4" />
              {Object.entries(DEVICE_LABELS).map(([id, cfg]) => (
                <Line key={id} data={history.filter(r => r.id === id)} type="monotone"
                  dataKey="pH" name={id} stroke={cfg.color} dot={false} strokeWidth={2} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* DO chart — una línea por Arduino */}
        <div style={{ background: "#111827", borderRadius: 16, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 12, color: "#9ca3af", letterSpacing: 2, textTransform: "uppercase" }}>
            Oxígeno Disuelto — últimas 24h
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="time" tickFormatter={TICK_FMT} tick={{ fill: "#4b5563", fontSize: 10 }} minTickGap={40} allowDuplicatedCategory={false} />
              <YAxis domain={[0, 16]} tick={{ fill: "#4b5563", fontSize: 10 }} width={32} />
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                labelFormatter={v => `🕐 ${new Date(v).toLocaleTimeString("es-CO")}`}
                formatter={(v, name) => [`${v?.toFixed(2)} mg/L`, DEVICE_LABELS[name]?.ph ?? name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={n => DEVICE_LABELS[n]?.ph ?? n} />
              <ReferenceLine y={6}  stroke="#f59e0b" strokeDasharray="4 4" />
              <ReferenceLine y={12} stroke="#f59e0b" strokeDasharray="4 4" />
              {Object.entries(DEVICE_LABELS).map(([id, cfg]) => (
                <Line key={id} data={history.filter(r => r.id === id)} type="monotone"
                  dataKey="DO" name={id} stroke={cfg.color} dot={false} strokeWidth={2} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Log */}
      <div style={{ background: "#111827", borderRadius: 16, padding: 20 }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 12, color: "#9ca3af", letterSpacing: 2, textTransform: "uppercase" }}>Log</h3>
        <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
          {log.length === 0
            ? <span style={{ color: "#4b5563", fontSize: 12 }}>Sin eventos...</span>
            : log.map((l, i) => <span key={i} style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>{l}</span>)
          }
        </div>
      </div>
    </div>
  );
}
