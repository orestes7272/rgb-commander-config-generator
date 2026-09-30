import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { prepareDirs, dropPrivileges, isWritable, ownerOf, currentUser, permissionAdvice } from './system.js';
import { createApi } from './api.js';
import { HttpError, send, serveStatic, checkAuth, checkSameOrigin } from './http.js';

const log = (...args) => console.log(new Date().toISOString(), ...args);

export async function createHandler(config) {
  const api = createApi(config);
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
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

export async function start(env = process.env) {
  const config = loadConfig(env);
  process.umask(config.umask);
  await prepareDirs(config, log);
  dropPrivileges(config, log);
  const server = http.createServer(await createHandler(config));
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  log(`RGB Commander Studio ${config.version} on http://${config.host}:${server.address().port}`);
  log(`Schemes in ${config.dataDir}, .rgba files published to ${config.outputDir}`);
  for (const dir of [config.dataDir, config.outputDir]) {
    if (await isWritable(dir)) continue;
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
