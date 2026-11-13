# Golddigger — notas para trabajar en este repo

- Producción: https://golddigger.click (VPS Hostinger, aislado de Mila, Beto y el HUB).
- Cada push a `main` se instala solo en ~1 min: `deploy/actualizar.sh` (timer `golddigger-actualizar`) hace fast-forward, instala dependencias si cambió `package-lock.json`, corre `node --check` + `node --test`, reinicia `golddigger` y verifica `/api/health`; si falla, regresa a la versión anterior.
- Antes de subir: `npm run check && npm test`. No subir cambios que rompan pruebas.
- Node 22. Única dependencia: `pg` (se carga solo con `DATABASE_URL`, así las pruebas no la necesitan). Frontend nativo en `public/` (sin compilación).
- Datos: PostgreSQL (`server/store/postgres.js`) y almacén en memoria con la misma interfaz (`server/store/memory.js`) para pruebas/desarrollo. Cambios de esquema = archivo nuevo en `server/migrations/NNN_*.sql` (se aplica al arrancar). Toda ruta filtra por `workspace_id` de la sesión.
- `public/assets/catalog.json` es la fuente única de herramientas/opciones; el servidor valida contra él.
- Todo dato de usuario que se pinte en HTML pasa por `esc()`; CSP prohíbe scripts en línea.
- Pruebas con Postgres: `TEST_DATABASE_URL=... npm test` (borra esa base).
- Servicio en `127.0.0.1:3010` detrás de Nginx. Variables en `/opt/golddigger/.env` (no en el repo), incluida `DATABASE_URL`. Usuarios: `bash /opt/golddigger/app/deploy/admin.sh crear-usuario`. Datos persistentes futuros en `/opt/golddigger/data`.
- Interfaz en español neutro de México (tuteo). Diseño oscuro con acento rojo `#ff0033`.
- `/api/health` devuelve el commit en línea (`version`): úsalo para confirmar que un despliegue entró.
- Credenciales: siempre cifradas con `server/vault.js` (llave en `/opt/golddigger/data/secret.key`); nunca devolver llaves ni tokens al navegador (solo `secretHint`). Llamadas externas reciben `fetchImpl` para poder simularlas en pruebas.
