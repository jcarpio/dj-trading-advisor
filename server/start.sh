#!/bin/bash
# Script de arranque rápido para macOS
# Uso: ./start.sh

echo ""
echo "▲ DJ Trading Advisor — IBKR Bridge"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check IB Gateway is running
if ! curl -sk https://localhost:5000/v1/api/tickle > /dev/null 2>&1; then
  echo "⚠️  IB Gateway no detectado en localhost:5000"
  echo ""
  echo "   Por favor:"
  echo "   1. Abre IB Gateway"
  echo "   2. Inicia sesión con tu usuario IBKR"
  echo "   3. Espera a que aparezca 'Connected'"
  echo "   4. Vuelve a ejecutar: ./start.sh"
  echo ""
  exit 1
fi

echo "✓ IB Gateway detectado"
echo ""
echo "Arrancando bridge en http://localhost:3001..."
echo "Pulsa Ctrl+C para detener"
echo ""

node server.js
