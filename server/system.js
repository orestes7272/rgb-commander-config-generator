// Directory setup and privilege dropping.
//
// Unraid containers conventionally start as root and switch to PUID/PGID
// (99:100, nobody:users), so files land on the share with the ownership the
// rest of the array expects. Docker creates missing bind-mount folders as
// root, so those get handed over before switching users.

import fs from 'node:fs/promises';
import path from 'node:path';

const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;

async function chownTree(dir, uid, gid) {
  const stat = await fs.lstat(dir);
  if (stat.uid === 0) await fs.lchown(dir, uid, gid);
  if (!stat.isDirectory()) return;
  for (const entry of await fs.readdir(dir)) await chownTree(path.join(dir, entry), uid, gid);
}

export async function prepareDirs(config, log) {
  // A fixed output folder (the Docker volume) is set up front; one chosen in
  // Settings is created when something is first published to it.
  const fixedOutput = !config.outputDirEditable;
  if (fixedOutput) await fs.mkdir(config.outputDir, { recursive: true });
  for (const sub of ['projects', 'backups']) await fs.mkdir(path.join(config.dataDir, sub), { recursive: true });

  if (!isRoot() || config.puid === null) return;
  const gid = config.pgid ?? config.puid;
  // The app's own data folder is fully ours; take over anything root left behind.
  await chownTree(config.dataDir, config.puid, gid);
  if (!fixedOutput) return;
  // The output folder is a user share: only claim it if Docker just created it.
  const out = await fs.stat(config.outputDir);
  if (out.uid === 0) {
    await fs.chown(config.outputDir, config.puid, gid);
    log?.(`Handed ${config.outputDir} to ${config.puid}:${gid}`);
  }
}

export function dropPrivileges(config, log) {
  if (!isRoot() || config.puid === null) return;
  const gid = config.pgid ?? config.puid;
  process.setgroups([gid]);
  process.setgid(gid);
  process.setuid(config.puid);
  log?.(`Running as ${config.puid}:${gid}`);
}

export async function isWritable(dir) {
  try {
    await fs.access(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Writable, or missing but creatable because its nearest existing parent is writable. */
export async function canWrite(dir) {
  for (let current = dir; ; ) {
    try {
      await fs.access(current, fs.constants.W_OK);
      return true;
    } catch (err) {
      const parent = path.dirname(current);
      if (err.code !== 'ENOENT' || parent === current) return false;
      current = parent;
    }
  }
}

/** "uid:gid" of the running process, or null off POSIX. */
export function currentUser() {
  return typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : null;
}

/** Owner and mode of a folder, e.g. { owner: '1000:1000', mode: '755' }. */
export async function ownerOf(dir) {
  try {
    const st = await fs.stat(dir);
    return { owner: `${st.uid}:${st.gid}`, mode: (st.mode & 0o777).toString(8) };
  } catch {
    return null;
  }
}

/** Turn EACCES & co. into advice a person can act on. */
export async function permissionAdvice(err) {
  if (!['EACCES', 'EPERM', 'EROFS'].includes(err?.code)) return null;
  const dir = err.path ? path.dirname(err.path) : 'a folder';
  if (err.code === 'EROFS') return `${dir} is mounted read-only. Map it read/write in the container settings.`;
  const info = err.path ? await ownerOf(dir) : null;
  const who = currentUser() || 'the app';
  const owned = info ? ` It belongs to ${info.owner} with mode ${info.mode}.` : '';
  return `Can't write to ${dir}: the app runs as ${who}.${owned} Give that user write access (on Unraid, Tools → Docker Safe New Perms, or chmod the folder), or set PUID/PGID to the folder's owner.`;
}

