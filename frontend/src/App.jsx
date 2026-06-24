import { useState, useEffect, useRef, useMemo } from "react";
import {
  motion, AnimatePresence,
  useSpring, useTransform, useInView,
} from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";

// ── Config ─────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS  = (import.meta.env.VITE_API_URL || "http://localhost:8000")
              .replace(/^http/, "ws") + "/ws";

const RANGES = {
  pH: { low: 7.0, high: 8.5, unit: "" },
  DO: { low: 6.0, high: 12,  unit: " mg/L" },
};

const DEVICES = {
  "pH_DO_1": { label: "H-101",   color: "#22c55e" },
  "pH_DO_2": { label: "DFRobot", color: "#a78bfa" },
};

const STATUS_COLOR = {
  "ÓPTIMO":    "#22c55e",
  "ALERTA":    "#f59e0b",
  "CRÍTICO":   "#ef4444",
  "SIN DATOS": "#2a4a5e",
};

const TICK_FMT = ts => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ── Helpers ────────────────────────────────────────────────────────────────
function getStatus(key, val) {
  if (val == null) return "SIN DATOS";
  const { low, high } = RANGES[key];
  if (val >= low && val <= high) return "ÓPTIMO";
  if (val < low - 1 || val > high + 1) return "CRÍTICO";
  return "ALERTA";
}

function logColor(entry) {
  if (entry.includes("Conectado")) return "#22c55e";
  if (entry.includes("Reconectando") || entry.includes("error")) return "#f59e0b";
  if (entry.includes("Enviado")) return "#0891b2";
  return "#5a8a9f";
}

// ── Page stagger variants ──────────────────────────────────────────────────
const page = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const item = {
  hidden:  { opacity: 0, y: 22, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0,  filter: "blur(0px)",
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

// ── Decorative: floating bubbles ───────────────────────────────────────────
function BubbleField() {
  const bubbles = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: i,
      left:     `${6 + Math.random() * 88}%`,
      size:     5 + Math.random() * 14,
      duration: 14 + Math.random() * 18,
      delay:    -(Math.random() * 22),
    })), []);

  return (
    <div aria-hidden="true" style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden",
    }}>
      {bubbles.map(b => (
        <div key={b.id} className="bubble" style={{
          position: "absolute", bottom: "-24px", left: b.left,
          width: b.size, height: b.size, borderRadius: "50%",
          border: "1px solid #00e5c314",
          background: "radial-gradient(circle at 30% 30%, #00e5c316, transparent)",
          animationDuration: `${b.duration}s`,
          animationDelay: `${b.delay}s`,
        }} />
      ))}
    </div>
  );
}

// ── Decorative: animated divider ───────────────────────────────────────────
function WaterDivider() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-30px" });
  return (
    <div ref={ref} style={{ position: "relative", height: 14, margin: "4px 0" }} aria-hidden="true">
      <motion.div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%,-50%)",
        height: 1, width: "100%",
        background: "linear-gradient(to right, transparent, #00e5c3, #0891b2, transparent)",
        originX: 0.5,
      }}
        initial={{ scaleX: 0, opacity: 0 }}
        animate={inView ? { scaleX: 1, opacity: 1 } : {}}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div style={{
        position: "absolute", top: "calc(50% + 4px)", left: "50%",
        transform: "translateX(-50%)",
        height: 5, width: "42%",
        background: "linear-gradient(to right, transparent, #00e5c3, #0891b2, transparent)",
        filter: "blur(5px)", opacity: 0.18, originX: 0.5,
      }}
        initial={{ scaleX: 0 }}
        animate={inView ? { scaleX: 1 } : {}}
        transition={{ duration: 1.1, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

// ── Decorative: seaweed icon ───────────────────────────────────────────────
function AlgaeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M11 20 Q11 15 11 10 Q11 5 11 2" stroke="#00e5c3" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M11 16 Q8 13 6 10"  stroke="#00e5c370" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M11 12 Q8 9 5 7"   stroke="#00e5c350" strokeWidth="1"   strokeLinecap="round"/>
      <path d="M11 14 Q14 11 16 8" stroke="#00e5c370" strokeWidth="1.2" strokeLinecap="round"/>
      <path d="M11 10 Q14 7 17 5"  stroke="#00e5c350" strokeWidth="1"   strokeLinecap="round"/>
      <circle cx="11" cy="20" r="1.2" fill="#00e5c3"/>
    </svg>
  );
}

// ── RangeBar ────────────────────────────────────────────────────────────────
function RangeBar({ value, metricKey }) {
  const { low, high } = RANGES[metricKey];
  const targetPct = value != null
    ? Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100))
    : 0;
  const spring = useSpring(targetPct, { stiffness: 110, damping: 22 });
  const width  = useTransform(spring, v => `${Math.max(0, v).toFixed(1)}%`);
  useEffect(() => { spring.set(targetPct); }, [targetPct]);

  const sc = STATUS_COLOR[getStatus(metricKey, value)];
  return (
    <div style={{ height: 3, borderRadius: 999, background: "#0a2540", overflow: "hidden" }}>
      <motion.div style={{
        height: "100%", width, borderRadius: 999,
        background: sc, boxShadow: `0 0 6px ${sc}55`,
      }} />
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ data, dataKey, color }) {
  const { low, high } = RANGES[dataKey] || {};
  const gid = `sg-${dataKey}-${color.slice(1)}`;
  if (!data.length) return <div style={{ height: 44 }} />;
  return (
    <ResponsiveContainer width="100%" height={44}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        {low  != null && <ReferenceLine y={low}  stroke={color} strokeDasharray="2 2" strokeOpacity={0.25} />}
        {high != null && <ReferenceLine y={high} stroke={color} strokeDasharray="2 2" strokeOpacity={0.25} />}
        <Area type="monotone" dataKey={dataKey}
          stroke={color} strokeWidth={1.5}
          fill={`url(#${gid})`}
          dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── MetricBlock ─────────────────────────────────────────────────────────────
function MetricBlock({ label, value, unit, metricKey, deviceColor, sparkData }) {
  const status = getStatus(metricKey, value);
  const sc     = STATUS_COLOR[status];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Label + badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "#5a8a9f", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          {label}
        </span>
        <motion.span
          className={status === "CRÍTICO" ? "badge-critical" : ""}
          animate={{ color: sc, backgroundColor: `${sc}14`, borderColor: `${sc}28` }}
          transition={{ duration: 0.4 }}
          style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "2px 8px", borderRadius: 999, border: "1px solid",
          }}
        >
          {status}
        </motion.span>
      </div>

      {/* Animated value */}
      <div style={{ height: 44, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={value?.toFixed(2) ?? "null"}
            style={{ display: "flex", alignItems: "baseline", gap: 6 }}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.span
              animate={{ color: sc }}
              transition={{ duration: 0.4 }}
              style={{
                fontFamily: "ui-monospace,monospace",
                fontSize: "clamp(1.85rem, 4.5vw, 2.65rem)", fontWeight: 700, lineHeight: 1,
              }}
            >
              {value != null ? value.toFixed(2) : "—"}
            </motion.span>
            {unit && <span style={{ fontSize: 12, color: "#2a4a5e" }}>{unit}</span>}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Range bar siempre visible; sparkline solo en sm+ */}
      <RangeBar value={value} metricKey={metricKey} />
      <div className="hidden sm:block">
        <Sparkline data={sparkData} dataKey={metricKey} color={deviceColor} />
      </div>
    </div>
  );
}

// ── DeviceCard ──────────────────────────────────────────────────────────────
function DeviceCard({ id, dev, history }) {
  const cfg    = DEVICES[id];
  const online = !!dev?.timestamp;
  const spark  = history.filter(r => r.id === id).slice(-80);

  // Data-arrival pulse
  const prevTs = useRef(null);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (dev?.timestamp && dev.timestamp !== prevTs.current) {
      prevTs.current = dev.timestamp;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 700);
      return () => clearTimeout(t);
    }
  }, [dev?.timestamp]);

  return (
    <motion.div
      className="flex flex-col gap-4"
      style={{
        borderRadius: 20, padding: "clamp(14px,3vw,20px)",
        background: "rgba(5,15,26,0.85)",
        backdropFilter: "blur(10px)",
        border: `1px solid ${online ? cfg.color + "28" : "#0a2540"}`,
        transition: "border-color 0.6s ease",
      }}
      animate={{
        boxShadow: pulse
          ? `0 0 0 1px ${cfg.color}55, 0 0 28px ${cfg.color}22`
          : online
            ? `0 0 0 1px ${cfg.color}18, 0 0 24px ${cfg.color}0c`
            : "none",
      }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      whileHover={{
        y: -4,
        boxShadow: `0 8px 32px ${cfg.color}20, 0 0 0 1px ${cfg.color}35`,
        transition: { duration: 0.2 },
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {online ? (
            <span className="relative flex" style={{ width: 8, height: 8, flexShrink: 0 }}>
              <span className="animate-ping absolute inset-0 rounded-full opacity-60"
                style={{ background: cfg.color }} />
              <span className="relative rounded-full w-full h-full"
                style={{ background: cfg.color }} />
            </span>
          ) : (
            <span className="rounded-full" style={{ width: 8, height: 8, background: "#0a2540", flexShrink: 0 }} />
          )}
          <span style={{
            fontFamily: "ui-monospace,monospace", fontSize: 10,
            textTransform: "uppercase", letterSpacing: "0.14em",
            color: online ? cfg.color : "#1a3550",
          }}>
            {id}
          </span>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999,
          ...(online
            ? { color: cfg.color, background: `${cfg.color}12`, border: `1px solid ${cfg.color}25` }
            : { color: "#1a3550",  background: "#050f1a",         border: "1px solid #0a2540" }
          ),
        }}>
          {cfg.label}{!online && " · offline"}
        </span>
      </div>

      <div style={{ height: 1, background: `${cfg.color}18` }} />

      <MetricBlock label="pH" value={dev?.pH} unit="" metricKey="pH"
        deviceColor={cfg.color} sparkData={spark} />

      <div style={{ height: 1, background: "#071624" }} />

      <MetricBlock label="Oxígeno Disuelto" value={dev?.DO} unit="mg/L" metricKey="DO"
        deviceColor={cfg.color} sparkData={spark} />

      {dev?.temp != null && (
        <div style={{
          display: "flex", alignItems: "center",
          marginTop: "auto", paddingTop: 12,
          borderTop: "1px solid #071624",
        }}>
          <span style={{ fontSize: 11, color: "#2a4a5e" }}>🌡 Temperatura</span>
          <span style={{
            marginLeft: "auto", fontSize: 11,
            fontFamily: "ui-monospace,monospace", color: "#5a8a9f",
          }}>
            {dev.temp.toFixed(1)} °C
          </span>
        </div>
      )}
    </motion.div>
  );
}

// ── ChartModal ──────────────────────────────────────────────────────────────
function ChartModal({ chart, history, onClose }) {
  // Cerrar con Escape
  useEffect(() => {
    const handler = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "clamp(12px,3vw,32px)",
        background: "rgba(2,11,18,0.85)",
        backdropFilter: "blur(8px)",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        style={{
          width: "100%", maxWidth: 900,
          background: "rgba(5,15,26,0.98)", border: "1px solid #0d3b5e",
          borderRadius: 24, padding: "clamp(16px,3vw,28px)",
          boxShadow: "0 24px 80px rgba(0,229,195,0.06), 0 0 0 1px #00e5c310",
        }}
        initial={{ scale: 0.94, opacity: 0, y: 16 }}
        animate={{ scale: 1,    opacity: 1, y: 0  }}
        exit={{ scale: 0.94,    opacity: 0, y: 16 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e2f0f7", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {chart.title}
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#2a4a5e", fontStyle: "italic" }}>
              {chart.subtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "#071624", border: "1px solid #0a2540",
              color: "#5a8a9f", borderRadius: 10,
              width: 32, height: 32, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Línea divisora */}
        <div style={{ height: 1, background: "linear-gradient(to right, transparent, #00e5c330, transparent)", marginBottom: 20 }} />

        {/* Device legend pills */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {Object.entries(DEVICES).map(([id, cfg]) => {
            const dev_history = history.filter(r => r.id === id);
            const last = dev_history[dev_history.length - 1];
            const val  = last?.[chart.dataKey];
            const status = getStatus(chart.dataKey, val);
            const sc = STATUS_COLOR[status];
            return (
              <div key={id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 12px", borderRadius: 999,
                background: `${cfg.color}10`, border: `1px solid ${cfg.color}25`,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.color }} />
                <span style={{ fontSize: 11, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                {val != null && (
                  <>
                    <span style={{ fontSize: 13, fontFamily: "ui-monospace,monospace", color: sc, fontWeight: 700 }}>
                      {val.toFixed(2)}{chart.unit}
                    </span>
                    <span style={{ fontSize: 9, color: sc, fontWeight: 700, letterSpacing: "0.08em" }}>{status}</span>
                  </>
                )}
              </div>
            );
          })}
          <div style={{ marginLeft: "auto", fontSize: 10, color: "#2a4a5e", alignSelf: "center" }}>
            Zona óptima entre líneas naranjas
          </div>
        </div>

        {/* Chart grande */}
        <ResponsiveContainer width="100%" height={window.innerHeight < 600 ? 260 : 420}>
          <AreaChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <defs>
              {Object.entries(DEVICES).map(([id, cfg]) => (
                <linearGradient key={id} id={`mc-${id}-${chart.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={cfg.color} stopOpacity={0}   />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#071624" />
            <XAxis dataKey="time" tickFormatter={TICK_FMT}
              tick={{ fill: "#2a4a5e", fontSize: 10 }} minTickGap={30} allowDuplicatedCategory={false} />
            <YAxis domain={chart.domain} tick={{ fill: "#2a4a5e", fontSize: 10 }} width={36} />
            <Tooltip
              contentStyle={{
                background: "#050f1a", border: "1px solid #0a2540",
                borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              }}
              labelFormatter={v => new Date(v).toLocaleTimeString("es-CO", {
                hour: "2-digit", minute: "2-digit", second: "2-digit",
              })}
              formatter={(v, name) => [`${v?.toFixed(2)}${chart.unit}`, DEVICES[name]?.label ?? name]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#5a8a9f" }}
              formatter={n => DEVICES[n]?.label ?? n} />
            {chart.refLines.map(y => (
              <ReferenceLine key={y} y={y} stroke="#f59e0b" strokeDasharray="5 4" strokeOpacity={0.45} />
            ))}
            {Object.entries(DEVICES).map(([id, cfg]) => (
              <Area key={id}
                data={history.filter(r => r.id === id)}
                type="monotone" dataKey={chart.dataKey} name={id}
                stroke={cfg.color} fill={`url(#mc-${id}-${chart.dataKey})`}
                strokeWidth={2.5} dot={false} isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </motion.div>
    </motion.div>
  );
}

// ── SensorChart ─────────────────────────────────────────────────────────────
function SensorChart({ title, subtitle, dataKey, unit, domain, refLines, history, onExpand }) {
  return (
    <div style={{
      background: "rgba(5,15,26,0.8)", border: "1px solid #071624",
      borderRadius: 20, padding: 20,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 11, color: "#5a8a9f", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {title}
          </h3>
          <p style={{ margin: "3px 0 0", fontSize: 10, color: "#2a4a5e", fontStyle: "italic" }}>
            {subtitle}
          </p>
        </div>
        <motion.button
          onClick={onExpand}
          whileHover={{ scale: 1.1, color: "#00e5c3" }}
          whileTap={{ scale: 0.9 }}
          style={{
            background: "none", border: "1px solid #0a2540",
            color: "#2a4a5e", borderRadius: 8,
            width: 28, height: 28, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: 14,
          }}
          title="Expandir gráfica"
        >
          ⤢
        </motion.button>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <defs>
            {Object.entries(DEVICES).map(([id, cfg]) => (
              <linearGradient key={id} id={`ac-${id}-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.28} />
                <stop offset="95%" stopColor={cfg.color} stopOpacity={0}    />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#071624" />
          <XAxis dataKey="time" tickFormatter={TICK_FMT}
            tick={{ fill: "#2a4a5e", fontSize: 10 }} minTickGap={40} allowDuplicatedCategory={false} />
          <YAxis domain={domain} tick={{ fill: "#2a4a5e", fontSize: 10 }} width={32} />
          <Tooltip
            contentStyle={{
              background: "#050f1a", border: "1px solid #0a2540",
              borderRadius: 12, fontSize: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
            labelFormatter={v => new Date(v).toLocaleTimeString("es-CO", {
              hour: "2-digit", minute: "2-digit", second: "2-digit",
            })}
            formatter={(v, name) => [`${v?.toFixed(2)}${unit}`, DEVICES[name]?.label ?? name]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: "#5a8a9f" }}
            formatter={n => DEVICES[n]?.label ?? n} />
          {refLines.map(y => (
            <ReferenceLine key={y} y={y} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.35} />
          ))}
          {Object.entries(DEVICES).map(([id, cfg]) => (
            <Area key={id}
              data={history.filter(r => r.id === id)}
              type="monotone" dataKey={dataKey} name={id}
              stroke={cfg.color} fill={`url(#ac-${id}-${dataKey})`}
              strokeWidth={2.5} dot={false} isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── CmdBtn ──────────────────────────────────────────────────────────────────
function CmdBtn({ onClick, children, color = "#22c55e" }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05, backgroundColor: `${color}22` }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.14 }}
      style={{
        padding: "5px 12px", fontSize: 12, fontWeight: 600,
        borderRadius: 8, cursor: "pointer",
        border: `1px solid ${color}30`,
        background: `${color}12`, color,
      }}
    >
      {children}
    </motion.button>
  );
}

// ── EventLog ─────────────────────────────────────────────────────────────────
function EventLog({ log }) {
  return (
    <div style={{
      flex: 1,
      background: "rgba(5,15,26,0.8)", border: "1px solid #071624",
      borderRadius: 20, padding: 20,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <span style={{ fontSize: 10, color: "#5a8a9f", textTransform: "uppercase", letterSpacing: "0.12em" }}>
        Log de eventos
      </span>
      <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        <AnimatePresence initial={false}>
          {log.length === 0 ? (
            <span style={{ fontSize: 11, color: "#1a3550" }}>Sin eventos aún...</span>
          ) : log.map(entry => {
            const c = logColor(entry);
            return (
              <motion.div
                key={entry}
                style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: c, flexShrink: 0, marginTop: 4 }} />
                <span style={{ fontSize: 11, color: c, fontFamily: "ui-monospace,monospace", lineHeight: 1.5 }}>
                  {entry}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── PhCalButtons ─────────────────────────────────────────────────────────────
// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [devices, setDevices]         = useState({});
  const [history, setHistory]         = useState([]);
  const [connected, setConnected]     = useState(false);
  const [log, setLog]                 = useState([]);
  const [temp, setTemp]               = useState("25.0");
  const [expandedChart, setExpanded]  = useState(null);
  const ws = useRef(null);

  const addLog = msg =>
    setLog(l => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l].slice(0, 60));

  useEffect(() => {
    fetch(`${API}/api/history?hours=24`, {
      headers: { "ngrok-skip-browser-warning": "true" },
    })
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
        if (data.event) { addLog(`[Arduino] ${data.event}${data.msg ? ': ' + data.msg : ''}`); return; }
        const id = data.id || "unknown";
        setDevices(prev => ({ ...prev, [id]: data }));
        setHistory(h => [...h, { ...data, time: data.timestamp }].slice(-720));
      };
    }
    connect();
    return () => ws.current?.close();
  }, []);

  // ngrok-skip-browser-warning evita la página de advertencia de ngrok en APIs
  const HEADERS = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  };

  const sendCmd = async (cmd, deviceId) => {
    await fetch(`${API}/api/command`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ cmd, ...(deviceId ? { device_id: deviceId } : {}) }),
    });
    addLog(`Enviado: ${cmd}${deviceId ? ` → ${deviceId}` : ""}`);
  };

  const water  = devices["pH_DO_1"]?.temp ?? devices["pH_DO_2"]?.temp;
  const lastTs = devices["pH_DO_1"]?.timestamp ?? devices["pH_DO_2"]?.timestamp;

  return (
    <>
      <BubbleField />

      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", color: "#e2f0f7", padding: "clamp(14px,3vw,28px)" }}>
        <motion.div
          style={{ maxWidth: 1440, margin: "0 auto" }}
          variants={page} initial="hidden" animate="visible"
        >

          {/* ── Header ── */}
          <motion.header
            variants={item}
            className="flex items-start justify-between flex-wrap gap-3"
            style={{ marginBottom: 32 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AlgaeIcon />
              <div>
                <h1 style={{ margin: 0, fontSize: "clamp(17px,2.5vw,22px)", fontWeight: 700, letterSpacing: "-0.02em", color: "#e2f0f7" }}>
                  Sensores pH + OD
                </h1>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#2a4a5e" }}>
                  pH + Oxígeno Disuelto · Tratamiento de aguas residuales
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {water != null && (
                <span style={{ fontSize: 13, color: "#5a8a9f", fontFamily: "ui-monospace,monospace" }}>
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
                {lastTs && (
                  <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>
                    {new Date(lastTs).toLocaleTimeString("es-CO")}
                  </span>
                )}
              </motion.div>
            </div>
          </motion.header>

          {/* ── Device cards + Summary ── */}
          <motion.section variants={item}>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4" style={{ marginBottom: 8 }}>
              {Object.keys(DEVICES).map(id => (
                <DeviceCard key={id} id={id} dev={devices[id]} history={history} />
              ))}

              {/* Summary */}
              <div
                className="sm:col-span-2 xl:col-span-1"
                style={{
                  background: "rgba(5,15,26,0.8)", border: "1px solid #071624",
                  borderRadius: 20, padding: 20,
                  display: "flex", flexDirection: "column", gap: 10,
                }}
              >
                <span style={{ fontSize: 10, color: "#5a8a9f", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  Resumen del sistema
                </span>

                {Object.entries(DEVICES).flatMap(([id, cfg]) => {
                  const dev = devices[id];
                  return [
                    { key: "pH", val: dev?.pH, label: `pH · ${cfg.label}`,  dcolor: cfg.color },
                    { key: "DO", val: dev?.DO, label: `DO · ${cfg.label}`,  dcolor: cfg.color },
                  ];
                }).map(({ key, val, label, dcolor }, i) => {
                  const status = getStatus(key, val);
                  const sc = STATUS_COLOR[status];
                  return (
                    <motion.div key={i} layout
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "7px 12px", borderRadius: 10,
                        background: `${sc}09`, border: `1px solid ${sc}18`,
                        transition: "background 0.5s, border-color 0.5s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: dcolor, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: "#5a8a9f" }}>{label}</span>
                      </div>
                      <motion.span
                        animate={{ color: sc }}
                        transition={{ duration: 0.4 }}
                        style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}
                      >
                        {status}
                      </motion.span>
                    </motion.div>
                  );
                })}

                <div style={{ marginTop: "auto", fontSize: 10, color: "#1a3550", paddingTop: 10 }}>
                  {lastTs
                    ? `Última lectura: ${new Date(lastTs).toLocaleTimeString("es-CO")}`
                    : "Esperando Arduino..."}
                </div>
              </div>
            </div>
          </motion.section>

          <WaterDivider />

          {/* ── Charts ── */}
          <motion.section variants={item}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ marginBottom: 8 }}>
              <SensorChart
                title="pH · últimas 24h"
                subtitle="Potencial de Hidrógeno"
                dataKey="pH" unit=""
                domain={[5, 10]} refLines={[7.0, 8.5]} history={history}
                onExpand={() => setExpanded({ title: "pH · últimas 24h", subtitle: "Potencial de Hidrógeno", dataKey: "pH", unit: "", domain: [5, 10], refLines: [7.0, 8.5] })}
              />
              <SensorChart
                title="Oxígeno Disuelto · últimas 24h"
                subtitle="O₂ disuelto en agua"
                dataKey="DO" unit=" mg/L"
                domain={[0, 16]} refLines={[6, 12]} history={history}
                onExpand={() => setExpanded({ title: "Oxígeno Disuelto · últimas 24h", subtitle: "O₂ disuelto en agua", dataKey: "DO", unit: " mg/L", domain: [0, 16], refLines: [6, 12] })}
              />
            </div>
          </motion.section>

          <WaterDivider />

          {/* ── Commands + Log ── */}
          <motion.section variants={item}>
            <div className="flex flex-col sm:flex-row gap-4">

              {/* Commands */}
              <div style={{
                minWidth: 240,
                background: "rgba(5,15,26,0.8)", border: "1px solid #071624",
                borderRadius: 20, padding: 20,
                display: "flex", flexDirection: "column", gap: 14,
              }}>
                <span style={{ fontSize: 10, color: "#5a8a9f", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  Comandos
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#2a4a5e", whiteSpace: "nowrap" }}>Temp (°C)</span>
                  <input value={temp} onChange={e => setTemp(e.target.value)} style={{
                    width: 60, background: "#071624", border: "1px solid #0a2540",
                    borderRadius: 8, color: "#e2f0f7", padding: "5px 8px",
                    fontSize: 12, fontFamily: "ui-monospace,monospace", outline: "none",
                  }} />
                  <CmdBtn onClick={() => sendCmd(`TEMP:${temp}`)}>Set</CmdBtn>
                </div>

                {/* pH: 3 botones directos — el Arduino hace el ciclo completo */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#2a4a5e", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    Calibrar pH
                  </span>
                  <CmdBtn onClick={() => sendCmd("RESETCAL")} color="#ef4444">
                    Borrar EEPROM
                  </CmdBtn>
                  <CmdBtn onClick={() => sendCmd("CAL7")} color="#22c55e">
                    Calibrar pH 7
                  </CmdBtn>
                  <CmdBtn onClick={() => sendCmd("CAL4")} color="#f59e0b">
                    Calibrar pH 4
                  </CmdBtn>
                </div>

                {/* DO: un solo botón */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "#2a4a5e", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    Calibrar DO
                  </span>
                  <CmdBtn onClick={() => sendCmd("DOCAL")} color="#0891b2">
                    Cal. oxígeno
                  </CmdBtn>
                </div>
              </div>

              <EventLog log={log} />
            </div>
          </motion.section>

        </motion.div>
      </div>

      {/* ── Chart modal ── */}
      <AnimatePresence>
        {expandedChart && (
          <ChartModal
            chart={expandedChart}
            history={history}
            onClose={() => setExpanded(null)}
          />
        )}
      </AnimatePresence>

    </>
  );
}
