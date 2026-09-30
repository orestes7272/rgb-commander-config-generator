import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Write a file atomically: temp file in the same folder, then rename.
 *
 * Temp files are named ".syncthing.<name>.<rand>.tmp". Syncthing never syncs
 * files matching .syncthing.*.tmp (its own temp-file pattern), so a half
 * written file can't be sent to the cabinet, and RGBcommander ignores anything
 * that doesn't end in .rgba.
 */
export async function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.syncthing.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJson(file, data) {
  await writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');
}

export async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Copy a file into backups/<name>/<timestamp>.<ext>, keeping the newest `keep`. */
export async function backupFile(backupRoot, file, keep) {
  if (!keep) return null;
  const text = await readText(file);
  if (text === null) return null;
  const base = path.basename(file);
  const dir = path.join(backupRoot, base);
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `${stamp}_${base}`);
  await fs.writeFile(target, text);
  const all = (await fs.readdir(dir)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) await fs.rm(path.join(dir, old), { force: true });
  return target;
}
