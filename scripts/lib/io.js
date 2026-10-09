import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path}: ${err.message}`);
  }
}

// Writes atomically so a crash never leaves a half-written data file.
export async function writeJson(path, data, { pretty = true } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, pretty ? 1 : 0) + '\n');
  await rename(tmp, path);
}
