/**
 * Google OAuth 2.0 y YouTube Data API v3. Sin dependencias: llamadas HTTP directas.
 * `f` es fetch (se inyecta en pruebas).
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',        // subir videos y miniaturas
  'https://www.googleapis.com/auth/youtube.readonly',      // datos del canal y sus videos
  'https://www.googleapis.com/auth/youtube.force-ssl',     // metadatos, listas y subtítulos
  'https://www.googleapis.com/auth/yt-analytics.readonly'  // métricas de rendimiento
];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT = 15000;

export class GoogleError extends Error {
  constructor(message, { code, status } = {}) { super(message); this.code = code; this.httpStatus = status; }
}

export function authUrl({ clientId, redirectUri, state }) {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(f, params) {
  const res = await f(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(TIMEOUT)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(body.error_description || body.error || `Error ${res.status}`, { code: body.error, status: res.status });
  return body;
}

/**
 * Comprueba un cliente OAuth sin pedir autorización: se canjea un código inválido.
 * Google responde invalid_grant si el cliente es válido e invalid_client si el ID o el secreto no lo son.
 */
export async function checkClient(f, { clientId, clientSecret, redirectUri }) {
  try {
    await tokenRequest(f, { code: 'golddigger-prueba', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    return { ok: true };
  } catch (err) {
    if (err.code === 'invalid_grant') return { ok: true };
    if (err.code === 'invalid_client' || err.code === 'unauthorized_client') return { ok: false, error: 'Google no reconoce el ID de cliente o el secreto. Cópialos de nuevo desde Google Cloud.' };
    if (err.code === 'redirect_uri_mismatch') return { ok: false, error: 'El URI de redireccionamiento no está autorizado en el cliente de Google Cloud.' };
    return { ok: false, error: 'No se pudo validar con Google: ' + err.message };
  }
}

export async function exchangeCode(f, { clientId, clientSecret, redirectUri, code }) {
  const t = await tokenRequest(f, { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new GoogleError('Google no entregó un permiso permanente. Quita el acceso de Golddigger en tu cuenta de Google y conecta de nuevo.');
  return { refreshToken: t.refresh_token, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope };
}

export async function refreshAccess(f, { clientId, clientSecret, refreshToken }) {
  const t = await tokenRequest(f, { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });
  return { accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
}

/** Canal de YouTube de la cuenta autorizada (con cuentas de marca, Google pide elegir el canal al autorizar). */
export async function myChannel(f, accessToken) {
  const res = await f('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') throw new GoogleError('La YouTube Data API v3 no está habilitada en tu proyecto de Google Cloud.', { code: reason });
    if (reason === 'quotaExceeded') throw new GoogleError('Se agotó la cuota diaria de la YouTube Data API. Intenta mañana.', { code: reason });
    throw new GoogleError(body.error?.message || `YouTube respondió ${res.status}`, { code: reason, status: res.status });
  }
  const ch = body.items?.[0];
  if (!ch) throw new GoogleError('Esta cuenta de Google no tiene un canal de YouTube. Crea el canal o elige otra cuenta.', { code: 'no_channel' });
  const st = ch.statistics || {};
  return {
    externalId: ch.id,
    name: ch.snippet?.title || 'Canal de YouTube',
    handle: ch.snippet?.customUrl || null,
    thumbnailUrl: ch.snippet?.thumbnails?.default?.url || null,
    metrics: {
      subscribers: st.hiddenSubscriberCount ? null : Number(st.subscriberCount || 0),
      views: Number(st.viewCount || 0),
      videos: Number(st.videoCount || 0)
    }
  };
}

export async function revoke(f, token) {
  try {
    await f('https://oauth2.googleapis.com/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }), signal: AbortSignal.timeout(TIMEOUT)
    });
  } catch { /* si falla, igual se borra el token local */ }
}
