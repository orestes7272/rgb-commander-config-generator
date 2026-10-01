import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { prepareDirs, dropPrivileges, canWrite, ownerOf, currentUser, permissionAdvice } from './system.js';
import { createApi } from './api.js';
import { HttpError, send, serveStatic, checkAuth, checkSameOrigin } from './http.js';

const log = (...args) => console.log(new Date().toISOString(), ...args);

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

export async function createHandler(config, hooks) {
  const api = createApi(config, hooks);
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (config.loopbackOnly && !LOOPBACK_NAMES.has(String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase())) {
        throw new HttpError(403, 'This app only answers to localhost');
      }
      if (pathname !== '/api/health' && !checkAuth(req, res, config)) return;
      if (pathname.startsWith('/api/')) {
        checkSameOrigin(req);
        const match = api.match(req.method, pathname);
        if (!match) throw new HttpError(404, 'Not found');
        if (match.methodNotAllowed) throw new HttpError(405, 'Method not allowed');
        const result = await match.handler({ req, res, params: match.params, query: url.searchParams });
        if (!res.headersSent) send(res, 200, result ?? { ok: true });
        return;
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, config.publicDir, pathname))) return;
      throw new HttpError(404, 'Not found');
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const advice = status === 500 ? await permissionAdvice(err) : null;
      if (status === 500) log('Error', req.method, pathname, advice || err);
      const message = advice || (status === 500 ? 'Internal error: ' + err.message : err.message);
      if (!res.headersSent) send(res, status, { error: message, ...(advice ? { code: 'not-writable' } : {}), ...(err.extra || {}) });
      else res.end();
    }
  };
}

export async function start(env = process.env, hooks = {}) {
  const config = loadConfig(env);
  process.umask(config.umask);
  await prepareDirs(config, log);
  dropPrivileges(config, log);
  const server = http.createServer(await createHandler(config, hooks));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  log(`RGB Commander Studio ${config.version} on http://${config.host}:${server.address().port}`);
  log(`Schemes in ${config.dataDir}, .rgba files published to ${config.outputDir}`);
  for (const dir of [config.dataDir, config.outputDir]) {
    if (await canWrite(dir)) continue;
    const info = await ownerOf(dir);
    log(`WARNING: ${dir} is not writable by ${currentUser()}${info ? ` (it belongs to ${info.owner}, mode ${info.mode})` : ''}. Fix the folder's permissions or set PUID/PGID to its owner.`);
  }
  return { server, config };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = await start();
  const stop = (signal) => {
    log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
