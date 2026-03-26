"use client";

import { useState, useCallback, useEffect, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const HISTORY_KEY     = "dj_trading_history";
const SESSION_KEY     = "dj_session";
const MAX_HISTORY     = 30;
const SESSION_MINUTES = 30;
const MAX_LOSS_USD    = 20;
const TARGET_USD      = 40;
const LOT_SIZE        = 0.05;   // per operation
const USD_PER_POINT   = 0.05;   // 0.05 lot × $1/point on US30 CFD

// DIA → US30 points conversion
const diaToUS30 = (price) => Math.round(parseFloat(price) * 100);

// ─── Twelve Data endpoints (real-time intraday) ────────────────────────────────
const TD_BASE = "https://api.twelvedata.com";
const tdUrl   = (endpoint, symbol, interval, outputsize, key) =>
  `${TD_BASE}/${endpoint}?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${key}`;

// ─── Massive endpoints (historical context) ───────────────────────────────────
const MA_BASE = "https://api.massive.com";
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);
const maUrl = (path, key) =>
  `${MA_BASE}${path}${path.includes("?") ? "&" : "?"}apiKey=${key}`;

// ─── Risk helpers ─────────────────────────────────────────────────────────────
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!s) return null;
    // reset if different day
    const today = new Date().toDateString();
    if (s.date !== today) return null;
    return s;
  } catch { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
}
function newSession() {
  return { date: new Date().toDateString(), pnl: 0, ops: 0, startTime: null };
}

function loadHistory()  { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function saveHistory(h) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY))); } catch {} }
function formatTime(iso) { return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
function formatDate(iso) { return new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }

// ─── Signal styles ─────────────────────────────────────────────────────────────
const SIG = {
  BUY:  { bg: "#0d2e1a", text: "#4ade80", border: "#166534" },
  SELL: { bg: "#2e0d0d", text: "#f87171", border: "#991b1b" },
  HOLD: { bg: "#2e220d", text: "#fbbf24", border: "#92400e" },
  "N/A":{ bg: "#111",    text: "#555",    border: "#222"    },
};

function extractSignal(txt) {
  const m = txt.match(/\b(BUY|SELL|HOLD)\b/i);
  return m ? m[1].toUpperCase() : "N/A";
}

function extractLevels(txt) {
  // look for entry, sl, tp in text
  const entry = txt.match(/entrada[:\s]+([0-9,.]+)/i);
  const sl    = txt.match(/stop[:\s]+([0-9,.]+)/i);
  const tp    = txt.match(/objetivo[:\s]+([0-9,.]+)/i);
  return {
    entry: entry ? parseFloat(entry[1].replace(",","")) : null,
    sl:    sl    ? parseFloat(sl[1].replace(",",""))    : null,
    tp:    tp    ? parseFloat(tp[1].replace(",",""))    : null,
  };
}

// ─── Audio alert ──────────────────────────────────────────────────────────────
function playAlert(type = "entry") {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const freqs = type === "entry"  ? [523, 659, 784, 1047] :
                  type === "profit" ? [784, 1047, 1319]      :
                                      [400, 300];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = f; osc.type = "sine";
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.25);
    });
  } catch {}
}

function notify(title, body) {
  if (!("Notification" in window)) return;
  const send = () => new Notification(title, { body, icon: "/favicon.ico" });
  if (Notification.permission === "granted") send();
  else Notification.requestPermission().then(p => { if (p === "granted") send(); });
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Badge({ signal, pulse }) {
  const s = SIG[signal] || SIG["N/A"];
  return (
    <span style={{
      background: s.bg, color: s.text, border: `0.5px solid ${s.border}`,
      borderRadius: 6, padding: "3px 14px", fontSize: 12, fontWeight: 700,
      letterSpacing: "0.1em", fontFamily: "monospace",
      animation: pulse ? "blink 0.8s ease-in-out infinite alternate" : "none",
    }}>{signal}</span>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "10px 12px",
      border: "0.5px solid #222", display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 600, fontFamily: "monospace", color: color || "#e8e8e8" }}>{value}</span>
      {sub && <span style={{ fontSize: 10, color: "#4ade80" }}>{sub}</span>}
    </div>
  );
}

function RiskBar({ pnl }) {
  const pct  = Math.abs(pnl) / MAX_LOSS_USD * 100;
  const tpct = Math.min(Math.max(pnl, 0) / TARGET_USD * 100, 100);
  const color = pnl < 0 ? "#f87171" : pnl > 0 ? "#4ade80" : "#555";
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          P&L diario · {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USD
        </span>
        <span style={{ fontSize: 10, color: "#555" }}>
          Máx. pérdida: ${MAX_LOSS_USD} · Objetivo: ${TARGET_USD}
        </span>
      </div>
      <div style={{ background: "#111", borderRadius: 4, height: 6, position: "relative", overflow: "hidden", border: "0.5px solid #222" }}>
        {pnl < 0 && (
          <div style={{ position: "absolute", right: "50%", top: 0, height: "100%",
            width: `${Math.min(pct, 100) / 2}%`, background: "#f87171", borderRadius: "4px 0 0 4px" }} />
        )}
        {pnl > 0 && (
          <div style={{ position: "absolute", left: "50%", top: 0, height: "100%",
            width: `${Math.min(tpct, 100) / 2}%`, background: "#4ade80", borderRadius: "0 4px 4px 0" }} />
        )}
        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "#333" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 9, color: "#f87171" }}>-${MAX_LOSS_USD}</span>
        <span style={{ fontSize: 9, color: "#4ade80" }}>+${TARGET_USD}</span>
      </div>
    </div>
  );
}

function Countdown({ seconds }) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  const pct = seconds / (SESSION_MINUTES * 60) * 100;
  const color = seconds < 300 ? "#f87171" : seconds < 600 ? "#fbbf24" : "#4ade80";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: "monospace", fontSize: 13, color, fontWeight: 600 }}>
        {String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}
      </span>
      <div style={{ flex: 1, background: "#111", borderRadius: 3, height: 4, border: "0.5px solid #222", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, transition: "width 1s linear" }} />
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TradingAdvisor() {
  const [massiveKey, setMassiveKey] = useState("");
  const [tdKey,      setTdKey]      = useState("");
  const [ticker,     setTicker]     = useState("DIA");

  // Phase 1: context
  const [phase,      setPhase]      = useState("idle"); // idle | context | monitoring | blocked
  const [context,    setContext]    = useState(null);   // { signal, levels, analysis }

  // Phase 2: monitoring
  const [livePrice,  setLivePrice]  = useState(null);
  const [alertFired, setAlertFired] = useState(false);
  const [lastCandle, setLastCandle] = useState(null);
  const [pollCount,  setPollCount]  = useState(0);
  const [nextPoll,   setNextPoll]   = useState(60);

  // Session / risk
  const [session,    setSession]    = useState(() => loadSession() || newSession());
  const [sessionSec, setSessionSec] = useState(SESSION_MINUTES * 60);
  const [ops,        setOps]        = useState([]); // [{side, entry, exit, pnl}]

  // UI
  const [error,      setError]      = useState("");
  const [loading,    setLoading]    = useState("");
  const [history,    setHistory]    = useState([]);
  const [expanded,   setExpanded]   = useState(null);

  const pollRef    = useRef(null);
  const countRef   = useRef(null);
  const sessionRef = useRef(null);

  useEffect(() => { setHistory(loadHistory()); }, []);
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default")
      Notification.requestPermission();
  }, []);

  // ── Session countdown ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "monitoring") {
      setSessionSec(SESSION_MINUTES * 60);
      sessionRef.current = setInterval(() => {
        setSessionSec(prev => {
          if (prev <= 1) { stopMonitoring("Tiempo de sesión agotado (30 min)"); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearInterval(sessionRef.current);
    }
    return () => clearInterval(sessionRef.current);
  }, [phase]);

  // ── Risk check ─────────────────────────────────────────────────────────────
  const checkRisk = useCallback((sess) => {
    if (sess.pnl <= -MAX_LOSS_USD) {
      stopMonitoring(`🛑 Pérdida máxima diaria alcanzada (-$${MAX_LOSS_USD}). Sesión bloqueada.`);
      setPhase("blocked");
      return false;
    }
    if (sess.pnl >= TARGET_USD) {
      stopMonitoring(`✅ Objetivo diario alcanzado (+$${TARGET_USD}). ¡Cierra y descansa!`);
      playAlert("profit");
      notify("🎯 Objetivo alcanzado", `+$${TARGET_USD} hoy. DJ Trading Advisor te sugiere cerrar la sesión.`);
      return false;
    }
    return true;
  }, []);

  // ── Stop monitoring ────────────────────────────────────────────────────────
  function stopMonitoring(reason = "") {
    clearInterval(pollRef.current);
    clearInterval(countRef.current);
    clearInterval(sessionRef.current);
    setPhase("idle");
    if (reason) setError(reason);
  }

  // ── PHASE 1: Get context from Massive + Claude ─────────────────────────────
  const getContext = useCallback(async () => {
    if (!massiveKey.trim()) { setError("Introduce tu API key de Massive."); return; }
    if (!tdKey.trim())      { setError("Introduce tu API key de Twelve Data."); return; }
    setError(""); setLoading("Obteniendo contexto histórico (Massive)...");

    // Fetch 1W, 1D, 4H from Massive
    const massiveTF = [
      { id: "1W", path: `/v2/aggs/ticker/${ticker}/range/1/week/${daysAgo(84)}/${TODAY}?adjusted=true&sort=asc&limit=12` },
      { id: "1D", path: `/v2/aggs/ticker/${ticker}/range/1/day/${daysAgo(30)}/${TODAY}?adjusted=true&sort=asc&limit=30` },
      { id: "4H", path: `/v2/aggs/ticker/${ticker}/range/4/hour/${daysAgo(5)}/${TODAY}?adjusted=true&sort=asc&limit=30` },
    ];

    const tfData = {};
    for (const tf of massiveTF) {
      try {
        const res  = await fetch(maUrl(tf.path, massiveKey));
        const data = await res.json();
        tfData[tf.id] = data?.results || [];
      } catch { tfData[tf.id] = []; }
      await new Promise(r => setTimeout(r, 220));
    }

    setLoading("Analizando contexto con Claude...");

    const summarize = (bars, id) => {
      if (!bars.length) return `${id}: sin datos`;
      const closes = bars.map(b => b.c).filter(Boolean);
      const last   = bars[bars.length - 1];
      const trend  = closes.length > 1 ? (closes[closes.length-1] > closes[0] ? "alcista" : "bajista") : "N/A";
      const highs  = bars.map(b => b.h).filter(Boolean);
      const lows   = bars.map(b => b.l).filter(Boolean);
      return `${id} (${bars.length} barras): tendencia ${trend}, cierre $${last.c?.toFixed(2)} (DJ ~${diaToUS30(last.c)} pts), máx período $${Math.max(...highs).toFixed(2)} (${diaToUS30(Math.max(...highs))} pts), mín período $${Math.min(...lows).toFixed(2)} (${diaToUS30(Math.min(...lows))} pts), vol última barra ${last.v?.toLocaleString()}`;
    };

    const summary = Object.entries(tfData).map(([id, bars]) => summarize(bars, id)).join("\n");

    const prompt = `Eres un analista experto en trading de CFDs de índices. El trader opera US30/DJIA en MT5 con Funding Pips.

PARÁMETROS DE RIESGO FIJOS:
- Lote: 0.05 por operación ($0.05/punto en US30)
- Máximo 2 operaciones al día
- Stop loss máximo: $10 por operación (200 puntos US30)
- Take profit objetivo: $20 por operación (400 puntos US30)
- Pérdida máxima diaria: $20 | Objetivo diario: $40

DATOS HISTÓRICOS DIA ETF (DIA × 100 ≈ puntos US30):
${summary}

Proporciona:
1. Señal de contexto: BUY, SELL o HOLD (primera línea).
2. Tendencia macro (1W) y tendencia operativa (1D y 4H).
3. Niveles clave en PUNTOS US30 (no en precio DIA):
   - Resistencias principales (2-3 niveles)
   - Soportes principales (2-3 niveles)
4. Condición de entrada en 1min: describe EXACTAMENTE qué debe ver el trader en el gráfico de 1min para entrar. Ejemplo: "Entra BUY si el precio supera X puntos con vela de confirmación alcista y cierre por encima de Y".
5. Nivel de entrada sugerido: "Entrada: XXXXX" (número exacto en puntos US30)
6. Stop loss: "Stop: XXXXX" (número exacto, máx 200 puntos del entrada)
7. Take profit: "Objetivo: XXXXX" (número exacto, máx 400 puntos del entrada)
8. Invalidación: condición que anula la señal.

Sé muy concreto con los números. El trader mirará el gráfico de 1min durante 20 minutos máximo buscando exactamente la condición que describes.`;

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

      // Save to history
      const hist = loadHistory();
      const entry = { id: Date.now(), date: new Date().toISOString(), ticker, signal, price: levels.entry || "—", target: levels.tp ? `${levels.tp} pts` : null, summary: text.slice(0, 500) };
      saveHistory([entry, ...hist]);
      setHistory([entry, ...hist].slice(0, MAX_HISTORY));

      setPhase("idle");
      setLoading("");
    } catch (e) {
      setError(`Error Claude: ${e.message}`);
      setLoading("");
    }
  }, [massiveKey, tdKey, ticker]);

  // ── PHASE 2: Poll 1min from Twelve Data ───────────────────────────────────
  const startMonitoring = useCallback(() => {
    if (!tdKey.trim())  { setError("Introduce tu API key de Twelve Data."); return; }
    if (!context)       { setError("Obtén primero el contexto (Fase 1)."); return; }
    if (phase === "blocked") { setError("Sesión bloqueada por pérdida máxima. Reinicia mañana."); return; }

    const sess = loadSession() || newSession();
    if (!checkRisk(sess)) return;
    if (sess.ops >= 2)    { setError("Máximo 2 operaciones al día alcanzado."); return; }

    sess.startTime = sess.startTime || new Date().toISOString();
    saveSession(sess);
    setSession(sess);
    setAlertFired(false);
    setPhase("monitoring");
    setNextPoll(60);

    const poll = async () => {
      try {
        const url = tdUrl("time_series", ticker, "1min", 10, tdKey);
        const res  = await fetch(url);
        const data = await res.json();
        if (data.status === "error") throw new Error(data.message);

        const bars   = data.values || [];
        const latest = bars[0];
        if (!latest) return;

        const close  = parseFloat(latest.close);
        const us30   = diaToUS30(close);
        setLivePrice({ dia: close.toFixed(2), us30, time: latest.datetime });
        setLastCandle(latest);
        setPollCount(p => p + 1);

        // Check entry condition (simple: price crosses entry level)
        if (!alertFired && context?.levels?.entry) {
          const { entry, sl, tp } = context.levels;
          const triggered =
            (context.signal === "BUY"  && us30 >= entry) ||
            (context.signal === "SELL" && us30 <= entry);

          if (triggered) {
            setAlertFired(true);
            playAlert("entry");
            notify(
              `🎯 SEÑAL DE ENTRADA ${context.signal}`,
              `US30 @ ${us30} pts · SL: ${sl} · TP: ${tp} · Lote: 0.05`
            );
          }
        }
      } catch (e) {
        setError(`Twelve Data: ${e.message}`);
      }
    };

    poll(); // immediate first poll
    pollRef.current = setInterval(poll, 60000);
    countRef.current = setInterval(() => setNextPoll(p => p <= 1 ? 60 : p - 1), 1000);

  }, [tdKey, context, phase, alertFired, ticker, checkRisk]);

  const stopMonitoringManual = () => stopMonitoring("");

  // ── Register operation result ──────────────────────────────────────────────
  const registerOp = (side, result) => {
    const pnl  = result === "tp" ? 20 : result === "sl" ? -10 : 0;
    const sess = loadSession() || newSession();
    sess.pnl  += pnl;
    sess.ops  += 1;
    saveSession(sess);
    setSession({...sess});
    setOps(prev => [...prev, { side, result, pnl, time: new Date().toISOString() }]);
    checkRisk(sess);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  const busy    = !!loading;
  const blocked = phase === "blocked" || session.pnl <= -MAX_LOSS_USD;
  const goalHit = session.pnl >= TARGET_USD;

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "#1a1a1a", border: "0.5px solid #333", borderRadius: 8,
    color: "#e8e8e8", padding: "7px 10px", fontSize: 12,
    fontFamily: "monospace", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem", maxWidth: 760, margin: "0 auto", fontFamily: "monospace" }}>
      <style>{`
        @keyframes blink { from { opacity:1 } to { opacity:0.4 } }
        @keyframes glow  { from { box-shadow:0 0 8px #4ade8044 } to { box-shadow:0 0 20px #4ade8099 } }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: "1.25rem", borderBottom: "0.5px solid #1a1a1a", paddingBottom: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#4ade80" }}>▲ DJ Trading Advisor</span>
          {context && <Badge signal={context.signal} pulse={phase === "monitoring" && alertFired} />}
          {phase === "monitoring" && (
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#4ade80",
              background: "#0d2e1a", border: "0.5px solid #166534", borderRadius: 6, padding: "2px 8px" }}>
              LIVE · {pollCount} polls
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "#444" }}>
          Contexto vía Massive · Tiempo real vía Twelve Data · US30 CFD MT5
        </p>
      </div>

      {/* Risk bar */}
      <RiskBar pnl={session.pnl} />

      {/* Blocked / Goal banners */}
      {blocked && (
        <div style={{ background: "#2e0d0d", border: "0.5px solid #991b1b", borderRadius: 8,
          padding: "10px 14px", marginBottom: "1rem", fontSize: 12, color: "#f87171" }}>
          🛑 Sesión bloqueada — pérdida máxima diaria alcanzada (${MAX_LOSS_USD}). Vuelve mañana.
        </div>
      )}
      {goalHit && (
        <div style={{ background: "#0d2e1a", border: "0.5px solid #166534", borderRadius: 8,
          padding: "10px 14px", marginBottom: "1rem", fontSize: 12, color: "#4ade80",
          animation: "glow 1.5s ease-in-out infinite alternate" }}>
          🎯 ¡Objetivo diario alcanzado! +${session.pnl.toFixed(2)} USD · {session.ops} op{session.ops !== 1 ? "s" : ""}. Cierra MT5 y a vivir.
        </div>
      )}

      {/* API Keys */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 8, marginBottom: "1rem" }}>
        <div>
          <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Massive Key</label>
          <input type="password" value={massiveKey} onChange={e => setMassiveKey(e.target.value)} placeholder="massive_api_key..." style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Twelve Data Key</label>
          <input type="password" value={tdKey} onChange={e => setTdKey(e.target.value)} placeholder="twelve_data_key..." style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 10, color: "#555", display: "block", marginBottom: 4, textTransform: "uppercase" }}>Ticker</label>
          <input value={ticker} onChange={e => setTicker(e.target.value)} style={inputStyle} />
        </div>
      </div>

      {error && (
        <div style={{ background: "#2e0d0d", border: "0.5px solid #991b1b", borderRadius: 8,
          padding: "8px 12px", marginBottom: "1rem", fontSize: 12, color: "#f87171" }}>
          {error}
          <button onClick={() => setError("")} style={{ marginLeft: 10, background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
      )}

      {/* Phase buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: "1.25rem" }}>
        <button onClick={getContext} disabled={busy || blocked} style={{
          padding: "10px", fontSize: 12, cursor: busy || blocked ? "not-allowed" : "pointer",
          background: busy ? "#111" : "#0d2e1a", color: busy ? "#444" : "#4ade80",
          border: `0.5px solid ${busy ? "#1a1a1a" : "#166534"}`, borderRadius: 8, fontWeight: 600,
        }}>
          {loading ? `⟳ ${loading}` : "① Analizar contexto (1W · 1D · 4H)"}
        </button>

        <button
          onClick={phase === "monitoring" ? stopMonitoringManual : startMonitoring}
          disabled={busy || blocked || !context}
          style={{
            padding: "10px", fontSize: 12,
            cursor: (busy || blocked || !context) ? "not-allowed" : "pointer",
            background: phase === "monitoring" ? "#2e0d0d" : (!context ? "#111" : "#0a1f3d"),
            color:  phase === "monitoring" ? "#f87171" : (!context ? "#333" : "#60a5fa"),
            border: `0.5px solid ${phase === "monitoring" ? "#991b1b" : !context ? "#1a1a1a" : "#1d4ed8"}`,
            borderRadius: 8, fontWeight: 600,
          }}>
          {phase === "monitoring" ? "⏹ Detener monitorización" : "② Iniciar monitorización 1min (Twelve Data)"}
        </button>
      </div>

      {/* Session timer */}
      {phase === "monitoring" && (
        <div style={{ background: "#111", border: "0.5px solid #1a1a1a", borderRadius: 8, padding: "10px 14px", marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "#555", textTransform: "uppercase" }}>Tiempo de sesión restante</span>
            <span style={{ fontSize: 10, color: "#444" }}>Siguiente poll: {nextPoll}s</span>
          </div>
          <Countdown seconds={sessionSec} />
        </div>
      )}

      {/* Live price */}
      {livePrice && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
            <Stat label="DIA precio" value={`$${livePrice.dia}`} />
            <Stat label="US30 equiv." value={`${livePrice.us30.toLocaleString()} pts`} color="#4ade80" />
            <Stat label="Última vela" value={formatTime(livePrice.time)} color="#555" />
          </div>
        </div>
      )}

      {/* Alert fired */}
      {alertFired && context && (
        <div style={{ background: SIG[context.signal]?.bg, border: `1px solid ${SIG[context.signal]?.border}`,
          borderRadius: 10, padding: "1rem 1.25rem", marginBottom: "1rem",
          animation: "glow 1.5s ease-in-out infinite alternate" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: SIG[context.signal]?.text }}>
              {context.signal === "BUY" ? "▲" : "▼"} SEÑAL DE ENTRADA DETECTADA
            </span>
            <Badge signal={context.signal} pulse />
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: SIG[context.signal]?.text }}>
            US30 @ {livePrice?.us30?.toLocaleString()} pts · Lote: 0.05 · SL: {context.levels?.sl} pts · TP: {context.levels?.tp} pts
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "#555" }}>
            ¿Registrar resultado de la operación?
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            {[["✅ TP alcanzado (+$20)", "tp"], ["❌ SL tocado (-$10)", "sl"], ["↩ Salida manual", "manual"]].map(([label, result]) => (
              <button key={result} onClick={() => { registerOp(context.signal, result); setAlertFired(false); }}
                style={{ flex: 1, padding: "7px 6px", fontSize: 11, cursor: "pointer", borderRadius: 6,
                  background: "transparent", border: `0.5px solid ${SIG[context.signal]?.border}`,
                  color: SIG[context.signal]?.text }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Context analysis */}
      {context && (
        <div style={{ background: "#111", border: "0.5px solid #1e1e1e", borderRadius: 10,
          padding: "1rem 1.25rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "#444", textTransform: "uppercase" }}>
              Contexto Claude · {formatDate(context.time)}
            </span>
            <Badge signal={context.signal} />
          </div>
          {context.levels?.entry && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 10 }}>
              {[["Entrada", context.levels.entry, "#60a5fa"],
                ["Stop",   context.levels.sl,    "#f87171"],
                ["Obj.",   context.levels.tp,    "#4ade80"]].map(([l, v, c]) => v && (
                <div key={l} style={{ background: "#0a0a0a", borderRadius: 6, padding: "6px 10px",
                  border: `0.5px solid ${c}22` }}>
                  <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", marginBottom: 2 }}>{l} (pts)</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: c }}>{v.toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ borderTop: "0.5px solid #1a1a1a", paddingTop: 10 }}>
            <p style={{ fontSize: 11, lineHeight: 1.8, color: "#888", margin: 0, whiteSpace: "pre-wrap" }}>
              {context.analysis}
            </p>
          </div>
        </div>
      )}

      {/* Ops log */}
      {ops.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <p style={{ fontSize: 10, color: "#444", textTransform: "uppercase", margin: "0 0 6px" }}>
            Operaciones de hoy · {session.ops}/2 · P&L: {session.pnl >= 0 ? "+" : ""}{session.pnl.toFixed(2)} USD
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ops.map((op, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10,
                background: "#111", borderRadius: 6, padding: "7px 12px",
                border: `0.5px solid ${op.pnl > 0 ? "#166534" : op.pnl < 0 ? "#991b1b" : "#222"}` }}>
                <Badge signal={op.side} />
                <span style={{ fontSize: 11, color: "#666", flex: 1 }}>{op.result === "tp" ? "Take Profit" : op.result === "sl" ? "Stop Loss" : "Manual"}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: op.pnl > 0 ? "#4ade80" : op.pnl < 0 ? "#f87171" : "#555" }}>
                  {op.pnl > 0 ? "+" : ""}{op.pnl} USD
                </span>
                <span style={{ fontSize: 10, color: "#333" }}>{formatTime(op.time)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ borderTop: "0.5px solid #1a1a1a", paddingTop: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "#444", textTransform: "uppercase" }}>Historial · {history.length} análisis</span>
            <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]); }}
              style={{ fontSize: 10, background: "none", border: "0.5px solid #222", color: "#444",
                borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>Borrar</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {history.map((h, i) => (
              <div key={h.id} style={{ background: "#111", border: "0.5px solid #1a1a1a", borderRadius: 7, overflow: "hidden" }}>
                <div onClick={() => setExpanded(expanded === i ? null : i)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}>
                  <Badge signal={h.signal} />
                  <span style={{ fontSize: 11, color: "#666", flex: 1 }}>{h.ticker}</span>
                  <span style={{ fontSize: 11, color: "#555" }}>{h.price && `entrada ${h.price} pts`}</span>
                  <span style={{ fontSize: 10, color: "#333" }}>{formatDate(h.date)}</span>
                  <span style={{ fontSize: 10, color: "#222" }}>{expanded === i ? "▲" : "▼"}</span>
                </div>
                {expanded === i && (
                  <div style={{ borderTop: "0.5px solid #1a1a1a", padding: "8px 12px" }}>
                    <p style={{ fontSize: 11, lineHeight: 1.7, color: "#555", margin: 0, whiteSpace: "pre-wrap" }}>{h.summary}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ marginTop: "1.5rem", fontSize: 10, color: "#222", textAlign: "center" }}>
        Análisis no constituye asesoramiento financiero · Solo uso personal
      </p>
    </div>
  );
}
