#!/usr/bin/env bash
# start_tunnel.sh — expone el backend local y actualiza GitHub Pages
# Uso: bash start_tunnel.sh
set -e

REPO="Nicoej99/sensores-algas-marinas"
LOG=$(mktemp)

echo "▸ Arrancando backend..."
(cd "$(dirname "$0")/backend" && python -m uvicorn main:app --port 8000) &
BACK_PID=$!
sleep 3

echo "▸ Abriendo túnel Cloudflare..."
"/c/Program Files (x86)/cloudflared/cloudflared.exe" tunnel --url http://localhost:8000 --no-autoupdate 2>"$LOG" &
CF_PID=$!

# Esperar hasta que aparezca la URL pública
echo "▸ Esperando URL del túnel..."
PUBLIC_URL=""
for i in $(seq 1 30); do
  PUBLIC_URL=$(grep -oP 'https://[a-z0-9\-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1)
  [ -n "$PUBLIC_URL" ] && break
  sleep 2
done

if [ -z "$PUBLIC_URL" ]; then
  echo "✗ No se pudo obtener la URL del túnel. Revisa el log en: $LOG"
  kill $CF_PID $BACK_PID 2>/dev/null
  exit 1
fi

echo ""
echo "✓ Túnel activo: $PUBLIC_URL"
echo ""

# Actualizar secreto en GitHub y disparar redeploy
echo "▸ Actualizando VITE_API_URL en GitHub Secrets..."
gh secret set VITE_API_URL --body "$PUBLIC_URL" --repo "$REPO"

echo "▸ Disparando redeploy de GitHub Pages..."
gh workflow run deploy.yml --repo "$REPO"

echo ""
echo "══════════════════════════════════════════════"
echo " Backend:    http://localhost:8000"
echo " Túnel:      $PUBLIC_URL"
echo " Pages:      https://nicoej99.github.io/sensores-algas-marinas/"
echo " Redeploy:   ~2 minutos"
echo "══════════════════════════════════════════════"
echo ""
echo " Ctrl+C para cerrar el túnel y el backend."
echo ""

# Mantener vivo — esperar señal de cierre
trap "echo ''; echo '▸ Cerrando...'; kill $CF_PID $BACK_PID 2>/dev/null; exit 0" INT TERM
wait $CF_PID
