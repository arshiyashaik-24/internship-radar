// Polite HTTP client: identifies itself, checks robots.txt, spaces out requests per
// host, retries transient failures with exponential backoff, and honours Retry-After.

import { parseRobots, isAllowed } from './robots.js';

const UA_TOKEN = 'InternshipRadar';

export class HttpError extends Error {
  constructor(message, { status = null, url = null, transient = false, code = 'http_error' } = {}) {
    super(message);
    this.status = status;
    this.url = url;
    this.transient = transient;
    this.code = code;
  }
}

export function createClient({
  fetchImpl = globalThis.fetch,
  minIntervalMs = 1100,
  retries = 3,
  baseDelayMs = 1500,
  timeoutMs = 30000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  contact = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : 'personal use',
  respectRobots = true,
} = {}) {
  const userAgent = `${UA_TOKEN}/1.0 (personal internship monitor; ${contact})`;
  const lastHit = new Map();
  const robotsCache = new Map();
  let requestCount = 0;

  async function throttle(host) {
    const last = lastHit.get(host) ?? 0;
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
  }

  async function rawFetch(url, init = {}) {
    const u = new URL(url);
    await throttle(u.host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    requestCount++;
    try {
      return await fetchImpl(url, {
        ...init,
        headers: { 'User-Agent': userAgent, Accept: 'application/json, text/html;q=0.9, */*;q=0.5', ...(init.headers ?? {}) },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function robotsAllows(url) {
    if (!respectRobots) return true;
    const u = new URL(url);
    if (!robotsCache.has(u.origin)) {
      let groups = [];
      try {
        let res;
        for (let attempt = 0; ; attempt++) {
          try {
            res = await rawFetch(`${u.origin}/robots.txt`, { headers: { Accept: 'text/plain' } });
            if (res.status >= 500 && attempt < 1) { await sleep(baseDelayMs); continue; }
            break;
          } catch (e) {
            if (attempt >= 1) throw e;
            await sleep(baseDelayMs);
          }
        }
        if (res.ok) groups = parseRobots(await res.text());
        else if (res.status >= 500) throw new HttpError(`robots.txt returned ${res.status}`, { status: res.status, url, transient: true, code: 'robots_unavailable' });
        // 4xx: no robots.txt, everything allowed.
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(`Could not read robots.txt: ${err.message}`, { url, transient: true, code: 'robots_unavailable' });
      }
      robotsCache.set(u.origin, groups);
    }
    return isAllowed(robotsCache.get(u.origin), UA_TOKEN, u.pathname + u.search);
  }

  async function request(url, init = {}, { expect = 'json' } = {}) {
    if (!(await robotsAllows(url))) {
      throw new HttpError(`robots.txt does not allow automated access to ${new URL(url).pathname}`, { url, code: 'robots_disallowed' });
    }
    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await rawFetch(url, init);
      } catch (err) {
        if (attempt >= retries) throw new HttpError(`Network error: ${err.name === 'AbortError' ? 'timed out' : err.message}`, { url, transient: true, code: 'network' });
        await sleep(baseDelayMs * 2 ** attempt + Math.random() * 400);
        attempt++;
        continue;
      }
      if (res.ok) {
        if (expect === 'json') {
          const body = await res.text();
          try {
            return JSON.parse(body);
          } catch {
            throw new HttpError('Response was not valid JSON (the endpoint may have changed or returned a block page)', { url, status: res.status, code: 'bad_json' });
          }
        }
        return res.text();
      }
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : baseDelayMs * 2 ** attempt + Math.random() * 400;
        await sleep(delay);
        attempt++;
        continue;
      }
      throw new HttpError(`HTTP ${res.status} ${res.statusText || ''}`.trim(), { url, status: res.status, transient, code: res.status === 404 ? 'not_found' : res.status === 403 ? 'forbidden' : 'http_error' });
    }
  }

  return {
    getJson: (url, init) => request(url, { ...init, method: 'GET' }, { expect: 'json' }),
    postJson: (url, body, init = {}) => request(url, { ...init, method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } }, { expect: 'json' }),
    getText: (url, init) => request(url, { ...init, method: 'GET' }, { expect: 'text' }),
    robotsAllows,
    get requestCount() { return requestCount; },
    userAgent,
  };
}
