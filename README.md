# Golddigger Studio

Panel web para administrar canales, campañas y flujos de producción de video. Diseño oscuro con acentos rojos y marca tipográfica Golddigger, sin símbolo de reproducción ni pepita.

**Estado: base funcional de interfaz para desarrollo, con datos de demostración. No es todavía una plataforma de producción automatizada.** Puedes cargarla en GitHub, ejecutarla en un servidor y continuar implementando servicios reales.

## Inicio rápido (local)

Requisito: Node.js 22 o superior. No hay dependencias que instalar.

```bash
npm run dev
```

Abre http://localhost:3010. Los cambios en `public/` se ven al recargar; los del servidor reinician solos. Si existe un archivo `.env` (ver `.env.example`) se carga automáticamente.

Comprobar antes de subir: `npm run check && npm test`.

## Despliegue automático (golddigger.click)

Funciona igual que Mila: el VPS revisa GitHub **cada minuto**. Cuando hay un commit nuevo en `main`, lo descarga (solo fast-forward), corre las pruebas, reinicia el servicio y comprueba que responda. Si las pruebas o el arranque fallan, regresa solo a la versión anterior. No hay secretos que configurar en GitHub.

Golddigger corre **aislado** de Mila, Beto y el HUB: usuario `golddigger`, carpeta `/opt/golddigger`, Node 22 propio en `/opt/golddigger/node`, servicio `golddigger` en el puerto 3010 (solo local), temporizador `golddigger-actualizar` y su propio sitio de Nginx. No modifica otros sitios, servicios ni el Node del sistema.

### Configuración única

1. **DNS (Hostinger → Dominios → golddigger.click → DNS):** registros `A` de `@` y `www` con la IP del VPS.
2. **VPS:** copia `deploy/setup-vps.sh` al servidor y ejecútalo como root: `bash setup-vps.sh`.
   La primera vez imprime una llave pública: agrégala en GitHub → repo → Settings → Deploy keys (sin permiso de escritura) y vuelve a ejecutar el script.
3. Al terminar muestra la dirección, el estado del servicio y la contraseña del panel.

### Operación en el VPS

```bash
systemctl status golddigger                          # estado de la app
journalctl -u golddigger -f                          # registro en vivo de la app
journalctl -u golddigger-actualizar -n 30            # bitácora de actualizaciones
bash /opt/golddigger/app/deploy/actualizar.sh --ahora  # forzar actualización
touch /opt/golddigger/data/.pausar_actualizaciones   # pausar (borrar el archivo para reanudar)
nano /opt/golddigger/.env && systemctl restart golddigger  # puerto y contraseña del panel
curl http://127.0.0.1:3010/api/health                # versión en línea (commit)
```

`/opt/golddigger/data` queda reservado para base de datos y archivos futuros; las actualizaciones nunca lo tocan. No edites archivos directamente en `/opt/golddigger/app`: los cambios se hacen en GitHub.

## Pantallas incluidas

- Resumen: ingresos por campaña y total, costos y margen de producción.
- Canales: identidades y resultados de ejemplo; filtro global por canal.
- Campañas: tarjetas, pausa visual y reglas de producción.
- Producción: piezas de ejemplo, filtros y ficha de metadatos.
- Calendario: programación ilustrativa.
- Resultados y costos: métricas y desglose de costos simulados.
- Conexiones: estados de configuración de proveedores; no solicita claves.

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

## Qué todavía requiere backend

El formulario de nueva campaña, las conexiones, las piezas, los ingresos y la programación son demostrativos. Guardar una campaña desde su formulario no crea registros; guardar el flujo sí conserva su configuración en el navegador. Pausar una tarjeta solo cambia su estado visual. La aplicación no genera videos, no consume tokens, no accede a cuentas de YouTube y no publica.

Para la siguiente etapa, implementar autenticación, base de datos, almacenamiento multimedia, ejecución de trabajos, autorizaciones por canal, adaptadores de proveedores, registro de consumo y publicación real. Ver [docs/architecture.md](docs/architecture.md).

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
  server/index.js              Servidor HTTP, contraseña opcional y endpoint de salud
  tests/server.test.js         Pruebas de entrega, acceso y aislamiento de archivos
  docs/architecture.md         Guía para añadir backend y proveedores
  deploy/setup-vps.sh          Instalación única en el VPS
  deploy/actualizar.sh         Actualización automática (la corre el VPS cada minuto)
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
