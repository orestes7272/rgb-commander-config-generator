import fs from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method, re, keys, handler });
  }

  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      try {
        r.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1]);
        });
      } catch {
        throw new HttpError(400, 'Malformed URL');
      }
      return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'",
};

export function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body) || typeof body === 'string';
  const payload = isBuffer ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isBuffer ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export async function readJsonBody(req, limit = 8 * 1024 * 1024) {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('application/json')) throw new HttpError(415, 'Send JSON (Content-Type: application/json)');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

/** Reject state-changing requests sent from other sites (CSRF on a LAN app). */
export function checkSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site requests are not allowed');
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Bad Origin header');
    }
    if (host !== req.headers.host) throw new HttpError(403, 'Cross-site requests are not allowed');
  }
}

export function checkAuth(req, res, config) {
  if (!config.authPassword) return true;
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    const digest = (s) => createHash('sha256').update(s).digest();
    const ok =
      timingSafeEqual(digest(user), digest(config.authUser)) & timingSafeEqual(digest(rest.join(':')), digest(config.authPassword));
    if (ok) return true;
  }
  res.writeHead(401, { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Basic realm="RGB Commander Studio", charset="UTF-8"' });
  res.end('Authentication required');
  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

export async function serveStatic(req, res, publicDir, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(publicDir, '.' + path.posix.normalize(rel));
  if (!file.startsWith(publicDir + path.sep)) return false;
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const body = await fs.readFile(file);
  res.writeHead(200, { ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
