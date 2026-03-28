/**
 * IBKR Bridge Server — TWS API via @stoqey/ib
 * Puerto IB Gateway: 4001 (live) / 4002 (paper)
 * Puerto este servidor: 3001
 *
 * Instalar: npm install @stoqey/ib
 * Arrancar: node server.js
 */

const http  = require("http");
const ibLib = require("@stoqey/ib");

const IBApi     = ibLib.IBApi;
const EventName = ibLib.EventName;

const PORT    = 3001;
const IB_PORT = 4001;  // 4001=live, 4002=paper
const IB_HOST = "127.0.0.1";

// Contratos YM disponibles — actualizar conId cuando cambie el front month:
// 793356190 = Jun 2026  ← ACTIVO
// 815824220 = Sep 2026
// 840227352 = Dic 2026
const YM_CONID = 793356190;

let ib        = null;
let connected = false;
let reqId     = 1;

function getReqId() { return reqId++; }

function ymContract() {
  return { conId: YM_CONID, exchange: "CBOT" };
}

// ─── Conectar a IB Gateway (conexión persistente) ────────────────────────────
let connectPromise = null;

function connectIB() {
  if (connected && ib) return Promise.resolve();
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    ib = new IBApi({ host: IB_HOST, port: IB_PORT, clientId: 42 });

    ib.on(EventName.connected, () => {
      connected = true;
      connectPromise = null;
      console.log("✓ Conectado a IB Gateway puerto", IB_PORT, IB_PORT === 4001 ? "(LIVE)" : "(PAPER)");
      resolve();
    });

    ib.on(EventName.disconnected, () => {
      connected = false;
      connectPromise = null;
      ib = null;
      console.log("✗ Desconectado — reconectando en 3s...");
      setTimeout(() => connectIB().catch(console.error), 3000);
    });

    ib.on(EventName.error, (err, code) => {
      if ([2104, 2106, 2107, 2108, 2158, -1, 10167, 354].includes(code)) return;
      console.error("IB Error [" + code + "]:", err?.message || err);
    });

    ib.connect();

    setTimeout(() => {
      if (!connected) {
        connectPromise = null;
        reject(new Error("Timeout conectando a IB Gateway en puerto " + IB_PORT));
      }
    }, 8000);
  });

  return connectPromise;
}

// ─── Precio actual ────────────────────────────────────────────────────────────
function getPrice() {
  return new Promise(async (resolve, reject) => {
    try { await connectIB(); } catch (e) { reject(e); return; }

    const id     = getReqId();
    const result = {};
    let   done   = false;

    const finish = () => {
      if (done) return;
      done = true;
      try { ib.cancelMktData(id); } catch {}
      result.time = new Date().toISOString();
      resolve(result);
    };

    const timeout = setTimeout(finish, 15000);

    // Tipo 3 = delayed 15min (sin suscripción activa)
    // Tipo 1 = tiempo real (requiere suscripción CBOT activa)
    ib.reqMarketDataType(3);

    ib.on(EventName.tickPrice, (reqId, tickType, price) => {
      if (reqId !== id || price <= 0) return;
      // Ticks normales
      if (tickType === 1) result.bid  = price;
      if (tickType === 2) result.ask  = price;
      if (tickType === 4) result.last = price;
      if (tickType === 6) result.high = price;
      if (tickType === 7) result.low  = price;
      // Ticks con delay (+65 sobre los normales)
      if (tickType === 66) result.bid  = price;
      if (tickType === 67) result.ask  = price;
      if (tickType === 68) result.last = price;
      if (tickType === 72) result.high = price;
      if (tickType === 73) result.low  = price;
    });

    ib.on(EventName.tickSize, (reqId, tickType, size) => {
      if (reqId !== id) return;
      if (tickType === 8)  result.volume = size;
      if (tickType === 74) result.volume = size;
    });

    ib.on(EventName.tickSnapshotEnd, (reqId) => {
      if (reqId !== id || done) return;
      clearTimeout(timeout);
      finish();
    });

    ib.reqMktData(id, ymContract(), "", false, false);
  });
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, "http://localhost:" + PORT);

  try {
    // GET /status
    if (url.pathname === "/status") {
      try {
        await connectIB();
        res.writeHead(200);
        res.end(JSON.stringify({
          ok:        true,
          connected,
          port:      IB_PORT,
          mode:      IB_PORT === 4001 ? "LIVE" : "PAPER",
          conId:     YM_CONID,
          contract:  "YM Jun2026",
        }));
      } catch (e) {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: false, connected: false, error: e.message }));
      }
      return;
    }

    // GET /price?symbol=YM
    if (url.pathname === "/price") {
      const data = await getPrice();
      res.writeHead(200);
      res.end(JSON.stringify({ symbol: "YM", ...data }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Ruta no encontrada. Endpoints: /status /price" }));

  } catch (err) {
    console.error("Error:", err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
}

http.createServer(handleRequest).listen(PORT, () => {
  console.log("\n▲ IBKR Bridge → http://localhost:" + PORT);
  console.log("  Librería: @stoqey/ib | Gateway: puerto " + IB_PORT + " (" + (IB_PORT === 4001 ? "LIVE" : "PAPER") + ")");
  console.log("  Contrato: YM Jun2026 conId=" + YM_CONID);
  console.log("\n  GET /status          — estado conexión IBKR");
  console.log("  GET /price?symbol=YM — precio actual YM (bid/ask/last/high/low/volume)\n");
});
