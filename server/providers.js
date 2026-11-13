import { catalog } from './catalog.js';

/**
 * Prueba de conexión por proveedor: una llamada barata de solo lectura que confirma que la llave funciona.
 * Devuelve { ok, label } o { ok: false, error }. `fetchImpl` se inyecta en pruebas.
 */
const TIMEOUT = 12000;

async function call(fetchImpl, url, headers) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
  let body = null;
  try { body = await res.json(); } catch { /* sin JSON */ }
  return { status: res.status, ok: res.ok, body };
}

const rejected = (name, r) =>
  r.status === 401 || r.status === 403 ? `${name} rechazó la llave (revisa que esté completa y activa).`
    : r.status === 429 ? `${name} respondió que se superó el límite o no hay saldo. Revisa tu plan.`
      : `${name} respondió con un error (${r.status}).`;

export const TESTS = {
  async anthropic(key, f) {
    const r = await call(f, 'https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
    if (!r.ok) return { ok: false, error: rejected('Anthropic', r) };
    return { ok: true, label: `${r.body?.data?.length ?? 0} modelos disponibles` };
  },
  async openai(key, f) {
    const r = await call(f, 'https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
    if (!r.ok) return { ok: false, error: rejected('OpenAI', r) };
    return { ok: true, label: `${r.body?.data?.length ?? 0} modelos disponibles` };
  },
  async google_ai(key, f) {
    const r = await call(f, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': key });
    if (!r.ok) return { ok: false, error: r.status === 400 ? 'Google no reconoce la llave. Cópiala de nuevo desde Google AI Studio.' : rejected('Google AI', r) };
    const models = (r.body?.models || []).map((m) => m.name || '');
    const veo = models.filter((n) => n.includes('veo'));
    return { ok: true, label: veo.length ? `Veo disponible (${veo.length} modelos)` : 'Gemini disponible · Veo no aparece en esta cuenta (puede requerir facturación activa)' };
  },
  async elevenlabs(key, f) {
    const r = await call(f, 'https://api.elevenlabs.io/v1/user', { 'xi-api-key': key });
    if (r.ok) return { ok: true, label: `Plan ${r.body?.subscription?.tier || 'activo'}` };
    // Las llaves con permisos restringidos pueden no leer el perfil, pero sí sirven para generar.
    if (r.status === 401 && JSON.stringify(r.body || {}).includes('missing_permissions')) return { ok: true, label: 'Llave válida (permisos restringidos)' };
    return { ok: false, error: rejected('ElevenLabs', r) };
  },
  async pexels(key, f) {
    const r = await call(f, 'https://api.pexels.com/v1/search?query=nature&per_page=1', { Authorization: key });
    if (!r.ok) return { ok: false, error: rejected('Pexels', r) };
    return { ok: true, label: 'Biblioteca de clips disponible' };
  }
};

export const apiKeyProviders = () => catalog.providers.filter((p) => p.kind === 'apikey').map((p) => p.id);

export async function testProvider(provider, key, fetchImpl = fetch) {
  const test = TESTS[provider];
  if (!test) return { ok: false, error: 'Proveedor no soportado.' };
  try {
    return await test(key, fetchImpl);
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, error: timeout ? 'El proveedor no respondió a tiempo. Inténtalo de nuevo.' : 'No se pudo contactar al proveedor desde el servidor.' };
  }
}
