# DJ Trading Advisor

Asistente de trading para el índice Dow Jones (US30 CFD) con análisis multi-timeframe por IA, monitorización en tiempo real y gestión de riesgo integrada.

---

## ¿Qué hace esta app?

La app combina dos fuentes de datos y una llamada a Claude AI para ayudar a tomar decisiones de entrada en operaciones cortas sobre el US30/DJIA CFD en MT5.

### Flujo de sesión (máx. 30 minutos al día)

**Fase 1 — Contexto macro (1 llamada a Claude, ~$0.004)**
- Obtiene datos históricos de **Massive API**: barras semanales (1W), diarias (1D) y de 4 horas (4H)
- Claude analiza los tres timeframes y devuelve:
  - Señal de contexto: BUY / SELL / HOLD
  - Tendencia macro y operativa
  - Niveles de soporte y resistencia en puntos US30
  - Condición exacta de entrada en vela de 1 minuto
  - Nivel de entrada, stop loss y take profit en puntos US30

**Fase 2 — Monitorización en tiempo real (0 llamadas a Claude)**
- Consulta **Twelve Data API** cada 60 segundos con barras de 1 minuto
- JavaScript detecta localmente:
  - Precio actual en puntos US30 (DIA × 100)
  - Aproximación a niveles de entrada, stop y objetivo (alertas a <30 pts)
  - Patrones de vela: martillo, estrella fugaz, envolvente, doji, momentum
  - Tendencia de la vela vs señal de contexto
- Triple alerta al detectar condición de entrada: visual + sonido + notificación del SO

**Gestión de riesgo automática**
- Pérdida máxima diaria: $20 → bloquea la sesión automáticamente
- Objetivo diario: $40 → avisa y sugiere cerrar
- Máximo 2 operaciones al día (0.05 lotes cada una)
- Cuenta atrás de 30 minutos de sesión visible en pantalla

---

## Stack

- **Next.js 14** (App Router, `use client`)
- **Massive REST API** — datos históricos (1W, 1D, 4H) plan gratuito
- **Twelve Data API** — datos intraday 1min tiempo real (plan gratuito: 8 req/min, 800/día)
- **Claude AI (claude-sonnet-4)** — análisis de contexto, 1 llamada por sesión
- **Vercel** — deploy automático desde GitHub en cada push a main

---

## Instrumento operado

| Campo | Valor |
|---|---|
| Instrumento | US30 / DJIA CFD |
| Broker | Funding Pips |
| Plataforma | MT5 |
| Lote por operación | 0.05 |
| Valor por punto | $0.05 |
| Stop loss máx. | 200 puntos ($10) |
| Take profit obj. | 400 puntos ($20) |
| Pérdida máx. diaria | $20 |
| Objetivo diario | $40 |
| Máx. operaciones/día | 2 |

### Conversión DIA ↔ US30

El ETF DIA replica el Dow Jones a razón de 1/100. La app convierte automáticamente:

```
US30 puntos ≈ precio DIA × 100
Ejemplo: DIA $464.14 ≈ US30 46.414 pts
```

---

## Horario recomendado de operativa

Los datos de DIA solo están disponibles en **horario regular americano**:

| Sesión | Horario ET | Horario Madrid (verano) |
|---|---|---|
| Pre-market | 04:00–09:30 | 10:00–15:30 |
| Mercado regular | 09:30–16:00 | 15:30–22:00 |
| After-hours | 16:00–20:00 | 22:00–02:00 |

> Para operativas en horario europeo de mañana (10:00–12:30 Madrid), DIA no tiene datos disponibles porque el mercado americano aún no ha abierto. Se recomienda operar en **15:30–18:00 Madrid** para aprovechar la apertura americana con datos en tiempo real.

---

## Instalación local

### 1. Clonar e instalar

```bash
git clone https://github.com/TU_USUARIO/dj-trading-advisor.git
cd dj-trading-advisor
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

Editar `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

> Las API keys de Massive y Twelve Data se introducen en el formulario de la app. Nunca se guardan en servidor ni en el repo.

### 3. Arrancar en local

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000)

---

## Deploy en Vercel con auto-deploy desde GitHub

```bash
# 1. Inicializar repo y subir a GitHub
git init
git add .
git commit -m "feat: initial commit"
git remote add origin https://github.com/TU_USUARIO/dj-trading-advisor.git
git push -u origin main

# 2. En vercel.com → Add New Project → importar repo
# 3. Añadir variable de entorno: ANTHROPIC_API_KEY
# 4. Deploy → cada git push a main despliega automáticamente
```

---

## Estructura del proyecto

```
dj-trading-advisor/
├── app/
│   ├── layout.js                    # Layout raíz (dark theme)
│   ├── page.js                      # Página principal
│   ├── components/
│   │   └── TradingAdvisor.jsx       # Componente principal (cliente)
│   └── api/
│       └── analyze/
│           └── route.js             # Proxy server-side a Claude AI
├── .env.example                     # Plantilla de variables de entorno
├── .gitignore                       # Excluye .env.local y node_modules
├── next.config.js
├── package.json
├── README.md
└── CHANGES.txt                      # Historial de cambios
```

---

## APIs utilizadas

### Massive API
- **Web**: [massive.com](https://massive.com)
- **Plan requerido**: Free (5 req/min, 2 años histórico, end-of-day)
- **Endpoints usados**:
  - `GET /v2/aggs/ticker/{ticker}/range/1/week/...`
  - `GET /v2/aggs/ticker/{ticker}/range/1/day/...`
  - `GET /v2/aggs/ticker/{ticker}/range/4/hour/...`

### Twelve Data API
- **Web**: [twelvedata.com](https://twelvedata.com)
- **Plan requerido**: Free (8 req/min, 800/día, US intraday)
- **Endpoint usado**:
  - `GET /time_series?symbol=DIA&interval=1min&outputsize=10`

### Anthropic Claude API
- **Web**: [console.anthropic.com](https://console.anthropic.com)
- **Modelo**: `claude-sonnet-4-20250514`
- **Uso**: 1 llamada por sesión (~$0.004)
- **Seguridad**: la clave nunca sale al navegador — pasa por API Route de Next.js

---

## Coste estimado

| Concepto | Coste mensual |
|---|---|
| Massive API | $0 |
| Twelve Data API | $0 |
| Claude AI (~20 sesiones × $0.004) | ~$0.08 |
| Vercel hosting | $0 |
| **Total** | **~$0.08/mes** |

---

## Datos locales (localStorage)

La app guarda automáticamente en el navegador:
- Hasta 30 análisis de contexto con señal, niveles y resumen
- P&L y operaciones del día (se resetea cada día automáticamente)

Los datos son locales — no se sincronizan entre dispositivos ni se envían a ningún servidor.

---

## Aviso legal

Este análisis no constituye asesoramiento financiero. Solo para uso personal. El trading de CFDs conlleva un alto nivel de riesgo y puede no ser adecuado para todos los inversores.
