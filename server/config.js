import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid number "${value}"`);
  return n;
}

export function loadConfig(env = process.env) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const umask = env.UMASK ? parseInt(env.UMASK, 8) : 0o002;
  if (!Number.isInteger(umask) || umask < 0 || umask > 0o777) throw new Error(`Invalid UMASK "${env.UMASK}"`);
  return {
    version: pkg.version,
    port: int(env.PORT, 8080, { min: 0, max: 65535 }),
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || path.join(root, '.dev/config')),
    outputDir: path.resolve(env.OUTPUT_DIR || path.join(root, '.dev/output')),
    publicDir: path.join(root, 'public'),
    puid: env.PUID === undefined || env.PUID === '' ? null : int(env.PUID, null, { min: 0 }),
    pgid: env.PGID === undefined || env.PGID === '' ? null : int(env.PGID, null, { min: 0 }),
    umask,
    authUser: env.AUTH_USER || 'admin',
    authPassword: env.AUTH_PASSWORD || '',
    backupsPerFile: int(env.BACKUPS_PER_FILE, 10, { min: 0, max: 1000 }),
  };
}
