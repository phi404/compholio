import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const contentSecurityPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' blob: data:; worker-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'";
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.otf': 'font/otf', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.map': 'application/json' };

export function normalizeBasePath(value = '/') {
  if (!/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]*$/u.test(value) || value.split('/').some(part => ['.', '..'].includes(part))) throw new Error('Invalid site base path');
  return value.endsWith('/') ? value : `${value}/`;
}

/** Serve only the build directory, with the same behavior at / and a project prefix. */
export async function createStaticServer(directory, { basePath = '/' } = {}) {
  const root = await realpath(directory), prefix = normalizeBasePath(basePath);
  return http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (prefix !== '/' && pathname === prefix.slice(0, -1)) { response.writeHead(301, { Location: prefix }); response.end(); return; }
      if (!pathname.startsWith(prefix) || pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
      const relative = pathname.slice(prefix.length) || 'index.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      const resolved = await realpath(file);
      if (!resolved.startsWith(root + path.sep)) throw new Error('Invalid path');
      const content = await readFile(resolved);
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': content.length,
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `${contentSecurityPolicy}; frame-ancestors 'none'`,
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
