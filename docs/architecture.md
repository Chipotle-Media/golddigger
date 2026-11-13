# Continuación del desarrollo

## Arquitectura propuesta

```text
Navegador / panel
        ↓ autenticación y permisos
API de Golddigger → PostgreSQL
        ↓
Coordinador de trabajos → trabajadores de producción
        ↓                      ↓
Adaptadores de proveedores   Almacenamiento multimedia
        ↓
OpenAI / Claude / Google / voz / música / YouTube
```

El servidor incluido solo entrega la interfaz y el estado de salud. Los componentes de producción de este diagrama aún deben implementarse.

## Entidades

- `users`, `workspaces`, `memberships`: usuarios y acceso.
- `channels`: workspace, proveedor, ID externo, identidad y zona horaria.
- `campaigns`: canal, nicho, referencias, presupuesto, formato y calendario.
- `workflow_versions`: campaña, versión inmutable, nodos y conexiones validadas.
- `jobs`, `job_steps`: ejecución y estado de cada proceso.
- `assets`: archivos, procedencia, licencias y versiones.
- `provider_connections`: metadatos de conexión y referencia cifrada a secretos.
- `usage_events`: proveedor, modelo, tokens, segundos, unidades, precio, moneda y reintentos.
- `publications`: pieza, canal, ID de YouTube y fecha de publicación.
- `analytics_snapshots`: métricas observadas, fuente, fecha e ingresos estimados.

## Esquema de un proceso

El editor utiliza esta representación de configuración; el backend deberá validarla de nuevo, sin confiar en la validación del navegador.

```json
{
  "id": "script",
  "type": "Guion",
  "name": "Guion principal",
  "tool": "Claude",
  "deps": ["research"],
  "output": "Guion y lista de escenas",
  "prompt": "Narración original de 6–8 minutos.",
  "model": "Predeterminado de campaña",
  "limit": 1,
  "retries": 2,
  "onfail": "Detener y avisar",
  "approval": false,
  "extras": [{"key":"Idioma", "value":"Español"}]
}
```

Los precios y las opciones no están sincronizados con ningún proveedor. `limit` es el máximo configurable por intento en USD. Antes de una ejecución real, el sistema debe reservar saldo, aplicar límites acumulados con reintentos y registrar el consumo observado. Los valores de `extras` son especificaciones editoriales: no ejecutar como código ni interpolar directamente en comandos.

## Contratos sugeridos — no implementados

| Método | Ruta | Propósito |
|---|---|---|
| GET/POST | `/api/campaigns` | Listar y crear campañas |
| GET/PATCH | `/api/campaigns/:id` | Leer y modificar configuración |
| GET/PUT | `/api/campaigns/:id/workflow` | Leer y versionar el flujo |
| POST | `/api/campaigns/:id/runs` | Reservar presupuesto e iniciar ejecución |
| GET | `/api/runs/:id` | Progreso y consumo real |
| POST | `/api/runs/:id/cancel` | Cancelación coordinada |
| GET | `/api/providers` | Capacidades disponibles y conexión |
| GET | `/api/youtube/oauth/start` | Iniciar autorización por canal |
| GET | `/api/youtube/oauth/callback` | Validar estado y guardar autorización |
| POST | `/api/publications` | Cargar y programar una pieza validada |
| GET | `/api/analytics` | Métricas reales según permisos |

Todas las rutas deben verificar usuario, workspace y canal. Los identificadores recibidos del cliente no otorgan permisos. No enviar tokens OAuth ni claves API al frontend.

## Ejecución

1. Validar el grafo y las capacidades de cada adaptador.
2. Fijar una versión del flujo y reservar presupuesto de forma atómica.
3. Crear trabajos persistentes y ejecutar nodos con sus dependencias satisfechas.
4. Guardar recursos y eventos de consumo por intento.
5. Esperar aprobaciones explícitas configuradas.
6. Detener, reintentar o solicitar revisión según reglas y presupuesto restante.
7. Guardar el ID externo antes de reintentar cargas, reconciliando el estado para evitar duplicados.
8. Consultar métricas y ajustar escenarios con historial propio.

## Proveedores

Crear un adaptador por proveedor que declare funciones, modelos, entradas, salidas, estimación, ejecución, consulta de estado y cancelación cuando se admita. Guardar versión del precio y la moneda en cada evento de consumo.

- OpenAI y Claude: conectar mediante API desde el backend.
- Google: validar acceso a generación de video por API; la interfaz Flow y la API no son equivalentes.
- Suno: el acceso autorizado a generación y los derechos comerciales están pendientes de verificar. No asumir disponibilidad de una API pública ni sustituirla automáticamente por un tercero.
- YouTube: autorización por canal, carga, procesamiento, metadatos, miniatura, fecha, cuotas y recuperación de fallos.
- Música y recursos: guardar fuente, licencia y restricciones de uso.

La existencia de una herramienta en el selector no significa que esté conectada o habilitada. Conectar servicios, implementar las tareas y comprobar la publicación debe hacerse antes de habilitar el piloto automático real.
