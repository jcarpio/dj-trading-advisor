# DJ Trading Advisor

Análisis de compra/venta del Dow Jones con datos de [Massive API](https://massive.com) y [Claude AI](https://anthropic.com).

## Stack

- **Next.js 14** (App Router)
- **Massive REST API** — datos de mercado en tiempo real
- **Claude AI (claude-sonnet-4)** — análisis técnico y señal BUY/SELL/HOLD

## Setup local

### 1. Clona el repo e instala dependencias

```bash
git clone https://github.com/TU_USUARIO/dj-trading-advisor.git
cd dj-trading-advisor
npm install
```

### 2. Configura variables de entorno

```bash
cp .env.example .env.local
```

Edita `.env.local` y añade tu API key de Anthropic:

```
ANTHROPIC_API_KEY=sk-ant-...
```

> La API key de Massive se introduce en el formulario de la app (no se guarda en servidor).

### 3. Arranca en local

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Deploy en Vercel

### Opción A — Automático desde GitHub (recomendado)

1. Sube el proyecto a GitHub
2. Ve a [vercel.com](https://vercel.com) → **Add New Project**
3. Importa el repositorio
4. En **Environment Variables**, añade:
   - `ANTHROPIC_API_KEY` = tu clave de Anthropic
5. Haz clic en **Deploy**

A partir de aquí, cada `git push` a `main` dispara un deploy automático.

### Opción B — CLI de Vercel

```bash
npm install -g vercel
vercel
# Sigue el asistente interactivo
# Añade las env vars cuando te lo pida o desde el dashboard
```

## Estructura del proyecto

```
dj-trading-advisor/
├── app/
│   ├── layout.js                # Layout raíz
│   ├── page.js                  # Página principal
│   ├── components/
│   │   └── TradingAdvisor.jsx   # Componente principal (cliente)
│   └── api/
│       └── analyze/
│           └── route.js         # API Route — proxy a Claude (servidor)
├── .env.example                 # Plantilla de variables de entorno
├── .gitignore                   # Excluye .env.local y node_modules
└── package.json
```

## Seguridad

- `ANTHROPIC_API_KEY` solo vive en el servidor (API Route de Next.js), nunca se expone al cliente.
- La API key de Massive la introduce el usuario en el formulario. Si prefieres ocultarla también, añade `MASSIVE_API_KEY` a las env vars y crea una API route proxy similar.

## Aviso legal

Este análisis no constituye asesoramiento financiero.
