#!/usr/bin/env bash
# Golddigger · instalación única en el VPS (ejecutar como root).
#
# Deja Golddigger aislado de las demás apps del servidor:
#   - Usuario de sistema propio: golddigger
#   - Carpeta propia: /opt/golddigger (app/, data/, node/, .env)
#   - Node.js 22 privado en /opt/golddigger/node (no toca el Node del sistema)
#   - Servicio systemd propio: golddigger
#   - Sitio Nginx propio: golddigger.click (no modifica los sitios existentes)
#   - Base PostgreSQL propia: golddigger (usuario y base nuevos, no toca otras bases)
#   - Actualización automática desde GitHub cada minuto (igual que Mila)
#
# Uso:  bash setup-vps.sh   (es seguro correrlo más de una vez)
# Opcional:  DOMAIN=golddigger.click PORT=3010 CERTBOT_EMAIL=tu@correo.com bash setup-vps.sh
set -euo pipefail

DOMAIN="${DOMAIN:-golddigger.click}"
PORT="${PORT:-3010}"
APP_USER="golddigger"
REPO="${REPO:-Chipotle-Media/golddigger}"
BASE="/opt/golddigger"
NODE_MAJOR="22"

say()  { printf '\n\033[1;31m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Ejecuta este script como root."
command -v systemctl >/dev/null || fail "Se necesita systemd."

# ── 1. Comprobaciones para no chocar con Mila, Beto ni el HUB ────────────────
say "Comprobando que el puerto $PORT esté libre"
if ss -ltnH "( sport = :$PORT )" | grep -q .; then
  if systemctl is-active --quiet golddigger 2>/dev/null; then
    echo "El puerto lo usa el propio servicio golddigger (reinstalación). Continúo."
  else
    fail "El puerto $PORT ya está en uso por otra app. Vuelve a ejecutar con otro: PORT=3020 bash setup-vps.sh"
  fi
fi

if ! command -v nginx >/dev/null; then
  if ss -ltnH "( sport = :80 )" | grep -q .; then
    fail "No hay Nginx pero algo ya usa el puerto 80 (¿Docker/Traefik/Apache?). Avísale a Claude qué proxy usa el VPS antes de seguir."
  fi
fi

# ── 2. Paquetes básicos (solo instala lo que falte) ──────────────────────────
say "Instalando paquetes necesarios (git, nginx, certbot, curl)"
export DEBIAN_FRONTEND=noninteractive
need=()
for pkg in git nginx certbot python3-certbot-nginx curl xz-utils; do
  dpkg -s "$pkg" >/dev/null 2>&1 || need+=("$pkg")
done
if [ ${#need[@]} -gt 0 ]; then
  apt-get update -qq
  apt-get install -y -qq "${need[@]}"
fi
systemctl enable --now nginx >/dev/null

# ── 3. Usuario y carpetas propias ────────────────────────────────────────────
say "Creando usuario y carpetas en $BASE"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /bin/bash "$APP_USER"
mkdir -p "$BASE/app" "$BASE/data" "$BASE/.ssh"
chown -R "$APP_USER:$APP_USER" "$BASE/app" "$BASE/data" "$BASE/.ssh"
chown root:root "$BASE"
chmod 755 "$BASE"
chmod 700 "$BASE/.ssh"

# ── 4. Node.js 22 privado (no afecta a otras apps) ───────────────────────────
case "$(uname -m)" in
  x86_64) NODE_ARCH="x64" ;;
  aarch64|arm64) NODE_ARCH="arm64" ;;
  *) fail "Arquitectura no soportada: $(uname -m)" ;;
esac
if [ -x "$BASE/node/bin/node" ] && "$BASE/node/bin/node" -v | grep -q "^v$NODE_MAJOR\."; then
  say "Node.js privado ya instalado: $("$BASE/node/bin/node" -v)"
else
  say "Descargando Node.js $NODE_MAJOR privado"
  tmp="$(mktemp -d)"
  url="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  curl -fsSL "$url/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file="$(grep -o "node-v[0-9.]*-linux-$NODE_ARCH\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)"
  [ -n "$file" ] || fail "No encontré el paquete de Node.js para linux-$NODE_ARCH."
  curl -fsSL "$url/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || fail "La suma de verificación de Node.js no coincide."
  rm -rf "$BASE/node" && mkdir -p "$BASE/node"
  tar -xJf "$tmp/$file" -C "$BASE/node" --strip-components=1
  rm -rf "$tmp"
  echo "Instalado $("$BASE/node/bin/node" -v) en $BASE/node"
fi

# ── 5. Variables de entorno ─────────────────────────────────────────────────
if [ ! -f "$BASE/.env" ]; then
  say "Creando $BASE/.env"
  cat > "$BASE/.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
EOF
fi
chown root:"$APP_USER" "$BASE/.env"
chmod 640 "$BASE/.env"

# ── 5b. PostgreSQL: base y usuario propios (no toca las bases de otras apps) ─
say "Configurando PostgreSQL"
pg() { (cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -tAq "$@"); }
if ! pg -c 'SELECT 1' >/dev/null 2>&1; then
  echo "PostgreSQL no está instalado o no responde; instalándolo."
  apt-get install -y -qq postgresql
  systemctl enable --now postgresql >/dev/null
  pg -c 'SELECT 1' >/dev/null || fail "PostgreSQL no responde. Revisa: systemctl status postgresql"
fi
if ! grep -q '^DATABASE_URL=' "$BASE/.env"; then
  DB_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 || true)"
  PG_PORT="$(pg -c 'SHOW port')"
  if [ "$(pg -c "SELECT 1 FROM pg_roles WHERE rolname = 'golddigger'")" = "1" ]; then
    pg -c "ALTER ROLE golddigger WITH LOGIN PASSWORD '$DB_PASS'"
  else
    pg -c "CREATE ROLE golddigger WITH LOGIN PASSWORD '$DB_PASS'"
  fi
  if [ "$(pg -c "SELECT 1 FROM pg_database WHERE datname = 'golddigger'")" != "1" ]; then
    pg -c "CREATE DATABASE golddigger OWNER golddigger ENCODING 'UTF8' TEMPLATE template0"
  fi
  pg -d golddigger -c "REVOKE ALL ON DATABASE golddigger FROM PUBLIC; GRANT ALL ON SCHEMA public TO golddigger; ALTER SCHEMA public OWNER TO golddigger"
  echo "DATABASE_URL=postgresql://golddigger:$DB_PASS@127.0.0.1:$PG_PORT/golddigger" >> "$BASE/.env"
  echo "Base de datos «golddigger» lista (puerto $PG_PORT)."
fi
DBURL="$(grep '^DATABASE_URL=' "$BASE/.env" | cut -d= -f2-)"
(cd /tmp && psql "$DBURL" -tAc 'SELECT 1' >/dev/null 2>&1) \
  || fail "No se pudo entrar a la base con DATABASE_URL. Revisa que pg_hba.conf permita contraseña para 127.0.0.1."

# ── 6. Servicio systemd ──────────────────────────────────────────────────────
say "Configurando el servicio golddigger"
cat > /etc/systemd/system/golddigger.service <<EOF
[Unit]
Description=Golddigger Studio
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/app
EnvironmentFile=$BASE/.env
ExecStart=$BASE/node/bin/node server/index.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$BASE/data

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable golddigger >/dev/null

# ── 7. Conexión con GitHub (llave de solo lectura, exclusiva de este repo) ───
say "Conectando con GitHub ($REPO)"
KEY="$BASE/.ssh/id_ed25519"
if [ ! -f "$KEY" ]; then
  sudo -H -u "$APP_USER" ssh-keygen -t ed25519 -N "" -C "golddigger-vps" -f "$KEY" >/dev/null
fi
sudo -H -u "$APP_USER" bash -c "ssh-keyscan -t ed25519 github.com >> '$BASE/.ssh/known_hosts' 2>/dev/null; sort -u -o '$BASE/.ssh/known_hosts' '$BASE/.ssh/known_hosts'"

if [ ! -d "$BASE/app/.git" ]; then
  if ! sudo -H -u "$APP_USER" git ls-remote -q "git@github.com:$REPO.git" >/dev/null 2>&1; then
    echo
    echo "Falta autorizar al VPS en GitHub (solo una vez):"
    echo "  1. Abre https://github.com/$REPO/settings/keys/new"
    echo "  2. Title: VPS   ·   Key: pega la línea de abajo   ·   NO marques 'Allow write access'"
    echo
    cat "$KEY.pub"
    echo
    echo "  3. Vuelve a ejecutar:  bash setup-vps.sh"
    exit 0
  fi
  # Carpeta propia de Golddigger; en la primera instalación está vacía.
  find "$BASE/app" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  sudo -H -u "$APP_USER" git clone -q "git@github.com:$REPO.git" "$BASE/app"
  echo "Código descargado en $BASE/app"
fi
sudo -H -u "$APP_USER" bash -c "git -C '$BASE/app' rev-parse --short HEAD > '$BASE/app/VERSION'"

say "Instalando dependencias de la app"
sudo -H -u "$APP_USER" bash -c "cd '$BASE/app' && PATH='$BASE/node/bin':\$PATH npm_config_cache='$BASE/data/.npm' npm ci --omit=dev --no-audit --no-fund --loglevel=error" \
  || fail "No se pudieron instalar las dependencias."
sha256sum "$BASE/app/package-lock.json" | cut -d' ' -f1 > "$BASE/data/.deps_hash"
chown "$APP_USER:$APP_USER" "$BASE/data/.deps_hash"
systemctl restart golddigger

# ── 8. Actualización automática cada minuto (como Mila) ──────────────────────
say "Activando actualización automática"
cat > /etc/systemd/system/golddigger-actualizar.service <<UNIT
[Unit]
Description=Golddigger: actualizacion automatica desde GitHub
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $BASE/app/deploy/actualizar.sh
UNIT
cat > /etc/systemd/system/golddigger-actualizar.timer <<UNIT
[Unit]
Description=Golddigger: busca cambios en GitHub cada minuto

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=5s
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now golddigger-actualizar.timer >/dev/null

# ── 9. Sitio Nginx propio ────────────────────────────────────────────────────
say "Configurando Nginx para $DOMAIN"
if [ -d /etc/nginx/sites-available ]; then
  SITE="/etc/nginx/sites-available/$DOMAIN"; LINK="/etc/nginx/sites-enabled/$DOMAIN"
else
  SITE="/etc/nginx/conf.d/$DOMAIN.conf"; LINK=""
fi
if [ ! -f "$SITE" ]; then
  cat > "$SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;

    client_max_body_size 50m;
    gzip on;
    gzip_types text/css application/javascript text/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
    }
}
EOF
fi
[ -n "$LINK" ] && ln -sf "$SITE" "$LINK"
nginx -t || fail "La configuración de Nginx tiene un error. No se recargó; las otras apps siguen igual."
systemctl reload nginx

# ── 10. HTTPS con Let's Encrypt (si el DNS ya apunta aquí) ────────────────────
say "Revisando DNS de $DOMAIN"
PROTO=http
SERVER_IP="$(curl -fsS4 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
WWW_IP="$(getent ahostsv4 "www.$DOMAIN" | awk 'NR==1{print $1}' || true)"
EMAIL_ARGS=(--register-unsafely-without-email)
[ -n "${CERTBOT_EMAIL:-}" ] && EMAIL_ARGS=(-m "$CERTBOT_EMAIL")
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "Ya hay certificado HTTPS para $DOMAIN (se renueva solo)."
  PROTO=https
elif [ -n "$SERVER_IP" ] && [ "$DNS_IP" = "$SERVER_IP" ]; then
  DOMAINS=(-d "$DOMAIN"); [ "$WWW_IP" = "$SERVER_IP" ] && DOMAINS+=(-d "www.$DOMAIN")
  certbot --nginx --non-interactive --agree-tos --redirect "${EMAIL_ARGS[@]}" "${DOMAINS[@]}" \
    && PROTO=https || echo "Certbot falló; puedes reintentar más tarde (comando abajo)."
else
  echo "El DNS de $DOMAIN apunta a '${DNS_IP:-nada}' y el VPS es '${SERVER_IP:-?}'. Configura el registro A y luego ejecuta:"
  echo "  certbot --nginx --agree-tos --redirect -d $DOMAIN -d www.$DOMAIN"
fi

# ── Primer usuario ───────────────────────────────────────────────────────────
for _ in $(seq 1 15); do curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health" && break; sleep 1; done
USERS="$(cd /tmp && psql "$DBURL" -tAc 'SELECT count(*) FROM users' 2>/dev/null || echo '?')"
if [ "$USERS" = "0" ] && [ -t 0 ]; then
  say "Crea tu usuario para entrar al panel"
  bash "$BASE/app/deploy/admin.sh" crear-usuario || true
fi

# ── Resumen ──────────────────────────────────────────────────────────────────
HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/api/health" || echo 'sin respuesta')"
say "Listo"
echo "  Sitio:      $PROTO://$DOMAIN"
echo "  Servicio:   $HEALTH"
echo
echo "  Usuarios:   bash $BASE/app/deploy/admin.sh crear-usuario"
echo "              bash $BASE/app/deploy/admin.sh cambiar-contrasena"
echo "  Cada push a main en GitHub se instala solo en ~1 minuto (pruebas → reinicio → verificación)."
echo "  Bitácora:   journalctl -u golddigger-actualizar -n 30"
echo "  Forzar:     bash $BASE/app/deploy/actualizar.sh --ahora"
