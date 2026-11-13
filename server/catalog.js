import { readFileSync } from 'node:fs';

/** Catálogo compartido con la interfaz (public/assets/catalog.json): una sola fuente de verdad. */
export const catalog = JSON.parse(readFileSync(new URL('../public/assets/catalog.json', import.meta.url), 'utf8'));

/** Flujo inicial de una campaña sin versiones guardadas. */
export function defaultFlow() {
  return catalog.defaultFlow.map(([id, type, deps]) => ({
    id, type, name: type,
    tool: catalog.processes[type].tools[0],
    deps: [...deps],
    output: catalog.processes[type].output,
    prompt: catalog.processes[type].prompt,
    model: 'Predeterminado de campaña',
    limit: type === 'Escenas' ? 5 : 1,
    retries: 2,
    onfail: catalog.onFail[0],
    approval: type === 'Control de calidad',
    extras: []
  }));
}
