"use client";

import { useState, useCallback, useEffect } from "react";

const HISTORY_KEY = "dj_trading_history";
const MAX_HISTORY = 20;

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);

const ENDPOINTS = [
  { label: "Últ. 30 días", path: `/v2/aggs/ticker/{ticker}/range/1/day/${daysAgo(30)}/${TODAY}?adjusted=true&sort=asc&limit=30` },
  { label: "Últ. semana",  path: `/v2/aggs/ticker/{ticker}/range/1/day/${daysAgo(7)}/${TODAY}?adjusted=true&sort=asc&limit=7` },
  { label: "Día anterior", path: "/v2/aggs/ticker/{ticker}/prev" },
  { label: "Dividends",    path: "/v3/reference/dividends?ticker={ticker}&limit=10" },
];

const SIGNAL_STYLES = {
  BUY:  { bg: "#0d2e1a", text: "#4ade80", border: "#166534" },
  SELL: { bg: "#2e0d0d", text: "#f87171", border: "#991b1b" },
  HOLD: { bg: "#2e220d", text: "#fbbf24", border: "#92400e" },
  "N/A":{ bg: "#1a1a1a", text: "#888",    border: "#333" },
};

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); }
  catch {}
}

function MetricCard({ label, value, sub }) {
  return (
    <div style={{
      background: "#1a1a1a", borderRadius: 8, padding: "12px 14px",
      border: "0.5px solid #2a2a2a", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 500, fontFamily: "monospace" }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: "#4ade80" }}>{sub}</span>}
    </div>
  );
}

function SignalBadge({ signal, size = "md" }) {
  const s = SIGNAL_STYLES[signal] || SIGNAL_STYLES["N/A"];
  return (
    <span style={{
      background: s.bg, color: s.text, border: `0.5px solid ${s.border}`,
      borderRadius: 6, padding: size === "sm" ? "2px 8px" : "4px 16px",
      fontSize: size === "sm" ? 11 : 13, fontWeight: 600,
      letterSpacing: "0.08em", fontFamily: "monospace",
    }}>{signal}</span>
  );
}

function extractSignal(text) {
  const m = text.match(/\b(BUY|SELL|HOLD)\b/i);
  return m ? m[1].toUpperCase() : "N/A";
}

function extractMetrics(rawData) {
  const results = rawData?.results;
  if (!results || !Array.isArray(results) || results.length === 0) return null;
  const prices = results.map(r => r.c || r.p || r.vw || r.close).filter(Boolean);
  if (prices.length === 0) return null;
  const high       = Math.max(...prices).toFixed(2);
  const low        = Math.min(...prices).toFixed(2);
  const last_price = prices[prices.length - 1].toFixed(2);
  const vol        = results.reduce((s, r) => s + (r.v || r.size || 0), 0);
  return { last_price, high, low, vol, count: results.length };
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function HistoryPanel({ history, onClear }) {
  const [expanded, setExpanded] = useState(null);

  if (history.length === 0) return (
    <div style={{ borderTop: "0.5px solid #1a1a1a", paddingTop: "1.5rem", marginTop: "1rem" }}>
      <p style={{ fontSize: 11, color: "#444", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px" }}>
        Historial de señales
      </p>
      <p style={{ fontSize: 13, color: "#444", margin: 0 }}>Aún no hay análisis guardados. El historial aparecerá aquí tras el primer análisis.</p>
    </div>
  );

  return (
    <div style={{ borderTop: "0.5px solid #1a1a1a", paddingTop: "1.5rem", marginTop: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
          Historial de señales · {history.length} análisis guardados
        </p>
        <button onClick={onClear} style={{
          fontSize: 11, padding: "3px 10px", cursor: "pointer", borderRadius: 6,
          background: "transparent", color: "#555", border: "0.5px solid #2a2a2a",
        }}>Borrar historial</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {history.map((entry, i) => (
          <div key={entry.id} style={{
            background: "#111", border: "0.5px solid #1e1e1e", borderRadius: 8, overflow: "hidden",
          }}>
            <div
              onClick={() => setExpanded(expanded === i ? null : i)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}
            >
              <SignalBadge signal={entry.signal} size="sm" />
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#888", flex: 1 }}>{entry.ticker}</span>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#555" }}>
                ${entry.price}
                {entry.ticker === "DIA" && (
                  <span style={{ color: "#4ade80", marginLeft: 6 }}>
                    DJ {(parseFloat(entry.price) * 100).toLocaleString("es-ES", { maximumFractionDigits: 0 })} pts
                  </span>
                )}
              </span>
              <span style={{ fontSize: 11, color: "#444" }}>{formatDate(entry.date)}</span>
              <span style={{ fontSize: 11, color: "#333" }}>{expanded === i ? "▲" : "▼"}</span>
            </div>

            {expanded === i && (
              <div style={{ borderTop: "0.5px solid #1a1a1a", padding: "12px 14px" }}>
                {entry.target && (
                  <p style={{ fontSize: 12, color: "#4ade80", margin: "0 0 8px", fontFamily: "monospace" }}>
                    Precio objetivo: {entry.target}
                    {entry.ticker === "DIA" && entry.target && (
                      <span style={{ color: "#555", marginLeft: 8 }}>
                        (DJ ~{(parseFloat(entry.target.replace("$","")) * 100).toLocaleString("es-ES",{maximumFractionDigits:0})} pts)
                      </span>
                    )}
                  </p>
                )}
                <p style={{ fontSize: 12, lineHeight: 1.7, color: "#555", margin: 0, whiteSpace: "pre-wrap" }}>
                  {entry.summary}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TradingAdvisor() {
  const [massiveKey,  setMassiveKey]  = useState("");
  const [ticker,      setTicker]      = useState("DIA");
  const [endpointIdx, setEndpointIdx] = useState(0);
  const [status,      setStatus]      = useState("idle");
  const [rawData,     setRawData]     = useState(null);
  const [analysis,    setAnalysis]    = useState("");
  const [signal,      setSignal]      = useState("N/A");
  const [error,       setError]       = useState("");
  const [history,     setHistory]     = useState([]);

  useEffect(() => { setHistory(loadHistory()); }, []);

  const selectedEndpoint = ENDPOINTS[endpointIdx];
  const resolvedPath     = selectedEndpoint.path.replace("{ticker}", encodeURIComponent(ticker));
  const prevForTicker    = history.filter(h => h.ticker === ticker).length;

  const run = useCallback(async () => {
    if (!massiveKey.trim()) { setError("Introduce tu API key de Massive."); return; }
    if (!ticker.trim())     { setError("Introduce un ticker."); return; }
    setError(""); setStatus("fetching"); setRawData(null); setAnalysis(""); setSignal("N/A");

    let marketData;
    try {
      const url = `https://api.massive.com${resolvedPath}${resolvedPath.includes("?") ? "&" : "?"}apiKey=${massiveKey}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Massive API: ${res.status} ${res.statusText}`);
      marketData = await res.json();
      setRawData(marketData);
    } catch (e) {
      setError(`Error al obtener datos de Massive: ${e.message}`);
      setStatus("idle");
      return;
    }

    setStatus("analyzing");

    try {
      const currentHistory = loadHistory();
      const recentForTicker = currentHistory.filter(h => h.ticker === ticker).slice(0, 5);

      const historyContext = recentForTicker.length > 0
        ? `\n\nHISTORIAL DE ANÁLISIS PREVIOS (más reciente primero):
${recentForTicker.map(h =>
  `- ${formatDate(h.date)}: Señal ${h.signal}, precio $${h.price}${h.ticker === "DIA" ? ` (DJ ~${(parseFloat(h.price)*100).toLocaleString("es-ES",{maximumFractionDigits:0})} pts)` : ""}, objetivo: ${h.target || "no especificado"}.`
).join("\n")}

Con este historial evalúa también:
- ¿Se cumplieron las predicciones de precio objetivo anteriores?
- ¿Ha cambiado la tendencia respecto a análisis previos?
- ¿Hay consistencia o divergencia entre señales pasadas y situación actual?`
        : "";

      const isDIA = ticker === "DIA";
      const prompt = `Eres un analista de trading especializado en ETFs que replican el Dow Jones.
Analiza los siguientes datos históricos del ticker "${ticker}" (últimos 30 días de barras diarias OHLC) y proporciona:

1. Señal clara: BUY, SELL o HOLD (en mayúsculas, al principio de la respuesta).
2. Análisis técnico:
   - Tendencia general (últimos 30 días)
   - SMA10 y SMA20 calculadas con los datos
   - Precio actual vs SMAs
   - Volumen reciente vs promedio del período
   - Soporte y resistencia clave
   - Momentum
3. Nivel de confianza (bajo/medio/alto) con justificación.
4. Riesgos clave.
5. Precio objetivo a 5-10 días — incluye el valor en formato "$XXX.XX".
${historyContext}
${isDIA ? `\nIMPORTANTE: DIA replica el Dow Jones a razón de 1/100. Multiplica precios × 100 para puntos del DJ. Ej: $464 = ~46.400 pts.` : ""}

Datos (JSON - 'c'=cierre, 'o'=apertura, 'h'=máximo, 'l'=mínimo, 'v'=volumen, 'vw'=VWAP):
${JSON.stringify(marketData, null, 2).slice(0, 4000)}

Responde en español, conciso y profesional. Empieza SIEMPRE con: BUY / SELL / HOLD.`;

      const claudeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const claudeData = await claudeRes.json();
      if (claudeData.error) throw new Error(claudeData.error);
      const text = claudeData?.content?.map(b => b.text || "").join("") || "Sin respuesta.";
      const detectedSignal = extractSignal(text);

      setAnalysis(text);
      setSignal(detectedSignal);
      setStatus("done");

      const metrics = extractMetrics(marketData);
      const targetMatches = text.match(/\$\d{3,4}(?:\.\d{1,2})?/g);
      const target = targetMatches ? targetMatches[targetMatches.length - 1] : null;

      const newEntry = {
        id: Date.now(),
        date: new Date().toISOString(),
        ticker,
        signal: detectedSignal,
        price: metrics?.last_price || "—",
        target,
        summary: text.slice(0, 500),
      };

      const updated = [newEntry, ...currentHistory];
      saveHistory(updated);
      setHistory(updated.slice(0, MAX_HISTORY));

    } catch (e) {
      setError(`Error al consultar Claude: ${e.message}`);
      setStatus("done");
    }
  }, [massiveKey, ticker, resolvedPath]);

  const handleClearHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  };

  const metrics = rawData ? extractMetrics(rawData) : null;
  const busy    = status === "fetching" || status === "analyzing";

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "#1a1a1a", border: "0.5px solid #333", borderRadius: 8,
    color: "#e8e8e8", padding: "8px 12px", fontSize: 13,
    fontFamily: "monospace", outline: "none",
  };

  const chipStyle = (active) => ({
    fontSize: 12, padding: "4px 12px", cursor: "pointer", borderRadius: 8,
    background: active ? "#1e3a2e" : "transparent",
    color: active ? "#4ade80" : "#666",
    border: active ? "0.5px solid #166534" : "0.5px solid #2a2a2a",
  });

  return (
    <div style={{ minHeight: "100vh", padding: "2rem", maxWidth: 760, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: "2rem", borderBottom: "0.5px solid #222", paddingBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 18, fontFamily: "monospace", fontWeight: 600, color: "#4ade80" }}>▲ DJ Trading Advisor</span>
          <SignalBadge signal={signal} />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "#555" }}>
          Datos de mercado vía Massive API · Análisis por Claude AI · Historial local
        </p>
      </div>

      {/* Config */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Massive API Key
            </label>
            <input type="password" value={massiveKey} onChange={e => setMassiveKey(e.target.value)}
              placeholder="cZspTAmWQ05AAQS_..." style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Ticker
            </label>
            <input value={ticker} onChange={e => setTicker(e.target.value)}
              placeholder="DIA, SPY, AAPL..." style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Endpoint
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ENDPOINTS.map((ep, i) => (
              <button key={i} onClick={() => setEndpointIdx(i)} style={chipStyle(i === endpointIdx)}>
                {ep.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#444", margin: "6px 0 0", wordBreak: "break-all", fontFamily: "monospace" }}>
            https://api.massive.com{resolvedPath}&apiKey=***
          </p>
        </div>

        {error && (
          <div style={{
            background: "#2e0d0d", border: "0.5px solid #991b1b", borderRadius: 8,
            padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#f87171",
          }}>{error}</div>
        )}

        <button onClick={run} disabled={busy} style={{
          width: "100%", padding: "10px", fontSize: 14, cursor: busy ? "not-allowed" : "pointer",
          background: busy ? "#1a1a1a" : "#0d2e1a", color: busy ? "#555" : "#4ade80",
          border: `0.5px solid ${busy ? "#2a2a2a" : "#166534"}`,
          borderRadius: 8, fontFamily: "monospace", fontWeight: 500, transition: "all 0.15s",
        }}>
          {status === "fetching" ? "⟳ Obteniendo datos de Massive..." :
           status === "analyzing" ? "⟳ Analizando con Claude..." :
           `▶ Obtener datos y analizar${prevForTicker > 0 ? ` · ${prevForTicker} análisis previos de ${ticker}` : ""}`}
        </button>
      </div>

      {/* Metrics */}
      {metrics && (
        <div style={{ marginBottom: "1.5rem" }}>
          <p style={{ fontSize: 11, color: "#555", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Resumen · {ticker}{ticker === "DIA" && <span style={{ color: "#4ade80" }}> · equiv. Dow Jones (×100)</span>}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            <MetricCard label="Último" value={`$${metrics.last_price}`}
              sub={ticker === "DIA" ? `DJ: ${(parseFloat(metrics.last_price)*100).toLocaleString("es-ES",{maximumFractionDigits:0})} pts` : undefined} />
            <MetricCard label="Máximo" value={`$${metrics.high}`}
              sub={ticker === "DIA" ? `DJ: ${(parseFloat(metrics.high)*100).toLocaleString("es-ES",{maximumFractionDigits:0})} pts` : undefined} />
            <MetricCard label="Mínimo" value={`$${metrics.low}`}
              sub={ticker === "DIA" ? `DJ: ${(parseFloat(metrics.low)*100).toLocaleString("es-ES",{maximumFractionDigits:0})} pts` : undefined} />
            <MetricCard label="Registros" value={metrics.count}
              sub={metrics.vol > 0 ? `Vol: ${metrics.vol.toLocaleString()}` : undefined} />
          </div>
        </div>
      )}

      {/* Analysis */}
      {analysis && (
        <div style={{
          background: "#111", border: "0.5px solid #2a2a2a", borderRadius: 12,
          padding: "1.25rem", marginBottom: "1.5rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Análisis Claude · {ticker}
            </span>
            <SignalBadge signal={signal} />
          </div>
          <div style={{ borderTop: "0.5px solid #222", paddingTop: 12 }}>
            <p style={{ fontSize: 13, lineHeight: 1.8, color: "#ccc", margin: 0, whiteSpace: "pre-wrap" }}>
              {analysis}
            </p>
          </div>
        </div>
      )}

      {/* Raw JSON */}
      {rawData && (
        <details>
          <summary style={{ fontSize: 12, color: "#444", cursor: "pointer", userSelect: "none" }}>
            Ver JSON completo de Massive
          </summary>
          <pre style={{
            fontSize: 11, lineHeight: 1.6, marginTop: 8,
            background: "#111", border: "0.5px solid #2a2a2a",
            borderRadius: 8, padding: "12px", overflow: "auto", maxHeight: 300,
            color: "#555", fontFamily: "monospace",
          }}>{JSON.stringify(rawData, null, 2)}</pre>
        </details>
      )}

      {/* History */}
      <HistoryPanel history={history} onClear={handleClearHistory} />

      <p style={{ marginTop: "2rem", fontSize: 11, color: "#333", textAlign: "center" }}>
        Este análisis no constituye asesoramiento financiero.
      </p>
    </div>
  );
}
