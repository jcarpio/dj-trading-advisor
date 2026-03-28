# DJ Trading Advisor

Asistente de trading para el índice Dow Jones (US30 CFD / YM futuros) con análisis multi-timeframe por IA, monitorización en tiempo real vía IBKR y gestión de riesgo integrada.

**Versión:** 1.0.0 · **Coste mensual:** ~$1.63 · **Deploy:** Vercel (auto-deploy desde GitHub)

---

## ¿Qué hace esta app?

Combina datos históricos de Massive API, precio en tiempo real de Interactive Brokers y análisis de Claude AI para dar señales de entrada precisas en el US30/DJIA.

### Flujo de sesión (máx. 30 minutos al día)

**Fase 1 — Contexto macro (1 llamada a Claude, ~$0.004)**
- Obtiene datos de **Massive API**: 1W + 1D + 1H
- Consulta precio actual del YM desde **IBKR Bridge**
- Claude analiza todo y devuelve señal BUY/SELL/HOLD con entrada, SL y TP

**Fase 1b — Re-análisis rápido (botón 🔄)**
- Usa el análisis previo + precio actual IBKR + historial de hasta 100 precios recientes
- Detecta cambios de momentum intraday sin repetir la consulta a Massive
- Ideal cuando el precio se ha movido significativamente desde el análisis inicial

**Fase 2 — Monitorización en tiempo real**
- IBKR Bridge consulta precio del YM cada 20 segundos
- Buffer circular de 100 precios (~33 minutos de historial intraday)
- Alertas de proximidad a niveles de entrada/stop/objetivo (<30 pts)
- Triple alerta cuando se alcanza la condición: visual + sonido + notificación SO

**Gestión de riesgo automática**
- Pérdida máxima diaria: $20 → bloquea la sesión
- Objetivo diario: $40 → avisa y sugiere cerrar
- Máximo 2 operaciones al día
- Cuenta atrás de 30 minutos por sesión

---

## Stack técnico

| Componente | Tecnología | Coste |
|---|---|---|
| Frontend | Next.js 14 App Router | $0 |
| Datos históricos | Massive REST API (1W, 1D, 1H) | $0 |
| Precio tiempo real | IBKR Bridge → IB Gateway → YM futuros | $0 |
| Datos mercado | CBOT Real-Time suscripción IBKR | $1.55/mes |
| Análisis IA | Claude Sonnet (1 llamada/sesión) | ~$0.004/sesión |
| Deploy | Vercel (auto-deploy desde GitHub) | $0 |
| **Total** | | **~$1.63/mes** |

---

## Instrumentos soportados

| Campo | Funding Pips (principal) | IBKR (futuro) |
|---|---|---|
| Instrumento | US30 CFD | MYM (Micro E-mini Dow) |
| Plataforma | MT5 | IB Gateway |
| Tamaño | 0.05 lotes | 1 contrato |
| Valor/punto | $0.05 | $0.50 |
| Stop loss máx. | 200 pts = $10 | 40 pts = $20 |
| Take profit obj. | 400 pts = $20 | 80 pts = $40 |
| Pérdida máx./día | $20 | $20 |
| Objetivo/día | $40 | $40 |

> **Los precios de YM y MYM son idénticos** — los niveles de la app son válidos para ambos sin conversión.

---

## Arquitectura

```
App Vercel (Next.js)  ←→  Claude AI (análisis contexto)
        ↓
Tu navegador (Mac)
        ↓ fetch localhost:3001 cada 20s
IBKR Bridge (~/ibkr-bridge/server.js)
  · Buffer 100 precios en memoria
  · removeListener() tras cada petición (sin memory leaks)
  · Auto-reconexión si IB Gateway se desconecta
        ↓ TWS API puerto 4001
IB Gateway (Mac, modo LIVE)
        ↓
Servidores IBKR → precio real YM Jun2026 (conId 793356190)
```

---

## Setup inicial

### Requisitos
- Node.js ≥ 18
- IB Gateway instalado (versión Stable, macOS Apple Silicon)
- Cuenta Interactive Brokers live con suscripción CBOT Real-Time ($1.55/mes)
- 2FA activado con Authy

### 1. Clonar e instalar

```bash
git clone https://github.com/jcarpio/dj-trading-advisor.git
cd dj-trading-advisor
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
# Añade: ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Instalar IBKR Bridge

```bash
mkdir ~/ibkr-bridge
cd ~/ibkr-bridge
# Copiar server.js y package.json desde el repo
npm install @stoqey/ib
```

### 4. Configurar IB Gateway

1. Descargar IB Gateway Stable → ibkr.com → macOS Apple Silicon
2. Login → **IB API** + **Live Trading**
3. Configure → API → Settings:
   - Read-Only API: ☐ desactivado
   - Socket port: **4001**
   - Allow connections from localhost only: ✓

### 5. Configurar Portal IBKR

- Configuración → Suscripciones a datos de mercado → activar **CBOT Real-Time (no profesional, nivel 1)**
- Configuración → Acuse de recibo de la API de datos de mercado → **firmar**

---

## Flujo diario de uso

```bash
# 1. Abrir IB Gateway
#    → Login → código Authy → esperar 3 líneas verdes

# 2. Arrancar bridge (caffeinate evita que el Mac entre en reposo)
cd ~/ibkr-bridge
caffeinate -i node server.js

# 3. Verificar conexión
curl http://localhost:3001/status
curl "http://localhost:3001/price?symbol=YM"
# Debe devolver: {"symbol":"YM","bid":...,"ask":...,"last":...}

# 4. Abrir app
#    Vercel: https://tu-app.vercel.app
#    Local:  cd ~/dj-trading-advisor && npm run dev → localhost:3000

# 5. Analizar contexto → Iniciar monitorización
# 6. Esperar señal → ejecutar en MT5 (Funding Pips)
# 7. Registrar resultado en la app
```

---

## Mensajes de estado del bridge

| Mensaje | Significado |
|---|---|
| `✅ Contexto obtenido — Señal: SELL` | Análisis completado |
| `📡 US30 45.310 pts · IBKR · 11:30:00` | Poll con precio real |
| `🕐 Mercado cerrado · Último H:46502 L:45272` | Bridge activo pero sin precio (fin de semana) |
| `✗ IBKR Bridge no responde` | `node server.js` no está corriendo |

---

## Contratos YM disponibles

```
conId 793356190 = YM Jun 2026  ← ACTIVO
conId 815824220 = YM Sep 2026
conId 840227352 = YM Dic 2026
conId 866514740 = YM Mar 2027
```

Actualizar `YM_CONID` en `~/ibkr-bridge/server.js` cuando ruede el contrato (junio 2026 → cambiar a 815824220).

---

## Pendiente de implementar

- [ ] Botón ejecución automática de órdenes en IBKR (MYM bracket order con SL+TP)
- [ ] Obtener conId de MYM para ejecución directa
- [ ] Parámetros de riesgo MYM: 1 contrato, SL 40 pts = $20 (~2% de €1.000)

---

## Aviso legal

Este análisis no constituye asesoramiento financiero. Solo para uso personal. El trading de CFDs y futuros conlleva un alto nivel de riesgo.
