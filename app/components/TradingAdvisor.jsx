"use client";

import { useState, useCallback } from "react";

const ENDPOINTS = [
  { label: "Trades",    path: "/v3/trades/{ticker}?limit=20" },
  { label: "Quotes",    path: "/v3/quotes/{ticker}?limit=20" },
  { label: "Snapshot",  path: "/v3/snapshot/locale/us/markets/stocks/tickers/{ticker}" },
  { label: "Dividends", path: "/v3/reference/dividends?ticker={ticker}&limit=10" },
];

const SIGNAL_STYLES = {
  BUY:  { bg: "#0d2e1a", text: "#4ade80", border: "#166534" },
  SELL: { bg: "#2e0d0d", text: "#f87171", border: "#991b1b" },
  HOLD: { bg: "#2e220d", text: "#fbbf24", border: "#92400e" },
  "N/A":{ bg: "#1a1a1a", text: "#888",    border: "#333" },
};

function MetricCard({ label, value, sub }) {
  return (
    <div style={{
      background: "#1a1a1a", borderRadius: 8, padding: "12px 14px",
      border: "0.5px solid #2a2a2a", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <span style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 500, fontFamily: "monospace" }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: "#555" }}>{sub}</span>}
    </div>
  );
}

function SignalBadge({ signal }) {
  const s = SIGNAL_STYLES[signal] || SIGNAL_STYLES["N/A"];
  return (
    <span style={{
      background: s.bg, color: s.text, border: `0.5px solid ${s.border}`,
      borderRadius: 8, padding: "4px 16px", fontSize: 13, fontWeight: 600,
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

export default function TradingAdvisor() {
  const [massiveKey,   setMassiveKey]   = useState("");
  const [ticker,       setTicker]       = useState("AAPL");
  const [endpointIdx,  setEndpointIdx]  = useState(2);
  const [status,       setStatus]       = useState("idle");
  const [rawData,      setRawData]      = useState(null);
  const [analysis,     setAnalysis]     = useState("");
  const [signal,       setSignal]       = useState("N/A");
  const [error,        setError]        = useState("");

  const selectedEndpoint = ENDPOINTS[endpointIdx];
  const resolvedPath     = selectedEndpoint.path.replace("{ticker}", encodeURIComponent(ticker));

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
      const prompt = `Eres un analista de trading especializado en futuros del Dow Jones y derivados.
Analiza los siguientes datos de mercado del ticker "${ticker}" y proporciona:
1. Una señal clara: BUY, SELL o HOLD (en mayúsculas al principio).
2. Justificación técnica resumida (precio, volumen, tendencia, momentum).
3. Nivel de confianza (bajo/medio/alto) y por qué.
4. Riesgos clave a considerar.
5. Precio objetivo a corto plazo si aplica.

Datos de mercado (JSON):
${JSON.stringify(marketData, null, 2).slice(0, 3000)}

Responde en español, de forma concisa y profesional. Empieza siempre por la señal: BUY / SELL / HOLD.`;

      const claudeRes = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const claudeData = await claudeRes.json();
      if (claudeData.error) throw new Error(claudeData.error);
      const text = claudeData?.content?.map(b => b.text || "").join("") || "Sin respuesta.";
      setAnalysis(text);
      setSignal(extractSignal(text));
      setStatus("done");
    } catch (e) {
      setError(`Error al consultar Claude: ${e.message}`);
      setStatus("done");
    }
  }, [massiveKey, ticker, resolvedPath]);

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
          Datos de mercado vía Massive API · Análisis por Claude AI
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
              placeholder="DJI, SPY, AAPL..." style={inputStyle} />
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

        <button
          onClick={run}
          disabled={busy}
          style={{
            width: "100%", padding: "10px", fontSize: 14, cursor: busy ? "not-allowed" : "pointer",
            background: busy ? "#1a1a1a" : "#0d2e1a", color: busy ? "#555" : "#4ade80",
            border: `0.5px solid ${busy ? "#2a2a2a" : "#166534"}`,
            borderRadius: 8, fontFamily: "monospace", fontWeight: 500,
            transition: "all 0.15s",
          }}
        >
          {status === "fetching" ? "⟳ Obteniendo datos de Massive..." :
           status === "analyzing" ? "⟳ Analizando con Claude..." :
           "▶ Obtener datos y analizar"}
        </button>
      </div>

      {/* Metrics */}
      {metrics && (
        <div style={{ marginBottom: "1.5rem" }}>
          <p style={{ fontSize: 11, color: "#555", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Resumen · {ticker}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            <MetricCard label="Último" value={`$${metrics.last_price}`} />
            <MetricCard label="Máximo" value={`$${metrics.high}`} />
            <MetricCard label="Mínimo" value={`$${metrics.low}`} />
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
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ fontSize: 12, color: "#555", cursor: "pointer", userSelect: "none" }}>
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

      <p style={{ marginTop: "2rem", fontSize: 11, color: "#333", textAlign: "center" }}>
        Este análisis no constituye asesoramiento financiero.
      </p>
    </div>
  );
}
