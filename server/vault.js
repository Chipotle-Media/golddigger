import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Cifrado de credenciales (llaves de API y tokens OAuth) con AES-256-GCM.
 * La llave maestra viene de GD_SECRET_KEY (base64, 32 bytes) o se crea una sola vez en
 * <GD_DATA_DIR>/secret.key con permisos 600. Nunca se guarda en la base ni en el repositorio:
 * una copia de la base sin esta llave no permite leer las credenciales.
 */
export function createVault({ key } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('La llave maestra debe tener 32 bytes.');
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
    },
    decrypt(token) {
      const [v, iv, tag, data] = String(token || '').split('.');
      if (v !== 'v1') throw new Error('Formato de credencial desconocido.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    }
  };
}

export function vaultFromEnv(env = process.env) {
  if (env.GD_SECRET_KEY) {
    const key = Buffer.from(env.GD_SECRET_KEY, 'base64');
    if (key.length !== 32) throw new Error('GD_SECRET_KEY debe ser base64 de 32 bytes.');
    return createVault({ key });
  }
  const dir = env.GD_DATA_DIR || (env.NODE_ENV === 'production' ? '/opt/golddigger/data' : path.resolve('.data'));
  const file = path.join(dir, 'secret.key');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, randomBytes(32).toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`Llave maestra de credenciales creada en ${file}. Respáldala junto con la base de datos.`);
  }
  const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error(`La llave en ${file} no es válida.`);
  return createVault({ key });
}

/** Últimos caracteres visibles de una llave, para reconocerla sin mostrarla. */
export const hint = (secret) => {
  const s = String(secret || '');
  return s.length <= 8 ? '••••' : '••••' + s.slice(-4);
};
