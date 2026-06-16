# Deploy backend en Railway

## Requisitos previos

- Cuenta en [railway.app](https://railway.app) (free tier suficiente)
- `gh` CLI autenticado con cuenta `CamiloArteaga`
- Repo `CamiloArteaga/Sensores-Ph-od` ya en GitHub

---

## Paso 1 — Crear el proyecto en Railway

1. Ir a [railway.app/new](https://railway.app/new)
2. **Deploy from GitHub repo**
3. Seleccionar `CamiloArteaga/Sensores-Ph-od`
4. Railway detecta el repo — NO hacer deploy todavía

---

## Paso 2 — Configurar el servicio

En el servicio creado:

**Settings → Root Directory:**
```
backend
```

Railway usará `backend/railway.toml` para el start command (`uvicorn main:app --host 0.0.0.0 --port $PORT`).

---

## Paso 3 — Variables de entorno

En el servicio → **Variables** → agregar:

| Variable | Valor |
|---|---|
| `API_KEY` | clave secreta que tú elijas (ej: `algas-2026-abc123`) |
| `DB_PATH` | `/app/readings.db` |

Guardar y hacer deploy.

---

## Paso 4 — Obtener la URL pública

Railway asigna una URL tipo:
```
https://sensores-ph-od-production.railway.app
```

Copiar esa URL.

---

## Paso 5 — Configurar el pusher local

```bash
cd pusher
cp .env.example .env
```

Editar `pusher/.env`:
```
SERIAL_PORT=COM3
CLOUD_URL=https://sensores-ph-od-production.railway.app
DEVICE_ID=piscina_1
API_KEY=algas-2026-abc123   # la misma que pusiste en Railway
POLL_INTERVAL=2
```

Instalar dependencias y correr:
```bash
pip install -r requirements.txt
python pusher.py
```

---

## Paso 6 — Actualizar el frontend

Con la URL fija de Railway, actualizar el secret de GitHub **una sola vez**:

```bash
gh secret set VITE_API_URL \
  --body "https://sensores-ph-od-production.railway.app" \
  --repo CamiloArteaga/Sensores-Ph-od

gh workflow run deploy.yml --repo CamiloArteaga/Sensores-Ph-od
```

Después de ~2 minutos el dashboard en GitHub Pages apunta al backend en Railway.
Ya no se necesita el túnel Cloudflare (`start_tunnel.sh`).

---

## Verificación

```bash
BASE=https://sensores-ph-od-production.railway.app

# Estado del backend
curl $BASE/api/status

# Últimas lecturas (vacío hasta que el pusher envíe algo)
curl $BASE/api/latest

# Forzar un envío de prueba
curl -X POST $BASE/api/ingest \
  -H "Content-Type: application/json" \
  -H "x-api-key: algas-2026-abc123" \
  -d '{"id":"piscina_1","pH":7.0,"DO":9.5,"temp":25.0}'
```

---

## Notas

- **SQLite en Railway:** los datos persisten entre reinicios del proceso pero se pierden en cada redeploy (al hacer push al repo). Para producción, migrar a Supabase (ver `docs/migration-v2.md`).
- **Free tier Railway:** 500 horas/mes. Con un solo servicio es suficiente para uso continuo si se mantiene activo. Si Railway pausa el servicio por inactividad, el pusher reintenta automáticamente cada 5s.
- **CORS:** el backend acepta cualquier origen (`allow_origins=["*"]`), OK para este caso de uso.
