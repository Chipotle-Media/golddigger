import { createMemoryStore } from './memory.js';

/**
 * Elige el almacén según el entorno:
 *  - DATABASE_URL definida → PostgreSQL (producción).
 *  - Sin DATABASE_URL en desarrollo → memoria (se pierde al reiniciar).
 *  - Sin DATABASE_URL en producción → null: el panel avisa que falta configurar la base.
 */
export async function createStoreFromEnv(env = process.env) {
  if (env.DATABASE_URL) {
    const { createPostgresStore } = await import('./postgres.js');
    const store = await createPostgresStore(env.DATABASE_URL);
    await store.migrate();
    return store;
  }
  if (env.NODE_ENV === 'production') return null;
  return createMemoryStore();
}

export { createMemoryStore };
