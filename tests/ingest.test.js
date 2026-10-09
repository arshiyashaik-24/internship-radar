import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngest } from '../scripts/ingest.js';
import { createFixtureFetch } from '../scripts/lib/fixture-fetch.js';
import { createClient } from '../scripts/lib/http.js';
import { parseRobots, isAllowed } from '../scripts/lib/robots.js';
import { mergeSourceResults } from '../scripts/lib/store.js';
import { predictOpening } from '../scripts/lib/programmes.js';
import { extractLinks } from '../scripts/lib/adapters/page.js';

const FIX = new URL('./fixtures/', import.meta.url).pathname;
const configDir = join(FIX, 'config');
const fast = { minIntervalMs: 0, baseDelayMs: 1 };
const quiet = () => {};
const readData = async (dir, f) => JSON.parse(await readFile(join(dir, f), 'utf8'));

async function run(dataDir, { overrides, now = new Date('2026-10-09T05:00:00Z'), only } = {}) {
  const fetchImpl = await createFixtureFetch(FIX, { overrides });
  const out = await runIngest({ dataDir, configDir, fetchImpl, now, clientOptions: fast, log: quiet, only, trigger: 'test' });
  return { ...out, fetchImpl };
}

test('first run ingests only student roles from every adapter, with sources and timestamps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const { run: r, items } = await run(dir);
  assert.equal(r.status, 'success');
  const titles = items.map((o) => o.title).sort();
  assert.ok(titles.includes('Hardware Engineer Intern'));
  assert.ok(titles.includes('Quantum Software Intern (part-time)'));
  assert.ok(titles.includes('Internship Image Processing for Wafer Inspection'));
  assert.ok(titles.includes('Internship | Photonics modelling'));
  assert.ok(!titles.includes('Software Engineer'), 'non-student roles are skipped');
  assert.ok(!titles.includes('Internal Audit Specialist'));
  assert.ok(!titles.includes('Advanced Physicist'));
  assert.ok(!titles.includes('Intern Marketing'), 'Workday location filter drops Austin');
  for (const o of items) {
    assert.ok(o.url && o.firstSeenAt && o.lastVerifiedAt, `${o.title} has url + timestamps`);
    assert.ok(o.evidenceUrls.length >= 1);
  }
  const meta = await readData(dir, 'meta.json');
  assert.equal(meta.lastRunStatus, 'success');
  assert.equal(meta.lastSuccessfulRunAt, '2026-10-09T05:00:00.000Z');
});

test('normalised record carries extracted facts and eligibility', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const { items } = await run(dir);
  const hw = items.find((o) => o.title === 'Hardware Engineer Intern');
  assert.equal(hw.deadline.date, '2026-11-30');
  assert.equal(hw.startDate.precision, 'season');
  assert.equal(hw.location.isNetherlands, true);
  assert.equal(hw.eligibility.label, 'eligible');
  assert.ok(hw.restrictions.some((s) => /visa sponsorship|eligible to work/.test(s)));
  assert.equal(hw.compensation.status, 'paid');
  assert.equal(hw.postedAt, '2026-09-20');

  const phd = items.find((o) => /Deep Learning Research Intern/.test(o.title));
  assert.equal(phd.eligibility.label, 'ineligible');
  assert.equal(phd.location.region, 'outside_europe');

  const nxp = items.find((o) => /Wafer Inspection/.test(o.title));
  assert.equal(nxp.compensation.amount, 600);
  assert.equal(nxp.duration.minMonths, 5);
  assert.equal(nxp.location.isBrainport, true);
  assert.ok(nxp.fields.includes('ai_ml_cv'));

  const thesis = items.find((o) => /Graduation Internship/.test(o.title));
  assert.equal(thesis.eligibility.label, 'ineligible');

  const q = items.find((o) => /Quantum Software/.test(o.title));
  assert.equal(q.track, 'part_time');
  assert.equal(q.location.remoteRegion, 'EU');
  assert.deepEqual([q.hours.min, q.hours.max], [12, 16]);
  assert.ok(q.match.score > 0 && q.match.breakdown.length === 6);
});

test('repeated ingestion does not create duplicates or spurious history', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const first = await run(dir);
  const second = await run(dir, { now: new Date('2026-10-10T05:00:00Z') });
  assert.equal(second.items.length, first.items.length);
  assert.equal(new Set(second.items.map((o) => o.id)).size, second.items.length);
  assert.equal(second.run.newCount, 0);
  assert.equal(second.run.changedCount, 0);
  const hw = second.items.find((o) => o.title === 'Hardware Engineer Intern');
  assert.equal(hw.firstSeenAt, '2026-10-09T05:00:00.000Z', 'first-seen is preserved');
  assert.equal(hw.lastSeenAt, '2026-10-10T05:00:00.000Z');
});

test('changes are recorded with before/after values; removed postings close after a confirming recheck', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  await run(dir);
  const second = await run(dir, {
    now: new Date('2026-10-10T05:00:00Z'),
    overrides: { 'boards-api\\.greenhouse\\.io/v1/boards/imc/jobs\\?content=true': { file: 'greenhouse-imc-run2.json' } },
  });
  const history = await readData(dir, 'history.json');
  const deadlineChange = history.events.find((e) => e.field === 'deadline' && e.id === 'gh-imc:101');
  assert.equal(deadlineChange.from, '2026-11-30');
  assert.equal(deadlineChange.to, '2026-12-15');
  assert.ok(history.events.some((e) => e.type === 'new' && e.id === 'gh-imc:106'));
  const closed = second.items.find((o) => o.id === 'gh-imc:104');
  assert.equal(closed.status, 'closed', 'recheck returned 404, so the posting is closed');
  assert.ok(history.events.some((e) => e.type === 'closed' && e.id === 'gh-imc:104'));
});

test('a failed source keeps its previous listings and is reported, without touching other sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  await run(dir);
  const second = await run(dir, {
    now: new Date('2026-10-10T05:00:00Z'),
    overrides: { 'api\\.eu\\.lever\\.co': { status: 500 } },
  });
  assert.equal(second.run.status, 'partial');
  const q = second.items.find((o) => /Quantum Software/.test(o.title));
  assert.ok(q, 'listing kept');
  assert.equal(q.lastVerifiedAt, '2026-10-09T05:00:00.000Z', 'not re-verified, so the dashboard can show it as stale');
  assert.equal(q.status, 'open');
  const st = await readData(dir, 'sources-status.json');
  assert.equal(st['lever-quantinuum'].lastStatus, 'failed');
  assert.equal(st['lever-quantinuum'].lastSuccessAt, '2026-10-09T05:00:00.000Z');
  assert.match(st['lever-quantinuum'].lastError, /500/);
  assert.equal(st['gh-imc'].lastStatus, 'ok');
  const meta = await readData(dir, 'meta.json');
  assert.equal(meta.lastRunStatus, 'partial');
  assert.equal(meta.lastSuccessfulRunAt, '2026-10-09T05:00:00.000Z', 'last fully successful run is not overwritten by a partial one');

  const third = await run(dir, { now: new Date('2026-10-11T05:00:00Z') });
  assert.equal(third.run.status, 'success');
  const hist = await readData(dir, 'history.json');
  assert.ok(hist.events.some((e) => e.type === 'source_recovered' && e.sourceId === 'lever-quantinuum'));
});

test('robots.txt disallow blocks a source instead of fetching it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const { run: r, fetchImpl } = await run(dir, {
    overrides: { 'api\\.eu\\.lever\\.co/robots\\.txt': { body: 'User-agent: *\nDisallow: /v0/' } },
  });
  const st = await readData(dir, 'sources-status.json');
  assert.equal(st['lever-quantinuum'].lastStatus, 'blocked');
  assert.equal(st['lever-quantinuum'].health, 'blocked');
  assert.ok(!fetchImpl.calls.some((c) => /lever\.co\/v0\/postings/.test(c.url)), 'the API itself was never requested');
  assert.equal(r.status, 'partial');
});

test('manual sources are listed but never fetched for listings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const { fetchImpl } = await run(dir);
  const st = await readData(dir, 'sources-status.json');
  assert.equal(st['m-asml'].health, 'manual');
  assert.ok(!fetchImpl.calls.some((c) => /asml\.com/.test(c.url)));
});

test('programmes: open now, prediction from evidence, and unknown for manual ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const { programmeState } = await run(dir);
  assert.equal(programmeState['imc-amsterdam'].status, 'OPEN NOW');
  assert.equal(programmeState['imc-eu-campus'].status, 'OPEN NOW');
  assert.equal(programmeState['cern-summer-student'].status, 'STATUS UNKNOWN');
  const demo = programmeState['demo-evidence'];
  assert.equal(demo.status, 'EXPECTED TO OPEN');
  assert.equal(demo.prediction.confidence, 'low');
  assert.equal(demo.prediction.from, '2026-08-27');
  assert.equal(demo.prediction.to, '2026-09-24');
  assert.ok(programmeState['imc-eu-campus'].observedOpenings[2027], 'observed opening recorded for the 2027 cycle');
});

test('prediction needs real evidence', () => {
  assert.equal(predictOpening([], 2027), null);
  const p = predictOpening([{ cycle: 2025, openedOn: '2024-09-01' }, { cycle: 2026, openedOn: '2025-09-15' }], 2027);
  assert.equal(p.confidence, 'medium');
  assert.ok(p.from <= '2026-09-01' && p.to >= '2026-09-15');
});

test('HTTP client retries transient failures and honours Retry-After', async () => {
  let n = 0;
  const sleeps = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    n++;
    if (n === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '2' } });
    if (n === 2) return new Response('oops', { status: 503 });
    return new Response('{"ok":true}', { status: 200 });
  };
  const client = createClient({ fetchImpl, minIntervalMs: 0, baseDelayMs: 10, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(await client.getJson('https://api.example.test/x'), { ok: true });
  assert.equal(n, 3);
  assert.equal(sleeps[0], 2000, 'Retry-After respected');
});

test('HTTP client does not retry a 404 and reports bad JSON clearly', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    n++;
    return url.includes('missing') ? new Response('no', { status: 404 }) : new Response('<html>blocked</html>', { status: 200 });
  };
  const client = createClient({ fetchImpl, minIntervalMs: 0, sleep: async () => {} });
  await assert.rejects(client.getJson('https://x.test/missing'), (e) => e.status === 404 && !e.transient);
  assert.equal(n, 1);
  await assert.rejects(client.getJson('https://x.test/html'), (e) => e.code === 'bad_json');
});

test('robots.txt parsing: longest match wins, wildcards, agent groups', () => {
  const g = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/jobs\nDisallow: /*.pdf$\n\nUser-agent: InternshipRadar\nDisallow: /nope');
  assert.equal(isAllowed(g, 'SomeBot', '/private/x'), false);
  assert.equal(isAllowed(g, 'SomeBot', '/private/jobs/1'), true);
  assert.equal(isAllowed(g, 'SomeBot', '/file.pdf'), false);
  assert.equal(isAllowed(g, 'InternshipRadar', '/private/x'), true, 'specific group replaces *');
  assert.equal(isAllowed(g, 'InternshipRadar', '/nope'), false);
});

test('duplicate fingerprints across sources keep one primary record', () => {
  const mk = (id, sourceId, tier) => ({ id, sourceId, title: 'Intern', url: `https://x/${id}`, fingerprint: 'abc', sourceTier: tier, status: 'open' });
  const { items } = mergeSourceResults({
    previous: [],
    results: [
      { sourceId: 'agg', status: 'ok', complete: true, opportunities: [mk('agg:1', 'agg', 4)] },
      { sourceId: 'off', status: 'ok', complete: true, opportunities: [mk('off:1', 'off', 1)] },
    ],
    now: new Date('2026-10-09T00:00:00Z'),
  });
  const primary = items.find((o) => !o.duplicateOf);
  assert.equal(primary.id, 'off:1', 'official source wins');
  assert.equal(items.find((o) => o.id === 'agg:1').duplicateOf, 'off:1');
  assert.ok(primary.evidenceUrls.includes('https://x/agg:1'));
});

test('page watcher extracts and de-duplicates matching links', () => {
  const links = extractLinks('<a href="/v/2026/09/a/">A</a><a href="/v/2026/09/a/#apply">Apply</a><a href="/other">x</a>', 'https://site.test/careers/', '/v/\\d{4}/');
  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://site.test/v/2026/09/a/');
});

test('deadline passing is detected even without new data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  await run(dir);
  const later = await run(dir, { now: new Date('2026-12-01T05:00:00Z'), overrides: { 'api\\.eu\\.lever\\.co': { status: 500 }, 'boards-api': { status: 500 } } });
  const hw = later.items.find((o) => o.id === 'gh-imc:101');
  assert.equal(hw.status, 'deadline_passed');
  const hist = await readData(dir, 'history.json');
  assert.ok(hist.events.some((e) => e.type === 'deadline_passed' && e.id === 'gh-imc:101'));
});

test('Workday country facet is found in both tenant layouts seen live', async () => {
  const { findCountryFacets } = await import('../scripts/lib/adapters/workday.js');
  const nxp = [{ facetParameter: 'Location_Country', descriptor: 'Country/Territory', values: [{ descriptor: 'Netherlands', id: 'a1' }] }];
  assert.deepEqual(findCountryFacets(nxp, ['Netherlands']), { Location_Country: ['a1'] });
  const philips = [{ facetParameter: 'locationMainGroup', values: [
    { descriptor: 'Country/Region', facetParameter: 'locationHierarchy1', values: [{ descriptor: 'Netherlands', id: 'b2' }] },
    { descriptor: 'City', facetParameter: 'locations', values: [{ descriptor: 'Netherlands - Remote Based', id: 'c3' }] },
  ] }];
  assert.deepEqual(findCountryFacets(philips, ['Netherlands']), { locationHierarchy1: ['b2'] });
  const thermo = [{ facetParameter: 'locationMainGroup', values: [{ descriptor: 'Locations', facetParameter: 'locations', values: [
    { descriptor: 'Eindhoven, Netherlands', id: 'e1' }, { descriptor: 'Remote, Netherlands', id: 'r1' }, { descriptor: 'Aachen, Germany', id: 'g1' }, { descriptor: 'Netherlands Antilles Road, USA', id: 'x1' },
  ] }] }];
  assert.deepEqual(findCountryFacets(thermo, ['Netherlands']), { locations: ['e1', 'r1'] });
  assert.equal(findCountryFacets([{ facetParameter: 'timeType', values: [] }], ['Netherlands']), null);
});
