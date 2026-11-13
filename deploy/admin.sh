#!/usr/bin/env bash
# Golddigger · administración de usuarios en el VPS (ejecutar como root).
#   bash /opt/golddigger/app/deploy/admin.sh crear-usuario
#   bash /opt/golddigger/app/deploy/admin.sh cambiar-contrasena
#   bash /opt/golddigger/app/deploy/admin.sh espacios
set -euo pipefail
BASE=/opt/golddigger
[ "$(id -u)" -eq 0 ] || { echo "Ejecútalo como root (o con sudo)."; exit 1; }
cd "$BASE/app"
exec sudo -H -u golddigger env GD_ENV_FILE="$BASE/.env" PATH="$BASE/node/bin:$PATH" node server/cli.js "$@"
