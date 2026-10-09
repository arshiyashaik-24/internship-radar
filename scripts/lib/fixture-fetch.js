// A fake fetch for tests and offline demos: serves recorded API responses from
// tests/fixtures according to tests/fixtures/routes.json. Nothing here is used by
// the scheduled run, which always talks to the real sources.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function createFixtureFetch(dir, { overrides = {} } = {}) {
  const routes = JSON.parse(await readFile(join(dir, 'routes.json'), 'utf8'));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const override = Object.entries(overrides).find(([pattern]) => new RegExp(pattern).test(url));
    const route = override ? { ...override[1] } : routes.find((r) => new RegExp(r.pattern).test(url));
    if (!route) return new Response('Not found', { status: 404 });
    if (route.status && route.status >= 400) return new Response(route.body ?? 'error', { status: route.status });
    const body = route.file ? await readFile(join(dir, route.file), 'utf8') : route.body ?? '';
    return new Response(body, { status: 200, headers: { 'content-type': route.file?.endsWith('.json') ? 'application/json' : 'text/html' } });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
