#!/usr/bin/env node
// Administración desde la terminal del servidor.
//   node server/cli.js crear-usuario        → pide correo, nombre y contraseña
//   node server/cli.js cambiar-contrasena   → pide correo y nueva contraseña (cierra sus sesiones)
//   node server/cli.js espacios             → lista los espacios de trabajo
// En el VPS se usa con:  bash /opt/golddigger/app/deploy/admin.sh crear-usuario
import { createInterface } from 'node:readline';
import { hashPassword } from './auth.js';
import { validateEmail, validateNewPassword } from './validate.js';

const envFile = process.env.GD_ENV_FILE;
try { process.loadEnvFile(envFile || undefined); } catch { /* sin .env */ }
if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. En el VPS ejecuta: bash /opt/golddigger/app/deploy/admin.sh <comando>');
  process.exit(1);
}

// Una sola interfaz de lectura para todo el comando. El iterador guarda las líneas en cola,
// así funciona igual escribiendo en la terminal que con respuestas por tubería.
const tty = Boolean(process.stdin.isTTY);
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
const lines = rl[Symbol.asyncIterator]();
let muted = false;
rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); else if (/[\r\n]/.test(s)) rl.output.write('\n'); };
async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  muted = hidden && tty;
  const { value, done } = await lines.next();
  muted = false;
  if (done) throw new Error('Se terminó la entrada antes de completar los datos.');
  if (!tty) process.stdout.write('\n');
  return value.trim();
}

async function askPassword() {
  for (;;) {
    const p1 = await ask('Contraseña (mínimo 10 caracteres): ', { hidden: true });
    try { validateNewPassword(p1); } catch (e) { console.log('  ' + e.message); continue; }
    const p2 = await ask('Repite la contraseña: ', { hidden: true });
    if (p1 === p2) return p1;
    console.log('  Las contraseñas no coinciden.');
  }
}

const { createPostgresStore } = await import('./store/postgres.js');
const store = await createPostgresStore(process.env.DATABASE_URL);
await store.migrate();
const cmd = process.argv[2];

try {
  if (cmd === 'crear-usuario') {
    const email = validateEmail(await ask('Correo: '));
    const name = (await ask('Nombre: ')) || email.split('@')[0];
    const password = await askPassword();
    const spaces = await store.listWorkspaces();
    let joinWorkspaceId;
    if (spaces.length === 1) joinWorkspaceId = spaces[0].id;
    else if (spaces.length > 1) {
      spaces.forEach((w) => console.log(`  ${w.id}) ${w.name} · ${w.members} miembro(s)`));
      const pick = await ask('Número del espacio de trabajo (vacío = uno nuevo): ');
      joinWorkspaceId = pick ? Number(pick) : undefined;
    }
    const workspaceName = joinWorkspaceId ? undefined : (await ask('Nombre del espacio de trabajo [Golddigger]: ')) || 'Golddigger';
    const { user, workspace } = await store.createUser({ email, name, passwordHash: await hashPassword(password), joinWorkspaceId, workspaceName });
    console.log(`✔ Usuario ${user.email} creado en «${workspace.name}» (${workspace.role === 'owner' ? 'propietario' : 'editor'}).`);
  } else if (cmd === 'cambiar-contrasena') {
    const email = validateEmail(await ask('Correo del usuario: '));
    const user = await store.findUserByEmail(email);
    if (!user) throw new Error('No existe un usuario con ese correo.');
    await store.setPassword(user.id, await hashPassword(await askPassword()));
    console.log('✔ Contraseña actualizada. Se cerraron sus sesiones abiertas.');
  } else if (cmd === 'espacios') {
    const spaces = await store.listWorkspaces();
    if (!spaces.length) console.log('Todavía no hay espacios de trabajo. Crea el primer usuario con: crear-usuario');
    spaces.forEach((w) => console.log(`${w.id}) ${w.name} · ${w.members} miembro(s)`));
  } else {
    console.log('Comandos: crear-usuario · cambiar-contrasena · espacios');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('✖ ' + e.message);
  process.exitCode = 1;
} finally {
  rl.close();
  await store.close();
}
