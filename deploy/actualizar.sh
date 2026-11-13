#!/usr/bin/env bash
# Golddigger · actualización automática desde GitHub (mismo esquema que Mila).
# La corre el temporizador golddigger-actualizar.timer (como root) cada minuto; lo instala setup-vps.sh.
# A mano:  sudo bash /opt/golddigger/app/deploy/actualizar.sh --ahora
#
# En cada vuelta:
#   1. Si existe /opt/golddigger/data/.pausar_actualizaciones, no hace nada (salvo con --ahora).
#   2. Pregunta a GitHub qué commit tiene main (consulta ligera, sin descargar).
#   3. Si hay versión nueva: la baja (solo fast-forward, nunca pisa cambios a mano), corre las pruebas,
#      reinicia el servicio golddigger y comprueba que responda.
#   4. Si fallan las pruebas o el arranque, regresa a la versión anterior.
# Bitácora: journalctl -u golddigger-actualizar -n 50
set -uo pipefail

BASE=/opt/golddigger
DIR="$BASE/app"
APP_USER=golddigger
NODE="$BASE/node/bin/node"
ESTADO="$BASE/data/estado_actualizacion.json"
FORZAR=0; [ "${1:-}" = "--ahora" ] && FORZAR=1

COMO() { if [ "$(id -un)" = "$APP_USER" ]; then "$@"; else sudo -H -u "$APP_USER" "$@"; fi; }
fecha() { date '+%Y-%m-%dT%H:%M:%S'; }
estado() {  # resultado mensaje
  local commit; commit="$(COMO git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
  local msg; msg="$(printf '%s' "$2" | head -c 600 | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '{"resultado":"%s","mensaje":"%s","commit":"%s","revisado_en":"%s"}\n' "$1" "$msg" "$commit" "$(fecha)" > "$ESTADO.tmp" \
    && mv "$ESTADO.tmp" "$ESTADO" && chown "$APP_USER:$APP_USER" "$ESTADO" 2>/dev/null
  echo "[$(fecha)] $1: $2"
}

if [ -f "$BASE/data/.pausar_actualizaciones" ] && [ "$FORZAR" -eq 0 ]; then exit 0; fi

ANTES="$(COMO git -C "$DIR" rev-parse HEAD 2>/dev/null)" || { estado "error" "$DIR no es un repositorio git."; exit 1; }
REMOTO="$(COMO git -C "$DIR" ls-remote -q origin refs/heads/main 2>/tmp/gd_lsremote.err | cut -f1)"
if [ -z "$REMOTO" ]; then estado "error" "No se pudo consultar GitHub: $(tail -n 2 /tmp/gd_lsremote.err)"; exit 1; fi
if [ "$REMOTO" = "$ANTES" ] && [ "$FORZAR" -eq 0 ]; then exit 0; fi   # al día: silencioso

if ! COMO git -C "$DIR" fetch -q origin main 2>/tmp/gd_fetch.err; then
  estado "error" "No se pudo descargar de GitHub: $(tail -n 2 /tmp/gd_fetch.err)"; exit 1
fi
NUEVO="$(COMO git -C "$DIR" rev-parse origin/main)"
if [ "$ANTES" != "$NUEVO" ] && ! COMO git -C "$DIR" merge --ff-only -q origin/main 2>/tmp/gd_merge.err; then
  estado "error" "Hay archivos modificados a mano en el servidor; no se actualizó: $(tail -n 3 /tmp/gd_merge.err)"; exit 1
fi

regresar() {
  if [ "$ANTES" != "$NUEVO" ]; then
    COMO git -C "$DIR" reset -q --hard "$ANTES"
    COMO bash -c "git -C '$DIR' rev-parse --short HEAD > '$DIR/VERSION'"
    systemctl restart golddigger
    estado "error" "$1 Se regresó a la versión ${ANTES:0:7}."
  else
    estado "error" "$1"
  fi
  exit 1
}

# Pruebas antes de poner la versión en línea
probar() {
  local f
  for f in server/*.js public/assets/*.js; do "$NODE" --check "$f" || return 1; done
  "$NODE" --test
}
if ! (cd "$DIR" && COMO bash -c "$(declare -f probar); NODE='$NODE'; probar") >/tmp/gd_test.log 2>&1; then
  regresar "Fallaron las pruebas: $(tail -n 5 /tmp/gd_test.log)"
fi

COMO bash -c "git -C '$DIR' rev-parse --short HEAD > '$DIR/VERSION'"
systemctl restart golddigger

PORT="$(grep -E '^PORT=' "$BASE/.env" | cut -d= -f2)"; PORT="${PORT:-3010}"
for _ in $(seq 1 20); do
  sleep 1
  if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/api/health"; then
    if [ "$ANTES" != "$NUEVO" ]; then estado "actualizado" "De ${ANTES:0:7} a ${NUEVO:0:7}: $(COMO git -C "$DIR" log -1 --format=%s | head -c 120)"
    else estado "al_dia" "Reiniciado en ${NUEVO:0:7}."; fi
    exit 0
  fi
done
regresar "Golddigger no respondió después de actualizar (puerto $PORT): $(journalctl -u golddigger -n 5 --no-pager 2>/dev/null | tail -n 5)"
