# Golddigger Studio

Panel web para administrar canales, campañas y flujos de producción de video. Diseño oscuro con acentos rojos y marca tipográfica Golddigger, sin símbolo de reproducción ni pepita.

**Estado:** inicio de sesión, PostgreSQL y campañas/flujos guardados en el servidor ya funcionan. Ingresos, vistas y costos siguen siendo simulados, y la producción automatizada (proveedores y YouTube) es la siguiente etapa.

## Inicio rápido (local)

Requisito: Node.js 22 o superior.

```bash
npm install
npm run dev
```

Abre http://localhost:3010 y entra con `admin@golddigger.local` / `golddigger-dev`. Sin `DATABASE_URL` los datos viven en memoria y se pierden al reiniciar; para usar PostgreSQL local define `DATABASE_URL` en `.env` (ver `.env.example`).

Comprobar antes de subir: `npm run check && npm test`. Para correr además las pruebas contra PostgreSQL: `TEST_DATABASE_URL=postgresql://usuario:clave@127.0.0.1/golddigger_test npm test` (la base de pruebas se borra en cada corrida; su nombre debe contener "test").

## Despliegue automático (golddigger.click)

Funciona igual que Mila: el VPS revisa GitHub **cada minuto**. Cuando hay un commit nuevo en `main`, lo descarga (solo fast-forward), corre las pruebas, reinicia el servicio y comprueba que responda. Si las pruebas o el arranque fallan, regresa solo a la versión anterior. No hay secretos que configurar en GitHub.

Golddigger corre **aislado** de Mila, Beto y el HUB: usuario `golddigger`, carpeta `/opt/golddigger`, Node 22 propio en `/opt/golddigger/node`, servicio `golddigger` en el puerto 3010 (solo local), temporizador `golddigger-actualizar` y su propio sitio de Nginx. No modifica otros sitios, servicios ni el Node del sistema.

### Configuración única

1. **DNS (Hostinger → Dominios → golddigger.click → DNS):** registros `A` de `@` y `www` con la IP del VPS.
2. **VPS:** copia `deploy/setup-vps.sh` al servidor y ejecútalo como root: `bash setup-vps.sh`.
   La primera vez imprime una llave pública: agrégala en GitHub → repo → Settings → Deploy keys (sin permiso de escritura) y vuelve a ejecutar el script.
3. Crea la base PostgreSQL propia (`golddigger`), instala dependencias y te pide crear el primer usuario.

### Operación en el VPS

```bash
systemctl status golddigger                          # estado de la app
journalctl -u golddigger -f                          # registro en vivo de la app
journalctl -u golddigger-actualizar -n 30            # bitácora de actualizaciones
bash /opt/golddigger/app/deploy/actualizar.sh --ahora  # forzar actualización
touch /opt/golddigger/data/.pausar_actualizaciones   # pausar (borrar el archivo para reanudar)
bash /opt/golddigger/app/deploy/admin.sh crear-usuario       # nuevo usuario (entra al mismo espacio)
bash /opt/golddigger/app/deploy/admin.sh cambiar-contrasena  # restablecer contraseña
curl http://127.0.0.1:3010/api/health                # versión en línea (commit)
```

`/opt/golddigger/data` queda reservado para base de datos y archivos futuros; las actualizaciones nunca lo tocan. No edites archivos directamente en `/opt/golddigger/app`: los cambios se hacen en GitHub.

## Pantallas incluidas

- Resumen: ingresos por campaña y total, costos y margen de producción.
- Canales: alta de canales propios; filtro global por canal. Aviso para limpiar los datos de ejemplo.
- Campañas: alta, edición, pausa y editor de flujo con versiones.
- Producción: piezas de ejemplo, filtros y ficha de metadatos.
- Calendario: programación ilustrativa.
- Resultados y costos: métricas y desglose de costos simulados.
- Conexiones: estados de configuración de proveedores; no solicita claves.
- Usuarios: equipo del panel, roles (propietario / editor), altas y bajas.

## Editor de flujo

En **Campañas → Reglas de producción**:

- Flujo separado por cada una de las tres campañas de ejemplo.
- Selección de proceso y herramienta según su función.
- Instrucciones, modelo o preset, resultado esperado y campos extra.
- Dependencias de entrada para ramificaciones y uniones.
- Incorporación, eliminación y reordenamiento visual de pasos.
- Prevención de ciclos y conexiones inválidas.
- Límites de costo por ejecución, reintentos y política de fallo configurables.
- Aprobación previa por proceso.
- Validación y simulación textual del recorrido, sin ejecutar proveedores.

Las flechas muestran dependencias; mover un paso con Antes/Después cambia su orden visual, no esas dependencias. Eliminar un paso elimina sus conexiones e indica qué procesos se deben revisar. Las herramientas y presets son opciones de diseño; no verifican disponibilidad de modelos ni credenciales. El límite sumado no es una cotización y excluye reintentos.

Los flujos y la última sección se conservan en `localStorage` con la clave `golddigger:workspace:v1`. **Esto es almacenamiento por navegador y origen, no una base de datos del servidor ni sincronización entre dispositivos.** No almacenar claves de proveedores aquí. Borrar los datos del sitio restaura la demo.

## Datos y API

PostgreSQL guarda usuarios, espacios de trabajo, sesiones, canales, campañas y versiones de flujo. Las migraciones de `server/migrations/` se aplican solas al arrancar.

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/auth/login` · `/api/auth/logout` | Abrir y cerrar sesión (cookie HttpOnly, 30 días) |
| GET | `/api/auth/me` | Usuario y espacio de trabajo actuales |
| POST | `/api/auth/password` | Cambiar contraseña (cierra las demás sesiones) |
| GET/POST | `/api/channels` | Listar y crear canales (aún sin conexión a YouTube) |
| GET/POST | `/api/users` | Usuarios del panel; solo propietarios agregan |
| PATCH/DELETE | `/api/users/:id` | Cambiar rol o quitar acceso (propietarios; siempre queda al menos uno) |
| POST | `/api/demo/clear` | Borrar datos de ejemplo (propietarios; respeta lo creado por el equipo) |
| GET/POST | `/api/campaigns` | Listar y crear campañas |
| GET/PATCH | `/api/campaigns/:id` | Leer, editar, pausar o reanudar |
| GET/PUT | `/api/campaigns/:id/workflow` | Leer el flujo y guardar una versión nueva (`baseVersion` evita pisar cambios ajenos) |

Toda ruta verifica la sesión y que el recurso pertenezca al espacio de trabajo del usuario. El servidor revalida campañas y flujos (opciones del catálogo, dependencias, ciclos, límites). Las escrituras exigen JSON del mismo origen (protección CSRF) y el inicio de sesión limita intentos por IP y correo.

Siguiente etapa: conexión con YouTube por canal, adaptadores de proveedores, ejecución de trabajos y registro real de consumo. Ver [docs/architecture.md](docs/architecture.md).

## Estructura

```text
golddigger/
  public/
    index.html                Entrada HTML, sin dependencias de Codex
    assets/
      styles.css              Diseño y adaptación a pantallas pequeñas
      state.js                Persistencia de demostración en navegador
      app.js                  Pantallas, navegación y formularios
      flow-editor.js          Editor de procesos y validación
  server/index.js              Servidor HTTP, archivos estáticos y endpoint de salud
  server/api.js                Rutas de la API
  server/auth.js               Contraseñas (scrypt), sesiones y límite de intentos
  server/validate.js           Validación de campañas y flujos
  server/store/                PostgreSQL, memoria (pruebas) y datos iniciales
  server/migrations/           Esquema de la base
  server/cli.js                Usuarios desde la terminal
  public/assets/catalog.json   Catálogo compartido: herramientas, opciones y flujo por defecto
  public/assets/api.js         Cliente de la API
  tests/server.test.js         Pruebas de entrega, acceso y aislamiento de archivos
  docs/architecture.md         Guía para añadir backend y proveedores
  deploy/setup-vps.sh          Instalación única en el VPS
  deploy/actualizar.sh         Actualización automática (la corre el VPS cada minuto)
  deploy/admin.sh              Crear usuarios y cambiar contraseñas en el VPS
  .github/workflows/pruebas.yml Pruebas en GitHub en cada push
  .env.example
  package.json
```

El frontend usa HTML, CSS y JavaScript nativos; no requiere compilación. El servidor solo utiliza módulos de Node.js. No hay recursos de CDN ni llamadas a proveedores.

## Backend y seguridad de esta base

`GET /api/health` devuelve el estado y confirma `mode: demo`. Los demás `GET /api/*` devuelven 501; los métodos de escritura, 405. Esto evita simular una integración de producción exitosa.

Solo se entregan `index.html` y los archivos de `public/assets/`. Hay cabeceras de seguridad y pruebas para evitar entregar archivos privados del proyecto. **Todavía no hay inicio de sesión ni separación entre usuarios.** En producción el panel se protege con usuario y contraseña (`GD_AUTH_USER` / `GD_AUTH_PASS` en `/opt/golddigger/.env`); `/api/health` queda público para el monitoreo. Antes de incorporar datos reales, completa esos servicios y la autorización por canal.

## Verificación

Las pruebas corren en GitHub en cada push y otra vez en el VPS antes de cada actualización. La configuración del servidor se valida con la primera ejecución de `deploy/setup-vps.sh`. Las cifras y gráficos son ilustrativos; no representan ingresos reales ni pronósticos de monetización.
