# DJ Trading Advisor

Asistente de trading para el índice Dow Jones (US30 CFD / YM futuros) con análisis multi-timeframe por IA, monitorización en tiempo real vía IBKR y gestión de riesgo integrada.

---

## ¿Qué hace esta app?

Combina datos históricos de Massive API, precio en tiempo real de Interactive Brokers y análisis de Claude AI para dar señales de entrada precisas en el US30/DJIA.

### Flujo de sesión (máx. 30 minutos al día)

**Fase 1 — Contexto macro (1 llamada a Claude, ~$0.004)**
- Obtiene datos históricos de **Massive API**: 1W + 1D + 4H
- Claude analiza tendencia, soporte/resistencia y devuelve:
  - Señal: BUY / SELL / HOLD
  - Nivel de entrada, stop loss y take profit en puntos US30
  - Condición exacta de entrada en vela de 1 minuto

**Fase 2 — Monitorización en tiempo real (0 llamadas a Claude)**
- **IBKR Bridge** consulta precio del YM cada 20 segundos
- JavaScript detecta localmente:
  - Proximidad a niveles de entrada/stop/objetivo (<30 pts)
  - Tendencia del precio vs señal de contexto
  - Triple alerta cuando se alcanza la condición: visual + sonido + notificación SO

**Gestión de riesgo automática**
- Pérdida máxima diaria: $20 → bloquea la sesión
- Objetivo diario: $40 → avisa y sugiere cerrar
- Máximo 2 operaciones al día
- Cuenta atrás de 30 minutos

---

## Stack

- **Next.js 14** (App Router)
- **Massive REST API** — datos históricos gratuitos (1W, 1D, 4H)
- **IBKR Bridge** — servidor Node.js local que conecta con IB Gateway (precio real YM cada 20s)
- **Claude AI (claude-sonnet-4)** — análisis de contexto, 1 llamada por sesión
- **Vercel** — deploy automático desde GitHub en cada push a main

---

## Instrumentos

| Campo | Funding Pips (principal) | IBKR (futuro) |
|---|---|---|
| Instrumento | US30 CFD | MYM (Micro E-mini Dow) |
| Plataforma | MT5 | IB Gateway |
| Tamaño | 0.05 lotes | 1 contrato |
| Valor/punto | $0.05 | $0.50 |
| Stop loss máx. | 200 pts ($10) | 40 pts ($20) |
| Take profit obj. | 400 pts ($20) | 80 pts ($40) |
| Pérdida máx./día | $20 | $20 |
| Objetivo/día | $40 | $40 |

> **Los precios de YM y MYM son idénticos** — los niveles que da la app son válidos para ambos instrumentos sin conversión.

---

## Arquitectura

```
App Vercel (Next.js)  ←→  Claude AI (análisis contexto)
        ↓
Tu navegador (Mac)
        ↓ fetch localhost:3001
IBKR Bridge (~/ibkr-bridge/server.js)
        ↓ TWS API puerto 4001
IB Gateway (Mac)
        ↓
Servidores IBKR → precio real YM/MYM
```

La app de Vercel sirve el HTML/JS. Todas las llamadas a `localhost:3001` las hace **tu navegador desde tu Mac**, no desde Vercel.

---

## Instalación y setup

### Requisitos
- Node.js ≥ 18
- IB Gateway instalado (ver abajo)
- Cuenta Interactive Brokers con suscripción CBOT Real-Time ($1.55/mes)

### 1. Clonar e instalar app

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
# Copiar server.js y package.json
npm install @stoqey/ib
```

### 4. Configurar IB Gateway

1. Descargar IB Gateway Stable desde ibkr.com (versión macOS Apple Silicon)
2. Login → **IB API** + **Live Trading** → puerto 4001
3. Configure → API → Settings:
   - Read-Only API: ☐ (desactivado)
   - Socket port: 4001
   - Allow connections from localhost only: ✓

---

## Flujo diario de uso

```bash
# 1. Abrir IB Gateway → Login → esperar 3 líneas verdes

# 2. Arrancar bridge
cd ~/ibkr-bridge && node server.js

# 3. Verificar conexión
curl http://localhost:3001/status
curl "http://localhost:3001/price?symbol=YM"

# 4. Abrir app en Vercel
# 5. Analizar contexto → Iniciar monitorización
# 6. Esperar señal → ejecutar en MT5 (Funding Pips)
# 7. Registrar resultado en la app
```

---

## Costes mensuales

| Concepto | Coste |
|---|---|
| Massive API | $0 |
| IBKR CBOT Real-Time | $1.55 |
| Claude AI (~20 sesiones × $0.004) | ~$0.08 |
| Vercel hosting | $0 |
| **Total** | **~$1.63/mes** |

---

## Contratos YM disponibles

```
conId 793356190 = YM Jun 2026  ← ACTIVO
conId 815824220 = YM Sep 2026
conId 840227352 = YM Dic 2026
```

Actualizar `YM_CONID` en `~/ibkr-bridge/server.js` cuando ruede el contrato (junio 2026).

---

## Pendiente de implementar

- [ ] Botón de ejecución automática de órdenes en IBKR (MYM bracket order)
- [ ] Obtener conId de MYM para ejecución directa
- [ ] Stop loss y take profit automáticos al ejecutar

---

## Aviso legal

Este análisis no constituye asesoramiento financiero. Solo para uso personal. El trading de CFDs y futuros conlleva un alto nivel de riesgo.
