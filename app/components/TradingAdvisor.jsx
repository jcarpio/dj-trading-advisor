"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const HISTORY_KEY     = "dj_trading_history";
const SESSION_KEY     = "dj_session";
const MAX_HISTORY     = 30;
const MAX_LOG         = 50;
const SESSION_MINUTES = 30;
const MAX_LOSS_USD    = 20;
const TARGET_USD      = 40;
const USD_PER_POINT   = 0.05;
const PROX_THRESHOLD  = 30; // points to trigger "approaching" warning

const diaToUS30 = (price) => Math.round(parseFloat(price) * 100);

const MA_BASE = "https://api.massive.com";
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);
const maUrl = (path, key) =>
  `${MA_BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`;

// ─── Session ──────────────────────────────────────────────────────────────────
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s) return null;
    if (s.date !== new Date().toDateString()) return null;
    return s;
  } catch { return null; }
}
function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function newSession()   { return { date: new Date().toDateString(), pnl: 0, ops: 0 }; }

function loadHistory()  { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY))); } catch {} }

function formatTime(dt) {
  return new Date(dt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function formatDate(dt) {
  return new Date(dt).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ─── Candle analysis ──────────────────────────────────────────────────────────
function analyzeCandle(bars) {
  if (!bars || bars.length < 2) return [];
  const msgs = [];
  const c = bars[0]; // latest (most recent first from TD)
  const p = bars[1]; // previous

  const o  = parseFloat(c.open),  h  = parseFloat(c.high);
  const l  = parseFloat(c.low),   cl = parseFloat(c.close);
  const po = parseFloat(p.open),  pcl= parseFloat(p.close);
  const body    = Math.abs(cl - o);
  const range   = h - l;
  const upWick  = h - Math.max(o, cl);
  const downWick= Math.min(o, cl) - l;
  const bullish = cl > o;
  const bearish = cl < o;

  // Engulfing
  if (bullish && pcl < po && cl > po && o < pcl)
    msgs.push({ type: "signal", icon: "🕯️", text: "Vela envolvente alcista — señal de reversión al alza" });
  if (bearish && pcl > po && cl < po && o > pcl)
    msgs.push({ type: "signal", icon: "🕯️", text: "Vela envolvente bajista — señal de reversión a la baja" });

  // Hammer / hanging man
  if (downWick > body * 2 && upWick < body * 0.5 && range > 0)
    msgs.push({ type: "signal", icon: "🔨", text: bullish ? "Martillo alcista — posible suelo" : "Hombre colgado — vigilar reversión" });

  // Shooting star / inverted hammer
  if (upWick > body * 2 && downWick < body * 0.5 && range > 0)
    msgs.push({ type: "signal", icon: "⭐", text: bearish ? "Estrella fugaz — posible techo" : "Martillo invertido — confirmación pendiente" });

  // Doji
  if (body < range * 0.1 && range > 0)
    msgs.push({ type: "info", icon: "◈", text: "Doji — indecisión del mercado, espera confirmación" });

  // Strong momentum candle
  if (body > range * 0.8 && range > 0) {
    msgs.push({ type: bullish ? "bull" : "bear", icon: bullish ? "▲" : "▼",
      text: `Vela de momentum ${bullish ? "alcista" : "bajista"} fuerte (${Math.round(diaToUS30(cl) - diaToUS30(o))} pts)` });
  }

  return msgs;
}

function proximityMessages(us30, levels, signal) {
  if (!levels) return [];
  const msgs = [];
  const { entry, sl, tp } = levels;

  if (entry) {
    const dist = Math.abs(us30 - entry);
    if (dist <= PROX_THRESHOLD && dist > 0) {
      const dir = us30 < entry ? "por debajo" : "por encima";
      msgs.push({ type: "warn", icon: "⚡",
        text: `${dist} pts del nivel de entrada (${entry.toLocaleString()} pts) — ${dir} · PREPÁRATE` });
    }
    if (dist <= 5) {
      msgs.push({ type: "signal", icon: "🎯",
        text: `¡PRECIO EN ZONA DE ENTRADA! (${entry.toLocaleString()} pts) · Busca confirmación en la vela` });
    }
  }

  if (sl && Math.abs(us30 - sl) <= PROX_THRESHOLD)
    msgs.push({ type: "danger", icon: "🛑", text: `Cerca del stop loss (${sl.toLocaleString()} pts) — ${Math.abs(us30 - sl)} pts de distancia` });

  if (tp && Math.abs(us30 - tp) <= PROX_THRESHOLD)
    msgs.push({ type: "profit", icon: "💰", text: `Cerca del objetivo (${tp.toLocaleString()} pts) — ${Math.abs(us30 - tp)} pts de distancia` });

  return msgs;
}

function trendMessage(us30, prev, signal) {
  if (!prev) return null;
  const diff = us30 - prev;
  if (Math.abs(diff) < 3) return { type: "info", icon: "→", text: `Precio lateral (±${Math.abs(diff)} pts desde última vela)` };
  const dir = diff > 0 ? "subiendo" : "bajando";
  const agree = (diff > 0 && signal === "BUY") || (diff < 0 && signal === "SELL");
  return {
    type: agree ? "bull" : "info",
    icon: diff > 0 ? "▲" : "▼",
    text: `Precio ${dir} ${Math.abs(diff)} pts ${agree ? "— ✓ en línea con la señal" : "— contra la señal, paciencia"}`
  };
}

// ─── Audio ────────────────────────────────────────────────────────────────────
function playAlert(type = "entry") {
  try {
    const ctx   = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = type === "entry"  ? [523, 659, 784, 1047] :
                  type === "warn"   ? [440, 550]            :
                  type === "profit" ? [784, 1047, 1319]     : [400, 300];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.frequency.value = f; osc.type = "sine";
      g.gain.setValueAtTime(0.22, ctx.currentTime + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.13 + 0.28);
      osc.start(ctx.currentTime + i * 0.13);
      osc.stop(ctx.currentTime  + i * 0.13 + 0.28);
    });
  } catch {}
}

function notify(title, body) {
  if (!("Notification" in window)) return;
  const send = () => new Notification(title, { body, icon: "/favicon.ico" });
  if (Notification.permission === "granted") send();
  else Notification.requestPermission().then(p => { if (p === "granted") send(); });
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const SIG = {
  BUY:  { bg: "#0d2e1a", text: "#4ade80", border: "#166534" },
  SELL: { bg: "#2e0d0d", text: "#f87171", border: "#991b1b" },
  HOLD: { bg: "#2e220d", text: "#fbbf24", border: "#92400e" },
  "N/A":{ bg: "#111",    text: "#555",    border: "#222"    },
};

const LOG_STYLES = {
  signal: { color: "#60a5fa", border: "#1d4ed8" },
  warn:   { color: "#fbbf24", border: "#92400e" },
  danger: { color: "#f87171", border: "#991b1b" },
  profit: { color: "#4ade80", border: "#166534" },
  bull:   { color: "#4ade80", border: "#166534" },
  bear:   { color: "#f87171", border: "#991b1b" },
  info:   { color: "#888",    border: "#222"    },
  poll:   { color: "#555",    border: "#1a1a1a" },
};

function extractSignal(txt) {
  const m = txt.match(/\b(BUY|SELL|HOLD)\b/i);
  return m ? m[1].toUpperCase() : "N/A";
}
function extractLevels(txt) {
  const entry = txt.match(/[Ee]ntrada[:\s]+([0-9.]+)/);
  const sl    = txt.match(/[Ss]top[:\s]+([0-9.]+)/);
  const tp    = txt.match(/[Oo]bjetivo[:\s]+([0-9.]+)/);
  return {
    entry: entry ? Math.round(parseFloat(entry[1])) : null,
    sl:    sl    ? Math.round(parseFloat(sl[1]))    : null,
    tp:    tp    ? Math.round(parseFloat(tp[1]))    : null,
  };
}

// ─── Components ───────────────────────────────────────────────────────────────
function Badge({ signal, pulse }) {
  const s = SIG[signal] || SIG["N/A"];
  return (
    <span style={{
      background: s.bg, color: s.text, border: `0.5px solid ${s.border}`,
      borderRadius: 6, padding: "3px 12px", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.1em", fontFamily: "monospace",
      animation: pulse ? "blink 0.7s ease-in-out infinite alternate" : "none",
    }}>{signal}</span>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "9px 11px",
      border: "0.5px solid #222", display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: color || "#e8e8e8" }}>{value}</span>
      {sub && <span style={{ fontSize: 9, color: "#4ade80" }}>{sub}</span>}
    </div>
  );
}

function RiskBar({ pnl }) {
  const lossPct = Math.min(Math.abs(Math.min(pnl, 0)) / MAX_LOSS_USD * 50, 50);
  const gainPct = Math.min(Math.max(pnl, 0) / TARGET_USD * 50, 50);
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase" }}>
          P&L hoy · <span style={{ color: pnl >= 0 ? "#4ade80" : "#f87171", fontWeight: 600 }}>
            {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USD
          </span>
        </span>
        <span style={{ fontSize: 10, color: "#444" }}>-${MAX_LOSS_USD} ← 0 → +${TARGET_USD}</span>
      </div>
      <div style={{ background: "#111", borderRadius: 4, height: 5, position: "relative", overflow: "hidden", border: "0.5px solid #222" }}>
        {pnl < 0 && <div style={{ position: "absolute", right: "50%", top: 0, height: "100%", width: `${lossPct}%`, background: "#f87171" }} />}
        {pnl > 0 && <div style={{ position: "absolute", left:  "50%", top: 0, height: "100%", width: `${gainPct}%`, background: "#4ade80" }} />}
        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "#333" }} />
      </div>
    </div>
  );
}

function Countdown({ seconds }) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  const color = seconds < 300 ? "#f87171" : seconds < 600 ? "#fbbf24" : "#4ade80";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: "monospace", fontSize: 12, color, fontWeight: 700 }}>
        {String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}
      </span>
      <div style={{ flex: 1, background: "#0a0a0a", borderRadius: 3, height: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${seconds / (SESSION_MINUTES * 60) * 100}%`, background: color, transition: "width 1s linear" }} />
      </div>
    </div>
  );
}

function LogEntry({ entry }) {
  const s = LOG_STYLES[entry.type] || LOG_STYLES.info;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 10px",
      borderLeft: `2px solid ${s.border}`, background: "#0a0a0a", borderRadius: "0 5px 5px 0" }}>
      <span style={{ fontSize: 12, minWidth: 18 }}>{entry.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: s.color, lineHeight: 1.5 }}>{entry.text}</span>
      </div>
      <span style={{ fontSize: 9, color: "#333", whiteSpace: "nowrap", paddingTop: 2 }}>{entry.time}</span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TradingAdvisor() {
  const [massiveKey, setMassiveKey] = useState("");
  const [ticker,     setTicker]     = useState("DIA");

  const [phase,      setPhase]      = useState("idle");
  const [context,    setContext]    = useState(null);
  const [loading,    setLoading]    = useState("");
  const [error,      setError]      = useState("");

  const [livePrice,    setLivePrice]    = useState(null);
  const [priceHistory, setPriceHistory] = useState([]); // últimos 100 precios IBKR
  const [prevUS30,   setPrevUS30]   = useState(null);
  const [alertFired, setAlertFired] = useState(false);
  const [pollCount,  setPollCount]  = useState(0);
  const [nextPoll,   setNextPoll]   = useState(20);
  const [log,        setLog]        = useState([]);

  const [session,    setSession]    = useState(() => loadSession() || newSession());
  const [sessionSec, setSessionSec] = useState(SESSION_MINUTES * 60);
  const [ops,        setOps]        = useState([]);

  const [history,    setHistory]    = useState([]);
  const [expanded,   setExpanded]   = useState(null);

  const pollRef    = useRef(null);
  const countRef   = useRef(null);
  const sessionRef = useRef(null);
  const alertRef   = useRef(false);
  const prevRef    = useRef(null);

  useEffect(() => { setHistory(loadHistory()); }, []);
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default")
      Notification.requestPermission();
  }, []);

  // ── Log helper ────────────────────────────────────────────────────────────
  const addLog = useCallback((entries) => {
    const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const stamped = (Array.isArray(entries) ? entries : [entries]).map(e => ({ ...e, time }));
    setLog(prev => [...stamped, ...prev].slice(0, MAX_LOG));
  }, []);

  // ── Session countdown ────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "monitoring") {
      setSessionSec(SESSION_MINUTES * 60);
      sessionRef.current = setInterval(() => {
        setSessionSec(prev => {
          if (prev <= 1) { stopAll("⏱ Tiempo de sesión agotado (30 min). Monitorización detenida."); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(sessionRef.current);
    }
    return () => clearInterval(sessionRef.current);
  }, [phase]);

  function stopAll(msg = "") {
    clearInterval(pollRef.current);
    clearInterval(countRef.current);
    clearInterval(sessionRef.current);
    setPhase("idle");
    if (msg) { setError(msg); addLog({ type: "info", icon: "⏹", text: msg }); }
  }

  // ── Risk check ────────────────────────────────────────────────────────────
  const checkRisk = useCallback((sess) => {
    if (sess.pnl <= -MAX_LOSS_USD) {
      stopAll(`🛑 Pérdida máxima diaria alcanzada (-$${MAX_LOSS_USD}). Sesión bloqueada.`);
      setPhase("blocked");
      return false;
    }
    if (sess.pnl >= TARGET_USD) {
      stopAll(`🎯 Objetivo diario alcanzado (+$${TARGET_USD}). ¡Cierra MT5 y a vivir!`);
      playAlert("profit");
      notify("🎯 Objetivo alcanzado", `+$${sess.pnl.toFixed(2)} hoy. Cierra sesión.`);
      return false;
    }
    return true;
  }, []);

  // ── PHASE 1: Context ──────────────────────────────────────────────────────
  const getContext = useCallback(async () => {
    if (!massiveKey.trim()) { setError("Introduce tu API key de Massive."); return; }
    setError(""); setLog([]); setLoading("Obteniendo contexto histórico (Massive)...");

    const tfs = [
      { id: "1W", path: `/v2/aggs/ticker/${ticker}/range/1/week/${daysAgo(84)}/${TODAY}?adjusted=true&sort=asc&limit=12` },
      { id: "1D", path: `/v2/aggs/ticker/${ticker}/range/1/day/${daysAgo(30)}/${TODAY}?adjusted=true&sort=asc&limit=30` },
      { id: "1H", path: `/v2/aggs/ticker/${ticker}/range/1/hour/${daysAgo(2)}/${TODAY}?adjusted=true&sort=asc&limit=24` },
    ];

    const tfData = {};
    for (const tf of tfs) {
      try {
        const res  = await fetch(maUrl(tf.path, massiveKey));
        const data = await res.json();
        tfData[tf.id] = data?.results || [];
        addLog({ type: "info", icon: "📊", text: `${tf.id}: ${data?.results?.length || 0} barras obtenidas de Massive` });
      } catch { tfData[tf.id] = []; addLog({ type: "danger", icon: "✗", text: `${tf.id}: error al obtener datos` }); }
      await new Promise(r => setTimeout(r, 220));
    }

    setLoading("Analizando con Claude (1 llamada)...");
    addLog({ type: "info", icon: "🤖", text: "Enviando datos históricos a Claude para análisis de contexto..." });

    const summarize = (bars, id) => {
      if (!bars.length) return `${id}: sin datos`;
      const closes = bars.map(b => b.c).filter(Boolean);
      const last   = bars[bars.length - 1];
      const trend  = closes.length > 1 ? (closes[closes.length-1] > closes[0] ? "alcista" : "bajista") : "N/A";
      const hs = bars.map(b => b.h).filter(Boolean), ls = bars.map(b => b.l).filter(Boolean);
      return `${id}: tendencia ${trend}, cierre $${last.c?.toFixed(2)} (US30 ~${diaToUS30(last.c)} pts), máx ${diaToUS30(Math.max(...hs))} pts, mín ${diaToUS30(Math.min(...ls))} pts, ${bars.length} barras`;
    };

    // Include live IBKR price if available
    let ibkrLine = "";
    try {
      const ibRes  = await fetch("http://localhost:3001/price?symbol=YM", { signal: AbortSignal.timeout(10000) });
      const ibData = await ibRes.json();
      if (ibData.last && ibData.last > 0) {
        ibkrLine = `\nPRECIO ACTUAL EN TIEMPO REAL (IBKR YM): ${ibData.last} pts · Bid:${ibData.bid} Ask:${ibData.ask} · H:${ibData.high} L:${ibData.low} · Vol:${ibData.volume}`;
        addLog({ type: "info", icon: "📡", text: `Precio IBKR incluido en análisis: ${ibData.last} pts` });
      } else if (ibData.high) {
        ibkrLine = `\nMERCADO CERRADO — Última sesión: H:${ibData.high} L:${ibData.low} Vol:${ibData.volume}`;
      }
    } catch {}

    const prompt = `Eres analista de CFDs. El trader opera US30/DJIA en MT5 con lotes 0.05 ($0.05/punto).

PARÁMETROS DE RIESGO:
- Stop loss máx: $10 por op (200 puntos US30)
- Take profit obj: $20 por op (400 puntos US30)
- Pérdida máx diaria: $20 | Objetivo diario: $40

DATOS HISTÓRICOS (DIA ETF, DIA×100 ≈ puntos US30):
${Object.entries(tfData).map(([id, bars]) => summarize(bars, id)).join("\n")}${ibkrLine}

Responde:
1. Señal: BUY, SELL o HOLD (primera palabra).
2. Tendencia macro (1W), operativa (1D), estructura intraday (1H).
3. Niveles clave en puntos US30:
   - Resistencias: R1, R2, R3
   - Soportes: S1, S2, S3
4. Condición exacta de entrada en vela de 1min.
5. "Entrada: XXXXX" (número entero, puntos US30)
6. "Stop: XXXXX" (máx 200 pts del entrada)
7. "Objetivo: XXXXX" (máx 400 pts del entrada)
8. Invalidación: qué anula la señal.

Usa solo números enteros para los niveles. El trader mirará el gráfico 1min durante 20 min.`;

    try {
      const res  = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text   = data?.content?.map(b => b.text || "").join("") || "";
      const signal = extractSignal(text);
      const levels = extractLevels(text);

      const ctx = { signal, levels, analysis: text, time: new Date().toISOString() };
      setContext(ctx);

      addLog([
        { type: "info",   icon: "✅", text: `Contexto obtenido — Señal: ${signal}` },
        levels.entry ? { type: "info", icon: "→", text: `Entrada: ${levels.entry?.toLocaleString()} pts US30` } : null,
        levels.sl    ? { type: "danger", icon: "🛑", text: `Stop loss: ${levels.sl?.toLocaleString()} pts` }   : null,
        levels.tp    ? { type: "profit", icon: "💰", text: `Objetivo: ${levels.tp?.toLocaleString()} pts` }    : null,
      ].filter(Boolean));

      const hist  = loadHistory();
      const entry = { id: Date.now(), date: new Date().toISOString(), ticker, signal,
        price: levels.entry || "—", target: levels.tp ? `${levels.tp} pts` : null, summary: text.slice(0, 500) };
      saveHistory([entry, ...hist]);
      setHistory([entry, ...hist].slice(0, MAX_HISTORY));
      setLoading("");
    } catch (e) {
      setError(`Error Claude: ${e.message}`);
      addLog({ type: "danger", icon: "✗", text: `Error Claude: ${e.message}` });
      setLoading("");
    }
  }, [massiveKey, ticker, addLog]);

  // ── RE-ANALYZE with current IBKR price ────────────────────────────────────
  const reanalyze = useCallback(async () => {
    if (!context) { setError("Obtén primero el contexto (Paso 1)."); return; }
    setLoading("Re-analizando con precio actual IBKR...");
    setError("");
    try {
      // Get current IBKR price
      let ibkrLine = "Sin datos de precio en tiempo real";
      try {
        const ibRes  = await fetch("http://localhost:3001/price?symbol=YM", { signal: AbortSignal.timeout(10000) });
        const ibData = await ibRes.json();
        if (ibData.last && ibData.last > 0) {
          ibkrLine = `Precio actual YM: ${ibData.last} pts · Bid:${ibData.bid} Ask:${ibData.ask} · H:${ibData.high} L:${ibData.low} · Vol:${ibData.volume}`;
        }
      } catch {}

      // Summarize price history
      const histSummary = priceHistory.length > 0
        ? (() => {
            const prices = priceHistory.map(p => p.price);
            const pFirst = prices[0];
            const pLast  = prices[prices.length - 1];
            const pMax   = Math.max(...prices);
            const pMin   = Math.min(...prices);
            const trend  = pLast > pFirst ? "subiendo" : pLast < pFirst ? "bajando" : "lateral";
            const series = priceHistory.slice(-20).map(p => p.price).join(", ");
            return `${priceHistory.length} precios · Rango: ${pMin}–${pMax} pts · Tendencia: ${trend} (${pFirst}→${pLast})
Últimos 20: ${series}`;
          })()
        : "Sin historial (monitorización no iniciada)";

      const prompt = `Eres analista de CFDs. El trader opera US30/DJIA.

ANÁLISIS PREVIO (datos históricos Massive):
${context.analysis?.slice(0, 800) || "N/A"}

PRECIO ACTUAL EN TIEMPO REAL (IBKR):
${ibkrLine}

HISTORIAL INTRADAY IBKR (poll cada 20s, últimos ~33 min):
${histSummary}

Con estos datos actualizados, revisa tu análisis anterior.
Usa el historial para detectar momentum y tendencia intraday.
¿Sigue siendo válida la entrada en ${context.levels?.entry} pts?

Responde:
1. Señal actualizada: BUY, SELL o HOLD (primera palabra)
2. ¿Sigue válido el análisis previo? ¿Qué ha cambiado?
3. Tendencia intraday según historial de precios.
4. "Entrada: XXXXX" (puntos US30, entero)
5. "Stop: XXXXX" (máx 200 pts)
6. "Objetivo: XXXXX" (máx 400 pts)
7. Invalidación actualizada.`;

      const res  = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const text   = data?.content?.map(b => b.text || "").join("") || "";
      const signal = extractSignal(text);
      const levels = extractLevels(text);

      const ctx = { signal, levels, analysis: text, time: new Date().toISOString() };
      setContext(ctx);
      addLog([
        { type: "info",   icon: "🔄", text: `Re-análisis completado — Señal: ${signal}` },
        levels.entry ? { type: "info",   icon: "→",  text: `Entrada: ${levels.entry?.toLocaleString()} pts US30` } : null,
        levels.sl    ? { type: "danger", icon: "🛑", text: `Stop loss: ${levels.sl?.toLocaleString()} pts` }       : null,
        levels.tp    ? { type: "profit", icon: "💰", text: `Objetivo: ${levels.tp?.toLocaleString()} pts` }        : null,
      ].filter(Boolean));
      setLoading("");
    } catch (e) {
      setError(`Error re-análisis: ${e.message}`);
      setLoading("");
    }
  }, [context, priceHistory, addLog]);

  // ── PHASE 2: Monitor ──────────────────────────────────────────────────────
  const startMonitoring = useCallback(() => {
    if (!context)       { setError("Obtén primero el contexto (Paso 1)."); return; }
    if (phase === "blocked") { setError("Sesión bloqueada por pérdida máxima."); return; }

    const sess = loadSession() || newSession();
    if (!checkRisk(sess)) return;
    if (sess.ops >= 2) { setError("Máximo 2 operaciones diarias alcanzado."); return; }

    saveSession(sess); setSession(sess);
    alertRef.current = false;
    setAlertFired(false);
    setPollCount(0);
    setPhase("monitoring");
    setNextPoll(20);
    setLog(prev => [{ type: "info", icon: "▶", text: "Monitorización iniciada · Fuente: IBKR Bridge (localhost:3001) · poll cada 20s", time: new Date().toLocaleTimeString("es-ES") }, ...prev]);

    const poll = async () => {
      try {
        // Intenta IBKR Bridge primero (datos reales YM)
        // Obtener precio desde IBKR Bridge (localhost:3001)
        // Requiere que "node server.js" esté corriendo en ~/ibkr-bridge
        const ibRes  = await fetch("http://localhost:3001/price?symbol=YM", { signal: AbortSignal.timeout(25000) });
        const ibData = await ibRes.json();

        if (!ibData.last || ibData.last <= 0) {
          // El bridge responde pero sin precio — mercado cerrado o fuera de horario
          const hasMarketData = ibData.high || ibData.low || ibData.volume;
          if (hasMarketData) {
            addLog({ type: "warn", icon: "🕐", text: `Mercado cerrado · Último H:${ibData.high} L:${ibData.low} · Vol:${(ibData.volume||0).toLocaleString()} · Reabre domingo 23:00 Madrid` });
          } else {
            addLog({ type: "danger", icon: "✗", text: "IBKR Bridge no responde. Asegúrate de que 'node server.js' está corriendo en ~/ibkr-bridge" });
          }
          return;
        }

        const us30      = Math.round(ibData.last);
        const high      = Math.round(ibData.high   || ibData.last);
        const low       = Math.round(ibData.low    || ibData.last);
        const volume    = ibData.volume || 0;
        const timeStr   = ibData.time   || new Date().toISOString();
        const sourceLabel = "IBKR";

        const prev = prevRef.current;

        setLivePrice({ us30, high, low, time: timeStr, volume, source: sourceLabel });
        setPrevUS30(prev);
        prevRef.current = us30;
        setPollCount(p => p + 1);
        // Guardar en historial circular (máx 100 precios)
        setPriceHistory(h => [...h.slice(-99), { price: us30, high, low, volume, time: timeStr }]);

        const entries = [];

        // Base poll entry
        entries.push({
          type: "poll", icon: "📡",
          text: `US30 ${us30.toLocaleString()} pts · H:${high} L:${low} · Vol:${(volume||0).toLocaleString()} · ${sourceLabel} · ${formatTime(timeStr)}`
        });

        // Trend vs previous
        if (prev) {
          const tm = trendMessage(us30, prev, context?.signal);
          if (tm) entries.push(tm);
        }

        // Proximity alerts
        const prox = proximityMessages(us30, context?.levels, context?.signal);
        prox.forEach(p => {
          entries.push(p);
          if (p.type === "warn") playAlert("warn");
        });


        // Entry signal check
        if (!alertRef.current && context?.levels?.entry) {
          const { entry, sl, tp } = context.levels;
          const triggered =
            (context.signal === "BUY"  && us30 >= entry) ||
            (context.signal === "SELL" && us30 <= entry);

          if (triggered) {
            alertRef.current = true;
            setAlertFired(true);
            playAlert("entry");
            notify(`🎯 ENTRADA ${context.signal}`, `US30 @ ${us30} pts · SL: ${sl} · TP: ${tp}`);
            entries.push({ type: "signal", icon: "🎯", text: `¡CONDICIÓN DE ENTRADA ALCANZADA! ${context.signal} @ ${us30.toLocaleString()} pts · SL: ${sl} · TP: ${tp} · Lote: 0.05` });
          }
        }

        addLog(entries);
      } catch (e) {
        addLog({ type: "danger", icon: "✗", text: `Error IBKR Bridge: ${e.message}` });
      }
    };

    poll();
    pollRef.current  = setInterval(poll, 20000);
    countRef.current = setInterval(() => setNextPoll(p => p <= 1 ? 20 : p - 1), 1000);
  }, [context, phase, ticker, checkRisk, addLog]);

  const stopMonitoring = () => {
    stopAll("");
    addLog({ type: "info", icon: "⏹", text: "Monitorización detenida manualmente." });
  };

  const registerOp = (side, result) => {
    const pnl  = result === "tp" ? 20 : result === "sl" ? -10 : 0;
    const sess = loadSession() || newSession();
    sess.pnl  += pnl;
    sess.ops  += 1;
    saveSession(sess);
    setSession({...sess});
    setOps(prev => [...prev, { side, result, pnl, time: new Date().toISOString() }]);
    addLog({ type: pnl > 0 ? "profit" : pnl < 0 ? "danger" : "info", icon: pnl > 0 ? "✅" : "❌",
      text: `Operación registrada: ${result === "tp" ? "Take Profit" : result === "sl" ? "Stop Loss" : "Manual"} · ${pnl >= 0 ? "+" : ""}${pnl} USD · Total hoy: ${pnl >= 0 ? "+" : ""}${sess.pnl.toFixed(2)} USD` });
    alertRef.current = false;
    setAlertFired(false);
    checkRisk(sess);
  };

  const busy    = !!loading;
  const blocked = phase === "blocked" || session.pnl <= -MAX_LOSS_USD;
  const goalHit = session.pnl >= TARGET_USD;

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "#1a1a1a", border: "0.5px solid #333", borderRadius: 7,
    color: "#e8e8e8", padding: "7px 10px", fontSize: 12,
    fontFamily: "monospace", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem", maxWidth: 780, margin: "0 auto", fontFamily: "monospace" }}>
      <style>{`
        @keyframes blink { from{opacity:1} to{opacity:0.35} }
        @keyframes glow  { from{box-shadow:0 0 8px #4ade8033} to{box-shadow:0 0 22px #4ade8077} }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: "1rem", borderBottom: "0.5px solid #1a1a1a", paddingBottom: "0.9rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#4ade80" }}>▲ DJ Trading Advisor</span>
          {context && <Badge signal={context.signal} pulse={phase === "monitoring" && alertFired} />}
          {phase === "monitoring" && (
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#4ade80",
              background: "#0d2e1a", border: "0.5px solid #166534", borderRadius: 5, padding: "2px 8px" }}>
              ● LIVE · poll #{pollCount} · sig. en {nextPoll}s
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 10, color: "#444" }}>
          Contexto: Massive (1W·1D·1H) · Tiempo real: IBKR Bridge (YM) · US30 CFD · MT5
        </p>
      </div>

      <RiskBar pnl={session.pnl} />

      {blocked && !goalHit && (
        <div style={{ background: "#2e0d0d", border: "0.5px solid #991b1b", borderRadius: 8,
          padding: "9px 13px", marginBottom: "1rem", fontSize: 12, color: "#f87171" }}>
          🛑 Sesión bloqueada — pérdida máxima diaria alcanzada (-${MAX_LOSS_USD}). Vuelve mañana.
        </div>
      )}
      {goalHit && (
        <div style={{ background: "#0d2e1a", border: "0.5px solid #166534", borderRadius: 8,
          padding: "9px 13px", marginBottom: "1rem", fontSize: 12, color: "#4ade80",
          animation: "glow 1.5s ease-in-out infinite alternate" }}>
          🎯 ¡Objetivo diario! +${session.pnl.toFixed(2)} USD en {session.ops} op{session.ops!==1?"s":""}. Cierra MT5. A vivir.
        </div>
      )}

      {/* Keys */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8, marginBottom: "0.9rem" }}>
        <div>
          <label style={{ fontSize: 9, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Massive API Key</label>
          <input type="password" value={massiveKey} onChange={e => setMassiveKey(e.target.value)} placeholder="massive_key..." style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 9, color: "#555", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Ticker</label>
          <input value={ticker} onChange={e => setTicker(e.target.value)} style={inputStyle} />
        </div>
      </div>

      {error && (
        <div style={{ background: "#2e0d0d", border: "0.5px solid #991b1b", borderRadius: 7,
          padding: "7px 12px", marginBottom: "0.9rem", fontSize: 12, color: "#f87171",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* Phase buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: "1rem" }}>
        <button onClick={getContext} disabled={busy || blocked} style={{
          padding: "9px", fontSize: 12, cursor: busy || blocked ? "not-allowed" : "pointer",
          background: busy ? "#111" : "#0d2e1a", color: busy ? "#444" : "#4ade80",
          border: `0.5px solid ${busy ? "#1a1a1a" : "#166534"}`, borderRadius: 8, fontWeight: 600,
        }}>
          {loading ? `⟳ ${loading}` : "① Analizar contexto  (Massive + Claude)"}
        </button>

        <button onClick={phase === "monitoring" ? stopMonitoring : startMonitoring}
          disabled={busy || blocked || !context} style={{
          padding: "9px", fontSize: 12,
          cursor: (busy || blocked || !context) ? "not-allowed" : "pointer",
          background: phase === "monitoring" ? "#2e0d0d" : !context ? "#111" : "#0a1f3d",
          color:  phase === "monitoring" ? "#f87171" : !context ? "#333" : "#60a5fa",
          border: `0.5px solid ${phase === "monitoring" ? "#991b1b" : !context ? "#1a1a1a" : "#1d4ed8"}`,
          borderRadius: 8, fontWeight: 600,
        }}>
          {phase === "monitoring" ? "⏹ Detener monitorización" : "② Iniciar monitorización 1min"}
        </button>
      </div>

      {/* Session timer */}
      {phase === "monitoring" && (
        <div style={{ background: "#111", border: "0.5px solid #1a1a1a", borderRadius: 7,
          padding: "8px 12px", marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 9, color: "#444", textTransform: "uppercase" }}>Tiempo restante de sesión</span>
            <span style={{ fontSize: 9, color: "#333" }}>Ops: {session.ops}/2 · Sig. poll: {nextPoll}s</span>
          </div>
          <Countdown seconds={sessionSec} />
        </div>
      )}

      {/* Live price */}
      {livePrice && (
        <div style={{ marginBottom: "0.9rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6 }}>
            <Stat label="US30 equiv." value={`${livePrice.us30.toLocaleString()}`} color="#4ade80" sub="puntos" />
            <Stat label="Vol. YM"     value={livePrice.volume ? livePrice.volume.toLocaleString() : "—"} />
            <Stat label="Rango vela"  value={`${livePrice.low}–${livePrice.high}`} color="#888" />
            <Stat label={`Historial · ${priceHistory.length}/100`} value={formatTime(livePrice.time)} color={priceHistory.length >= 10 ? "#4ade80" : "#555"} />
          </div>
        </div>
      )}

      {/* Alert banner */}
      {alertFired && context && (
        <div style={{ background: SIG[context.signal]?.bg, border: `1px solid ${SIG[context.signal]?.border}`,
          borderRadius: 10, padding: "1rem 1.25rem", marginBottom: "0.9rem",
          animation: "glow 1.2s ease-in-out infinite alternate" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: SIG[context.signal]?.text }}>
              {context.signal === "BUY" ? "▲" : "▼"} ¡SEÑAL DE ENTRADA!
            </span>
            <Badge signal={context.signal} pulse />
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: SIG[context.signal]?.text }}>
            US30 @ {livePrice?.us30?.toLocaleString()} pts · Lote 0.05 · SL: {context.levels?.sl?.toLocaleString()} pts · TP: {context.levels?.tp?.toLocaleString()} pts
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "#555" }}>Registra el resultado cuando cierres la operación:</p>
          <div style={{ display: "flex", gap: 6 }}>
            {[["✅ TP +$20", "tp"], ["❌ SL -$10", "sl"], ["↩ Manual", "manual"]].map(([l, r]) => (
              <button key={r} onClick={() => registerOp(context.signal, r)}
                style={{ flex: 1, padding: "7px", fontSize: 11, cursor: "pointer", borderRadius: 6,
                  background: "transparent", border: `0.5px solid ${SIG[context.signal]?.border}`,
                  color: SIG[context.signal]?.text, fontFamily: "monospace" }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Context */}
      {context && (
        <div style={{ background: "#111", border: "0.5px solid #1e1e1e", borderRadius: 9,
          padding: "0.9rem 1.1rem", marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: "#444", textTransform: "uppercase" }}>
              Contexto Claude · {formatDate(context.time)}
            </span>
            <Badge signal={context.signal} />
          </div>
          {context.levels?.entry && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 8 }}>
              {[["Entrada", context.levels.entry, "#60a5fa"],
                ["Stop",   context.levels.sl,    "#f87171"],
                ["Objetivo", context.levels.tp,  "#4ade80"]].map(([l, v, c]) => v && (
                <div key={l} style={{ background: "#0a0a0a", borderRadius: 5, padding: "5px 9px", border: `0.5px solid ${c}22` }}>
                  <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", marginBottom: 1 }}>{l} (pts US30)</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{v.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
          <details>
            <summary style={{ fontSize: 10, color: "#555", cursor: "pointer" }}>Ver análisis completo</summary>
            <p style={{ fontSize: 11, lineHeight: 1.7, color: "#666", margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{context.analysis}</p>
          </details>
        </div>
      )}

      {/* Live log */}
      {log.length > 0 && (
        <div style={{ marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 9, color: "#444", textTransform: "uppercase" }}>Feed en tiempo real · {log.length} eventos</span>
            <button onClick={() => setLog([])} style={{ fontSize: 9, background: "none", border: "0.5px solid #222",
              color: "#444", borderRadius: 4, padding: "1px 7px", cursor: "pointer" }}>Limpiar</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 320,
            overflowY: "auto", paddingRight: 4 }}>
            {log.map((entry, i) => <LogEntry key={i} entry={entry} />)}
          </div>
        </div>
      )}

      {/* Ops log */}
      {ops.length > 0 && (
        <div style={{ marginBottom: "0.9rem" }}>
          <p style={{ fontSize: 9, color: "#444", textTransform: "uppercase", margin: "0 0 5px" }}>
            Operaciones de hoy · {session.ops}/2 · P&L total: {session.pnl >= 0 ? "+" : ""}{session.pnl.toFixed(2)} USD
          </p>
          {ops.map((op, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8,
              background: "#111", borderRadius: 6, padding: "6px 10px", marginBottom: 4,
              border: `0.5px solid ${op.pnl > 0 ? "#166534" : op.pnl < 0 ? "#991b1b" : "#222"}` }}>
              <Badge signal={op.side} />
              <span style={{ fontSize: 10, color: "#555", flex: 1 }}>
                {op.result === "tp" ? "Take Profit" : op.result === "sl" ? "Stop Loss" : "Manual"}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: op.pnl > 0 ? "#4ade80" : op.pnl < 0 ? "#f87171" : "#555" }}>
                {op.pnl > 0 ? "+" : ""}{op.pnl} USD
              </span>
              <span style={{ fontSize: 9, color: "#333" }}>{formatTime(op.time)}</span>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ borderTop: "0.5px solid #1a1a1a", paddingTop: "0.9rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontSize: 9, color: "#444", textTransform: "uppercase" }}>Historial · {history.length} sesiones</span>
            <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); }}
              style={{ fontSize: 9, background: "none", border: "0.5px solid #222", color: "#444",
                borderRadius: 4, padding: "1px 7px", cursor: "pointer" }}>Borrar</button>
          </div>
          {history.map((h, i) => (
            <div key={h.id} style={{ background: "#111", border: "0.5px solid #1a1a1a", borderRadius: 6, overflow: "hidden", marginBottom: 3 }}>
              <div onClick={() => setExpanded(expanded === i ? null : i)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 11px", cursor: "pointer" }}>
                <Badge signal={h.signal} />
                <span style={{ fontSize: 10, color: "#666", flex: 1 }}>{h.ticker}</span>
                <span style={{ fontSize: 10, color: "#444" }}>{h.price && `entrada ${h.price} pts`}</span>
                <span style={{ fontSize: 9, color: "#333" }}>{formatDate(h.date)}</span>
                <span style={{ fontSize: 9, color: "#222" }}>{expanded === i ? "▲" : "▼"}</span>
              </div>
              {expanded === i && (
                <div style={{ borderTop: "0.5px solid #1a1a1a", padding: "7px 11px" }}>
                  <p style={{ fontSize: 10, lineHeight: 1.7, color: "#555", margin: 0, whiteSpace: "pre-wrap" }}>{h.summary}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: "1.5rem", fontSize: 9, color: "#1a1a1a", textAlign: "center" }}>
        No constituye asesoramiento financiero · Solo uso personal
      </p>
    </div>
  );
}
