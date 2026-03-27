/**
 * IBKR Bridge Server — TWS API via @stoqey/ib
 * Puerto IB Gateway: 4002 (paper) / 4001 (live)
 * Puerto este servidor: 3001
 */

const http  = require("http");
const ibLib = require("@stoqey/ib");

const IBApi    = ibLib.IBApi    || ibLib.default?.IBApi    || ibLib;
const EventName= ibLib.EventName|| ibLib.default?.EventName;
const SecType  = ibLib.SecType  || ibLib.default?.SecType  || { FUT: "FUT" };
const Currency = ibLib.Currency || ibLib.default?.Currency || { USD: "USD" };

const PORT     = 3001;
const IB_PORT  = 4002;
const IB_HOST  = "127.0.0.1";

let ib        = null;
let connected = false;
let reqId     = 1;
function getReqId() { return reqId++; }

// ─── Connect ──────────────────────────────────────────────────────────────────
function connectIB() {
  return new Promise((resolve, reject) => {
    if (connected && ib) { resolve(); return; }

    ib = new IBApi({ host: IB_HOST, port: IB_PORT, clientId: 42 });

    ib.on(EventName.connected, () => {
      connected = true;
      console.log("✓ Conectado a IB Gateway puerto", IB_PORT);
      resolve();
    });
    ib.on(EventName.disconnected, () => { connected = false; });
    ib.on(EventName.error, (err, code) => {
      if (code === -1 || code === 2104 || code === 2106 || code === 2158) return;
      console.error(`IB Error [${code}]: ${err?.message || err}`);
    });

    ib.connect();
    setTimeout(() => { if (!connected) reject(new Error("Timeout conectando")); }, 6000);
  });
}

// ─── YM contract as plain object ─────────────────────────────────────────────
// Contratos YM disponibles (actualizar conId cuando cambie el front month):
// 20260618 → conId 793356190  ← ACTIVO AHORA (Jun 2026)
// 20260918 → conId 815824220  (Sep 2026)
// 20261218 → conId 840227352  (Dic 2026)
const YM_CONID = 793356190;

function ymContract() {
  // Usando conId directo para máxima fiabilidad
  return {
    conId:    YM_CONID,
    exchange: "CBOT",
  };
}

// ─── Price snapshot ───────────────────────────────────────────────────────────
function getPrice() {
  return new Promise(async (resolve, reject) => {
    try { await connectIB(); } catch(e) { reject(e); return; }

    const id     = getReqId();
    const result = {};
    let   done   = false;

    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        try { ib.cancelMktData(id); } catch {}
        result.time = new Date().toISOString();
        resolve(result);
      }
    }, 6000);

    ib.on(EventName.tickPrice, (reqId, tickType, price) => {
      if (reqId !== id || price <= 0) return;
      // Real-time ticks
      if (tickType === 4) result.last = price;
      if (tickType === 1) result.bid  = price;
      if (tickType === 2) result.ask  = price;
      if (tickType === 6) result.high = price;
      if (tickType === 7) result.low  = price;
      // Delayed ticks (type + 65)
      if (tickType === 68) result.last = price;
      if (tickType === 66) result.bid  = price;
      if (tickType === 67) result.ask  = price;
      if (tickType === 72) result.high = price;
      if (tickType === 73) result.low  = price;
    });

    ib.on(EventName.tickSize, (reqId, tickType, size) => {
      if (reqId !== id) return;
      if (tickType === 8)  result.volume = size;
      if (tickType === 74) result.volume = size; // delayed volume
    });

    ib.on(EventName.tickSnapshotEnd, (reqId) => {
      if (reqId !== id || done) return;
      done = true;
      clearTimeout(timeout);
      result.time = new Date().toISOString();
      resolve(result);
    });

    ib.reqMarketDataType(3);
    ib.reqMktData(id, ymContract(), "", false, false);
  });
}

// ─── Historical bars ──────────────────────────────────────────────────────────
function getBars(duration = "1 D", barSize = "1 min") {
  return new Promise(async (resolve, reject) => {
    try { await connectIB(); } catch(e) { reject(e); return; }

    const id   = getReqId();
    const bars = [];

    const timeout = setTimeout(() => {
      reject(new Error("Timeout barras históricas — el mercado puede estar cerrado"));
    }, 15000);

    ib.on(EventName.historicalData, (reqId, bar) => {
      if (reqId !== id) return;
      if (bar.time && bar.time !== "finished") {
        bars.push({ time: bar.time, open: bar.open, high: bar.high,
                    low: bar.low, close: bar.close, volume: bar.volume });
      }
    });

    ib.on(EventName.historicalDataEnd, (reqId) => {
      if (reqId !== id) return;
      clearTimeout(timeout);
      resolve(bars);
    });

    ib.reqHistoricalData(id, ymContract(), "", duration, barSize, "TRADES", 0, 1, false);
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/status") {
      try {
        await connectIB();
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, connected, port: IB_PORT }));
      } catch(e) {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: false, connected: false, error: e.message }));
      }
      return;
    }

    if (url.pathname === "/price") {
      const data = await getPrice();
      res.writeHead(200);
      res.end(JSON.stringify({ symbol: "YM", ...data }));
      return;
    }

    if (url.pathname === "/bars") {
      const periodParam = url.searchParams.get("period") || "1D";
      const barParam    = url.searchParams.get("bar")    || "1min";

      const durationMap = {
        "1min":"1 H","5min":"1 H","15min":"4 H","30min":"1 D",
        "1h":"1 D","4h":"2 D","1D":"1 D","1W":"1 W","4H":"2 D",
      };
      const barMap = {
        "1min":"1 min","5min":"5 mins","15min":"15 mins","30min":"30 mins",
        "1h":"1 hour","4h":"4 hours","1d":"1 day","1D":"1 day",
      };

      const bars = await getBars(durationMap[periodParam] || "1 D", barMap[barParam] || barParam);
      res.writeHead(200);
      res.end(JSON.stringify({ symbol: "YM", period: periodParam, bar: barParam, bars }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Ruta no encontrada" }));

  } catch(err) {
    console.error("Error:", err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log(`\n▲ IBKR Bridge → http://localhost:${PORT}`);
  console.log(`  TWS API → IB Gateway puerto ${IB_PORT}\n`);
  console.log("  GET /status");
  console.log("  GET /price?symbol=YM");
  console.log("  GET /bars?period=1D&bar=1min\n");
});
