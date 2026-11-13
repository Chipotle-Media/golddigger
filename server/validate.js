import { catalog } from './catalog.js';

export class ValidationError extends Error {
  constructor(message, field) { super(message); this.field = field; this.status = 400; }
}

const fail = (message, field) => { throw new ValidationError(message, field); };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function text(v, field, { min = 0, max, label }) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') fail(`${label}: valor inválido.`, field);
  const s = v.trim();
  if (s.length < min) fail(min === 1 ? `${label} es obligatorio.` : `${label}: mínimo ${min} caracteres.`, field);
  if (s.length > max) fail(`${label}: máximo ${max} caracteres.`, field);
  return s;
}
function num(v, field, { min, max, label, integer = false }) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${label} debe ser un número.`, field);
  if (integer && !Number.isInteger(n)) fail(`${label} debe ser un número entero.`, field);
  if (n < min || n > max) fail(`${label} debe estar entre ${min} y ${max}.`, field);
  return integer ? n : Math.round(n * 100) / 100;
}
function oneOf(v, list, field, label) {
  if (!list.includes(v)) fail(`${label}: opción no válida.`, field);
  return v;
}

const CAMPAIGN_FIELDS = {
  name: (v) => text(v, 'name', { min: 1, max: 80, label: 'El nombre' }),
  channelId: (v) => num(v, 'channelId', { min: 1, max: Number.MAX_SAFE_INTEGER, label: 'El canal', integer: true }),
  niche: (v) => text(v, 'niche', { max: 120, label: 'El nicho' }),
  references: (v) => text(v, 'references', { max: 2000, label: 'Las referencias' }),
  format: (v) => oneOf(v, catalog.campaign.formats, 'format', 'Formato'),
  days: (v) => oneOf(v, catalog.campaign.days, 'days', 'Días'),
  time: (v) => { if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail('Hora inválida (usa HH:MM).', 'time'); return v; },
  budgetMonthly: (v) => num(v, 'budgetMonthly', { min: 0, max: 100000, label: 'El presupuesto mensual' }),
  maxPerPiece: (v) => num(v, 'maxPerPiece', { min: 0, max: 10000, label: 'El máximo por pieza' }),
  scriptTool: (v) => oneOf(v, catalog.campaign.scriptTools, 'scriptTool', 'Guion'),
  clipsTool: (v) => oneOf(v, catalog.campaign.clipsTools, 'clipsTool', 'Clips'),
  instructions: (v) => text(v, 'instructions', { max: 2000, label: 'Las instrucciones' }),
  autoPublish: (v) => { if (typeof v !== 'boolean') fail('Publicación automática: valor inválido.', 'autoPublish'); return v; },
  status: (v) => oneOf(v, catalog.campaign.statuses, 'status', 'Estado')
};

export const CAMPAIGN_DEFAULTS = {
  niche: '', references: '', format: catalog.campaign.formats[0], days: catalog.campaign.days[0], time: '18:00',
  budgetMonthly: 100, maxPerPiece: 12, scriptTool: catalog.campaign.scriptTools[0], clipsTool: catalog.campaign.clipsTools[0],
  instructions: '', autoPublish: false, status: 'active'
};

/** Valida una campaña nueva (partial=false) o un cambio parcial (partial=true). Ignora campos desconocidos. */
export function validateCampaign(body, { partial = false } = {}) {
  if (!isObj(body)) fail('Datos de campaña inválidos.');
  const out = {};
  for (const [key, check] of Object.entries(CAMPAIGN_FIELDS)) {
    if (body[key] !== undefined) out[key] = check(body[key]);
  }
  if (!partial) {
    if (out.name === undefined) fail('El nombre es obligatorio.', 'name');
    if (out.channelId === undefined) fail('Elige un canal.', 'channelId');
    return { ...CAMPAIGN_DEFAULTS, ...out };
  }
  if (!Object.keys(out).length) fail('No hay cambios que guardar.');
  return out;
}

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Revalida en el servidor el flujo que arma el editor: nunca se confía en la validación del navegador. */
export function validateWorkflow(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) fail('El flujo debe tener al menos un proceso.');
  if (nodes.length > catalog.limits.maxNodes) fail(`Máximo ${catalog.limits.maxNodes} procesos por flujo.`);
  const ids = new Set();
  const clean = nodes.map((n, i) => {
    const where = `Proceso ${i + 1}`;
    if (!isObj(n)) fail(`${where}: datos inválidos.`);
    if (typeof n.id !== 'string' || !ID.test(n.id)) fail(`${where}: identificador inválido.`);
    if (ids.has(n.id)) fail('Hay identificadores repetidos.');
    ids.add(n.id);
    const type = oneOf(n.type, Object.keys(catalog.processes), 'type', `${where} · función`);
    const tool = oneOf(n.tool, catalog.processes[type].tools, 'tool', `${where} · herramienta`);
    const extras = n.extras === undefined ? [] : n.extras;
    if (!Array.isArray(extras) || extras.length > catalog.limits.maxExtras) fail(`${where}: máximo ${catalog.limits.maxExtras} especificaciones extra.`);
    return {
      id: n.id, type, tool,
      name: text(n.name, 'name', { min: 1, max: 65, label: `${where} · nombre` }),
      output: text(n.output, 'output', { min: 1, max: 150, label: `${where} · resultado esperado` }),
      prompt: text(n.prompt, 'prompt', { max: 1800, label: `${where} · instrucciones` }),
      model: text(n.model, 'model', { max: 80, label: `${where} · modelo` }),
      deps: Array.isArray(n.deps) ? [...new Set(n.deps)] : fail(`${where}: conexiones inválidas.`),
      limit: num(n.limit, 'limit', { min: 0, max: 1000, label: `${where} · límite de costo` }),
      retries: num(n.retries, 'retries', { min: 0, max: 5, label: `${where} · reintentos`, integer: true }),
      onfail: oneOf(n.onfail, catalog.onFail, 'onfail', `${where} · política de fallo`),
      approval: typeof n.approval === 'boolean' ? n.approval : fail(`${where}: aprobación inválida.`),
      extras: extras.map((x) => {
        if (!isObj(x)) fail(`${where}: especificación inválida.`);
        return { key: text(x.key, 'extras', { max: 60, label: 'Especificación' }), value: text(x.value, 'extras', { max: 180, label: 'Valor' }) };
      })
    };
  });
  const byId = new Map(clean.map((n) => [n.id, n]));
  for (const n of clean) {
    if (n.deps.some((d) => typeof d !== 'string' || d === n.id || !byId.has(d))) fail(`«${n.name}» tiene una conexión inválida.`);
  }
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return false;
    if (state.get(id) === 2) return true;
    state.set(id, 1);
    for (const d of byId.get(id).deps) if (!visit(d)) return false;
    state.set(id, 2);
    return true;
  };
  if (!clean.every((n) => visit(n.id))) fail('Hay un ciclo: un proceso no puede depender de sí mismo a través de otros.');
  return clean;
}

export function validateCredentials(body) {
  if (!isObj(body)) fail('Datos inválidos.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password || email.length > 254 || password.length > 200) fail('Escribe tu correo y contraseña.');
  return { email, password };
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || password.length < 10) fail('La contraseña debe tener al menos 10 caracteres.', 'password');
  if (password.length > 200) fail('La contraseña es demasiado larga.', 'password');
  return password;
}

export function validateEmail(email) {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) fail('Correo inválido.', 'email');
  return e;
}
