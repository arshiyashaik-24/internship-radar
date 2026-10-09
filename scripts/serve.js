#!/usr/bin/env node
// Local preview: serves the dashboard with the repository's data and config.
//   npm run serve            → http://localhost:8080
//   node scripts/serve.js --data=some/other/data/folder
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, normalize, extname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const dataDir = args.data ? resolve(args.data) : join(root, 'data');
const port = Number(args.port ?? process.env.PORT ?? 8080);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function resolvePath(urlPath) {
  const p = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p.startsWith('/data/')) return join(dataDir, p.slice(6));
  if (p.startsWith('/config/')) return join(root, 'config', p.slice(8));
  return join(root, 'site', p === '/' ? 'index.html' : p);
}

createServer(async (req, res) => {
  const file = resolvePath(req.url);
  if (!file.startsWith(root) && !file.startsWith(dataDir)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => console.log(`Internship Radar preview on http://localhost:${port}  (data: ${dataDir})`));
