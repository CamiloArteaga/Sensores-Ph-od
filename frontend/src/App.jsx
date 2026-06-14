import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS  = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/^http/, "ws") + "/ws";

const RANGES = {
  pH: { low: 7.0, high: 8.5, unit: "" },
  DO: { low: 6.0, high: 12,  unit: " mg/L" },
};

const DEVICES = {
  "pH_DO_1": { label: "H-101",   color: "#22c55e" },
  "pH_DO_2": { label: "DFRobot", color: "#a78bfa" },
};

function getStatus(key, val) {
  if (val == null) return "SIN DATOS";
  const { low, high } = RANGES[key];
  if (val >= low && val <= high) return "ÓPTIMO";
  if (val < low - 1 || val > high + 1) return "CRÍTICO";
  return "ALERTA";
}

const STATUS_COLOR = {
  "ÓPTIMO":    "#22c55e",
  "ALERTA":    "#f59e0b",
  "CRÍTICO":   "#ef4444",
  "SIN DATOS": "#6b7280",
};

const TICK_FMT = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ── Mini sparkline embebida en la card ─────────────────────────────────────
function Sparkline({ data, dataKey, color }) {
  const { low, high } = RANGES[dataKey] || {};
  const gradId = `sg-${dataKey}-${color.slice(1)}`;
  if (!data.length) return <div style={{ height: 40 }} />;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0}   />
          </linearGradient>
        </defs>
        {low  != null && <ReferenceLine y={low}  stroke={color} strokeDasharray="2 2" strokeOpacity={0.28} />}
        {high != null && <ReferenceLine y={high} stroke={color} strokeDasharray="2 2" strokeOpacity={0.28} />}
        <Area type="monotone" dataKey={dataKey}
          stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Bloque de métrica con número animado + sparkline ───────────────────────
function MetricBlock({ label, value, unit, metricKey, deviceColor, sparkData }) {
  const status = getStatus(metricKey, value);
  const sc     = STATUS_COLOR[status];

  return (
    <div className="flex flex-col gap-2">
      {/* Label + badge */}
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {label}
        </span>
        <motion.span
          layout
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
            padding: "2px 8px", borderRadius: 999,
            color: sc, background: `${sc}14`, border: `1px solid ${sc}28`,
          }}
        >
          {status}
        </motion.span>
      </div>

      {/* Animated number */}
      <div style={{ height: 44, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={value?.toFixed(2) ?? "null"}
            style={{ display: "flex", alignItems: "baseline", gap: 6 }}
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <span style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "2.5rem", fontWeight: 700, lineHeight: 1,
              color: sc, transition: "color 0.4s ease",
            }}>
              {value != null ? value.toFixed(2) : "—"}
            </span>
            {unit && <span style={{ fontSize: 13, color: "#4b5563" }}>{unit}</span>}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Sparkline */}
      <Sparkline data={sparkData} dataKey={metricKey} color={deviceColor} />
    </div>
  );
}

// ── Tarjeta de dispositivo ─────────────────────────────────────────────────
function DeviceCard({ id, dev, history }) {
  const cfg    = DEVICES[id];
  const online = !!dev?.timestamp;
  const spark  = history.filter(r => r.id === id).slice(-80);

  return (
    <motion.div
      className="flex flex-col gap-4 flex-1"
      style={{
        minWidth: 220,
        borderRadius: 20, padding: 20,
        background: "rgba(17,24,39,0.75)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${online ? cfg.color + "28" : "#1f2937"}`,
        boxShadow: online ? `0 0 36px ${cfg.color}10` : "none",
        transition: "border-color 0.6s ease, box-shadow 0.6s ease",
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Device header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {online ? (
            <span className="relative flex" style={{ width: 8, height: 8 }}>
              <span className="animate-ping absolute inset-0 rounded-full opacity-60"
                style={{ background: cfg.color }} />
              <span className="relative rounded-full w-full h-full"
                style={{ background: cfg.color }} />
            </span>
          ) : (
            <span className="rounded-full" style={{ width: 8, height: 8, background: "#374151" }} />
          )}
          <span style={{
            fontFamily: "ui-monospace, monospace", fontSize: 11,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: online ? cfg.color : "#374151",
          }}>
            {id}
          </span>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 10px", borderRadius: 999,
          ...(online
            ? { color: cfg.color, background: `${cfg.color}12`, border: `1px solid ${cfg.color}25` }
            : { color: "#374151", background: "#111827",         border: "1px solid #1f2937" }
          ),
        }}>
          {cfg.label}{!online && " · offline"}
        </span>
      </div>

      {/* Separator */}
      <div style={{ height: 1, background: `${cfg.color}18` }} />

      {/* pH */}
      <MetricBlock label="pH" value={dev?.pH} unit="" metricKey="pH"
        deviceColor={cfg.color} sparkData={spark} />

      {/* Separator */}
      <div style={{ height: 1, background: "#1f2937" }} />

      {/* DO */}
      <MetricBlock label="Oxígeno Disuelto" value={dev?.DO} unit="mg/L" metricKey="DO"
        deviceColor={cfg.color} sparkData={spark} />

      {/* Temperature footer */}
      {dev?.temp != null && (
        <div className="flex items-center" style={{
          marginTop: "auto", paddingTop: 10,
          borderTop: "1px solid #1f2937",
        }}>
          <span style={{ fontSize: 11, color: "#4b5563" }}>Temperatura</span>
          <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#9ca3af" }}>
            {dev.temp.toFixed(1)} °C
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ── Gráfica de área con gradiente por dispositivo ──────────────────────────
function SensorChart({ title, dataKey, unit, domain, refLines, history }) {
  return (
    <div style={{
      background: "rgba(17,24,39,0.6)", border: "1px solid #1f2937",
      borderRadius: 20, padding: 20,
    }}>
      <h3 style={{
        margin: "0 0 16px 0", fontSize: 11, color: "#6b7280",
        letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <defs>
            {Object.entries(DEVICES).map(([id, cfg]) => (
              <linearGradient key={id} id={`ac-${id}-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={cfg.color} stopOpacity={0}   />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="time" tickFormatter={TICK_FMT}
            tick={{ fill: "#4b5563", fontSize: 10 }} minTickGap={40} allowDuplicatedCategory={false} />
          <YAxis domain={domain} tick={{ fill: "#4b5563", fontSize: 10 }} width={32} />
          <Tooltip
            contentStyle={{ background: "#0f172a", border: "1px solid #1f2937", borderRadius: 10, fontSize: 12 }}
            labelFormatter={v => new Date(v).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            formatter={(v, name) => [`${v?.toFixed(2)}${unit}`, DEVICES[name]?.label ?? name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={n => DEVICES[n]?.label ?? n} />
          {refLines.map(y => (
            <ReferenceLine key={y} y={y} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.4} />
          ))}
          {Object.entries(DEVICES).map(([id, cfg]) => (
            <Area key={id}
              data={history.filter(r => r.id === id)}
              type="monotone" dataKey={dataKey} name={id}
              stroke={cfg.color} fill={`url(#ac-${id}-${dataKey})`}
              strokeWidth={2} dot={false} isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [devices, setDevices]     = useState({});
  const [history, setHistory]     = useState([]);
  const [connected, setConnected] = useState(false);
  const [log, setLog]             = useState([]);
  const [temp, setTemp]           = useState("25.0");
  const ws = useRef(null);

  const addLog = msg =>
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
      sock.onmessage = e => {
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

  const sendCmd = async cmd => {
    await fetch(`${API}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd }),
    });
    addLog(`Enviado: ${cmd}`);
  };

  const water  = devices["pH_DO_1"]?.temp ?? devices["pH_DO_2"]?.temp;
  const lastTs = devices["pH_DO_1"]?.timestamp ?? devices["pH_DO_2"]?.timestamp;

  return (
    <div style={{ minHeight: "100vh", background: "#030712", color: "#f9fafb", padding: 24, fontFamily: "system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <header className="flex items-start justify-between" style={{ marginBottom: 32 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>Algae Monitor</h1>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6b7280" }}>
            pH + Oxígeno Disuelto · Tratamiento de aguas residuales
          </p>
        </div>
        <div className="flex items-center gap-4">
          {water != null && (
            <span style={{ color: "#9ca3af", fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
              🌡 {water.toFixed(1)} °C
            </span>
          )}
          <motion.div
            className="flex items-center gap-2"
            style={{ fontSize: 12, fontWeight: 600, padding: "6px 14px", borderRadius: 999, border: "1px solid" }}
            animate={{
              color:           connected ? "#4ade80" : "#f87171",
              borderColor:     connected ? "#4ade8035" : "#f8717135",
              backgroundColor: connected ? "#4ade8010" : "#f8717110",
            }}
            transition={{ duration: 0.4 }}
          >
            {connected ? (
              <span className="relative flex" style={{ width: 8, height: 8, flexShrink: 0 }}>
                <span className="animate-ping absolute inset-0 rounded-full bg-green-400 opacity-70" />
                <span className="relative rounded-full w-full h-full bg-green-400" />
              </span>
            ) : (
              <span className="rounded-full bg-red-400" style={{ width: 8, height: 8, flexShrink: 0 }} />
            )}
            {connected ? "En línea" : "Sin conexión"}
          </motion.div>
        </div>
      </header>

      {/* ── Device cards + Summary ── */}
      <section className="flex flex-wrap gap-4" style={{ marginBottom: 24 }}>
        {Object.keys(DEVICES).map(id => (
          <DeviceCard key={id} id={id} dev={devices[id]} history={history} />
        ))}

        {/* Summary */}
        <div style={{
          flex: 1, minWidth: 190,
          background: "rgba(17,24,39,0.6)", border: "1px solid #1f2937",
          borderRadius: 20, padding: 20,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Resumen
          </span>
          {Object.entries(DEVICES).flatMap(([id, cfg]) => {
            const dev = devices[id];
            return [
              { key: "pH", val: dev?.pH, label: `pH · ${cfg.label}`,  dcolor: cfg.color },
              { key: "DO", val: dev?.DO, label: `DO · ${cfg.label}`,  dcolor: cfg.color },
            ];
          }).map(({ key, val, label, dcolor }, i) => {
            const sc = STATUS_COLOR[getStatus(key, val)];
            return (
              <motion.div
                key={i} layout
                className="flex justify-between items-center"
                style={{
                  padding: "6px 12px", borderRadius: 10,
                  background: `${sc}0a`, border: `1px solid ${sc}1a`,
                  transition: "background 0.5s, border-color 0.5s",
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="rounded-full" style={{ width: 6, height: 6, background: dcolor, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#9ca3af" }}>{label}</span>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: sc }}>{getStatus(key, val)}</span>
              </motion.div>
            );
          })}
          <div style={{ marginTop: "auto", fontSize: 11, color: "#374151", paddingTop: 8 }}>
            {lastTs
              ? `Última: ${new Date(lastTs).toLocaleTimeString("es-CO")}`
              : "Esperando Arduino..."}
          </div>
        </div>
      </section>

      {/* ── Charts ── */}
      <section className="grid grid-cols-2 gap-4" style={{ marginBottom: 24 }}>
        <SensorChart title="pH — últimas 24h"               dataKey="pH" unit=""      domain={[5, 10]} refLines={[7.0, 8.5]} history={history} />
        <SensorChart title="Oxígeno Disuelto — últimas 24h" dataKey="DO" unit=" mg/L" domain={[0, 16]} refLines={[6, 12]}    history={history} />
      </section>

      {/* ── Commands + Log ── */}
      <section className="flex flex-wrap gap-4">
        {/* Commands */}
        <div style={{
          minWidth: 240,
          background: "rgba(17,24,39,0.6)", border: "1px solid #1f2937",
          borderRadius: 20, padding: 20,
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Comandos
          </span>

          <div className="flex items-center gap-2">
            <span style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>Temp (°C)</span>
            <input value={temp} onChange={e => setTemp(e.target.value)} style={{
              width: 60, background: "#111827", border: "1px solid #374151",
              borderRadius: 8, color: "#fff", padding: "5px 8px",
              fontSize: 12, fontFamily: "ui-monospace, monospace",
              outline: "none",
            }} />
            <CmdBtn onClick={() => sendCmd(`TEMP:${temp}`)}>Set</CmdBtn>
          </div>

          <div className="flex flex-wrap gap-2">
            <CmdBtn onClick={() => sendCmd("DOCAL")}   color="#3b82f6">Cal. DO</CmdBtn>
            <CmdBtn onClick={() => sendCmd("ENTERPH")} color="#22c55e">pH iniciar</CmdBtn>
            <CmdBtn onClick={() => sendCmd("CALPH")}   color="#22c55e">pH punto</CmdBtn>
            <CmdBtn onClick={() => sendCmd("EXITPH")}  color="#22c55e">pH guardar</CmdBtn>
          </div>
        </div>

        {/* Log */}
        <div style={{
          flex: 1,
          background: "rgba(17,24,39,0.6)", border: "1px solid #1f2937",
          borderRadius: 20, padding: 20,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Log
          </span>
          <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
            <AnimatePresence initial={false}>
              {log.length === 0 ? (
                <span style={{ fontSize: 12, color: "#374151" }}>Sin eventos...</span>
              ) : (
                log.map(entry => (
                  <motion.span
                    key={entry}
                    style={{ fontSize: 11, color: "#6b7280", fontFamily: "ui-monospace, monospace" }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    {entry}
                  </motion.span>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>
    </div>
  );
}

function CmdBtn({ onClick, children, color = "#22c55e" }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", fontSize: 12, fontWeight: 600,
      borderRadius: 8, cursor: "pointer", border: `1px solid ${color}30`,
      background: `${color}12`, color,
      transition: "background 0.2s",
    }}
      onMouseEnter={e => e.target.style.background = `${color}22`}
      onMouseLeave={e => e.target.style.background = `${color}12`}
    >
      {children}
    </button>
  );
}
