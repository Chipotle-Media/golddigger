# Golddigger — notas para trabajar en este repo

- Producción: https://golddigger.click (VPS Hostinger, aislado de Mila, Beto y el HUB).
- Cada push a `main` se instala solo en ~1 min: `deploy/actualizar.sh` (timer `golddigger-actualizar`) hace fast-forward, corre `node --check` + `node --test`, reinicia `golddigger` y verifica `/api/health`; si falla, regresa a la versión anterior.
- Antes de subir: `npm run check && npm test`. No subir cambios que rompan pruebas.
- Node 22, sin dependencias externas. Frontend nativo en `public/` (sin compilación); servidor en `server/index.js`.
- Servicio en `127.0.0.1:3010` detrás de Nginx. Variables en `/opt/golddigger/.env` (no en el repo). Datos persistentes futuros en `/opt/golddigger/data`.
- Interfaz en español neutro de México (tuteo). Diseño oscuro con acento rojo `#ff0033`.
- `/api/health` devuelve el commit en línea (`version`): úsalo para confirmar que un despliegue entró.
