#!/usr/bin/env node
// Assembles the static site for GitHub Pages: the dashboard, the data the daily run
// wrote, and the configuration it reads (sources, programmes, default preferences).
import { cp, rm, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'site'), out, { recursive: true });
await cp(join(root, 'data'), join(out, 'data'), { recursive: true });
await cp(join(root, 'config'), join(out, 'config'), { recursive: true });
await writeFile(join(out, '.nojekyll'), '');
console.log('Built site into', out);
