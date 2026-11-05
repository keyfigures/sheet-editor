#!/usr/bin/env node
// The local stand-in for the hosted editor: the root of its own origin, with the same headers.
//   node serve.mjs [root=dist] [port=4178]
//
// No cache of any kind: each request reads the file, so a rebuilt file is served at once.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(process.argv[2] ?? join(HERE, 'dist'));
const PORT = Number(process.argv[3] ?? 4178);

// frame-ancestors checks every ancestor, and the SDK frame's parent is the editor page: 'self' is required.
// SHEET_EDITOR_EXTRA_ANCESTORS: an app on another local port, for a test beside a running `npm run launch`.
const POLICY =
  `frame-ancestors 'self' http://localhost:3001 http://127.0.0.1:3001 http://127.0.0.1:4179 ${process.env.SHEET_EDITOR_EXTRA_ANCESTORS ?? ''}; ` +
  "connect-src 'self' blob: data:; img-src 'self' data: blob:";
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm']);
const isFont = (file) => new RegExp(`\\${sep}fonts\\${sep}\\d+$`).test(file);

function resolvePath(pathname) {
  if (pathname === '/editor') return join(ROOT, 'editor.html');
  const file = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) return join(file, 'index.html');
  return file;
}

function headersFor(file, url) {
  const ext = extname(file);
  const headers = { 'Content-Security-Policy': POLICY };
  headers['Cache-Control'] = url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  if (file.endsWith('.wasm.br')) {
    // The browser decodes it; the wasm type is what streaming instantiation asks for.
    headers['Content-Encoding'] = 'br';
    headers['Content-Type'] = 'application/wasm';
  } else if (isFont(file)) {
    headers['Content-Type'] = 'font/ttf';
  } else {
    headers['Content-Type'] = TYPES[ext] ?? 'application/octet-stream';
  }
  return headers;
}

// What the checks read to know the bytes a reader downloads. Local only: the hosted editor has no server.
let sent = 0;

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://local');
    if (pathname === '/__bytes' || pathname === '/__reset') {
      if (pathname === '/__reset') sent = 0;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ sent }));
      return;
    }
    const file = resolvePath(pathname);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Security-Policy': POLICY });
      res.end();
      return;
    }
    const { size, mtimeMs } = statSync(file);
    const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
    const headers = { ...headersFor(file, pathname), ETag: etag, Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const gzip =
      /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && (COMPRESS.has(extname(file)) || isFont(file));
    if (gzip) {
      const body = zlib.gzipSync(readFileSync(file), { level: 6 });
      sent += body.length;
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': body.length });
      res.end(body);
      return;
    }
    sent += size;
    res.writeHead(200, { ...headers, 'Content-Length': size });
    createReadStream(file).pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => console.log(`[sheet-editor] serving ${ROOT} on http://127.0.0.1:${PORT}`));
