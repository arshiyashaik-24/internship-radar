#!/usr/bin/env node
// Daily ingestion run. Fetches every automated source, normalises student listings,
// merges them into data/, records changes, updates source health and programme
// status, and writes everything the dashboard reads.
//
//   node scripts/ingest.js                 all sources
//   node scripts/ingest.js --only=gh-imc   one source (comma-separate several)
//   node scripts/ingest.js --fixtures=tests/fixtures   offline demo with recorded responses

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readJson, writeJson } from './lib/io.js';
import { createClient } from './lib/http.js';
import { normalise } from '../site/shared/normalise.js';
import { mergeSourceResults, updateSourceStatus } from './lib/store.js';
import { computeProgrammes } from './lib/programmes.js';
import { daysBetween } from '../site/shared/dates.js';
import * as greenhouse from './lib/adapters/greenhouse.js';
import * as lever from './lib/adapters/lever.js';
import * as ashby from './lib/adapters/ashby.js';
import * as workday from './lib/adapters/workday.js';
import * as smartrecruiters from './lib/adapters/smartrecruiters.js';
import * as recruitee from './lib/adapters/recruitee.js';
import * as page from './lib/adapters/page.js';

export const ADAPTERS = { greenhouse, lever, ashby, workday, smartrecruiters, recruitee, page };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function runIngest({
  root = ROOT,
  dataDir = join(root, 'data'),
  configDir = join(root, 'config'),
  fetchImpl,
  now = new Date(),
  only = null,
  trigger = process.env.GITHUB_EVENT_NAME ?? 'local',
  clientOptions = {},
  log = console.log,
} = {}) {
  const prefs = await readJson(join(configDir, 'preferences.json'), {});
  const sourcesCfg = await readJson(join(configDir, 'sources.json'), { sources: [] });
  const programmesCfg = await readJson(join(configDir, 'programmes.json'), { programmes: [] });

  const prevOpps = await readJson(join(dataDir, 'opportunities.json'), { items: [] });
  const prevDetails = await readJson(join(dataDir, 'details.json'), {});
  const prevSources = await readJson(join(dataDir, 'sources-status.json'), {});
  const prevProgrammes = await readJson(join(dataDir, 'programmes-status.json'), {});
  const history = await readJson(join(dataDir, 'history.json'), { events: [] });
  const runs = await readJson(join(dataDir, 'runs.json'), { runs: [] });

  const client = createClient({ fetchImpl, ...clientOptions });
  const nowISO = now.toISOString();
  const detailMaxAge = Number(sourcesCfg.detailCacheDays ?? 14);
  const freshCache = new Map(Object.entries(prevDetails).filter(([, d]) => d.fetchedAt && daysBetween(d.fetchedAt, nowISO) <= detailMaxAge));
  const fullCache = new Map(Object.entries(prevDetails));

  const all = sourcesCfg.sources ?? [];
  const automated = all.filter((s) => s.enabled !== false && s.type !== 'manual' && (!only || only.includes(s.id)));
  const results = [];
  const details = {};
  const recheckResults = new Map();

  for (const source of automated) {
    const adapter = ADAPTERS[source.type];
    const started = Date.now();
    if (!adapter) {
      results.push({ sourceId: source.id, status: 'failed', error: `Unknown source type "${source.type}"`, opportunities: [], durationMs: 0 });
      continue;
    }
    try {
      const { listings, complete, scanned } = await adapter.fetchListings(source, client, { cache: freshCache, log });
      const opportunities = [];
      for (const raw of listings) {
        const { opp, text } = normalise(raw, source, { now, prefs });
        opportunities.push(opp);
        const { descriptionHtml, descriptionText, fromCache, ...rawMeta } = raw;
        const cached = freshCache.get(opp.id);
        details[opp.id] = { text: text.slice(0, 15000), raw: rawMeta, workdayPath: raw.workdayPath ?? cached?.workdayPath ?? null, fetchedAt: fromCache && cached?.fetchedAt ? cached.fetchedAt : nowISO };
      }
      const status = complete ? 'ok' : 'partial';
      results.push({ sourceId: source.id, status, complete, scanned, opportunities, durationMs: Date.now() - started });
      log(`✓ ${source.id}: ${opportunities.length} student listing(s) out of ${scanned} scanned${complete ? '' : ' (partial)'}`);

      // Confirm disappearances with the source before closing anything.
      if (complete && adapter.recheck) {
        const freshIds = new Set(opportunities.map((o) => o.id));
        const missing = prevOpps.items.filter((o) => o.sourceId === source.id && !o.closedAt && !freshIds.has(o.id)).slice(0, 20);
        for (const o of missing) {
          recheckResults.set(o.id, await adapter.recheck(source, client, o.externalId, fullCache.get(o.id)));
        }
      }
    } catch (err) {
      const blocked = err.code === 'robots_disallowed';
      results.push({ sourceId: source.id, status: blocked ? 'blocked' : 'failed', error: err.message, errorCode: err.code ?? null, opportunities: [], durationMs: Date.now() - started });
      log(`✗ ${source.id}: ${err.message}`);
    }
  }

  const { items, events } = mergeSourceResults({ previous: prevOpps.items ?? [], results, now, recheckResults });

  // Keep cached text for listings that are still stored but were not refreshed (failed sources).
  for (const o of items) if (!details[o.id] && prevDetails[o.id]) details[o.id] = prevDetails[o.id];

  const sourceStatus = { ...prevSources };
  for (const r of results) {
    sourceStatus[r.sourceId] = updateSourceStatus(prevSources[r.sourceId], r, now);
    if (sourceStatus[r.sourceId].recovered) events.push({ at: nowISO, type: 'source_recovered', sourceId: r.sourceId });
    if (r.status === 'failed' && (prevSources[r.sourceId]?.lastStatus ?? 'ok') !== 'failed') events.push({ at: nowISO, type: 'source_failed', sourceId: r.sourceId, reason: r.error });
  }
  // Manual sources: Radar does not read their listings, but checks weekly that the link still works.
  for (const s of all) {
    if (s.enabled === false) { sourceStatus[s.id] = { ...(sourceStatus[s.id] ?? {}), lastStatus: 'disabled', health: 'disabled' }; continue; }
    if (s.type !== 'manual') continue;
    const st = { ...(sourceStatus[s.id] ?? {}), lastStatus: 'manual', health: 'manual' };
    const due = !st.linkCheckedAt || daysBetween(st.linkCheckedAt, nowISO) >= 7;
    if (due && s.publicUrl && !only && sourcesCfg.checkManualLinks !== false) {
      try {
        await client.getText(s.publicUrl);
        st.linkOk = true;
        st.linkNote = null;
      } catch (err) {
        st.linkOk = err.code === 'robots_disallowed' ? null : false;
        st.linkNote = err.code === 'robots_disallowed' ? 'Site does not allow automated link checks' : err.message;
      }
      st.linkCheckedAt = nowISO;
    }
    sourceStatus[s.id] = st;
  }
  for (const id of Object.keys(sourceStatus)) if (!all.some((s) => s.id === id)) delete sourceStatus[id];

  const targetCycle = Number(String(prefs.summer?.from ?? '2027').slice(0, 4));
  const { state: programmeState, events: progEvents } = computeProgrammes({
    programmes: programmesCfg.programmes ?? [], items, prevState: prevProgrammes, sourceStatus, targetCycle, now,
  });
  events.push(...progEvents);

  const okCount = results.filter((r) => r.status === 'ok').length;
  const partialCount = results.filter((r) => r.status === 'partial').length;
  const failedCount = results.length - okCount - partialCount;
  const runStatus = !results.length ? 'skipped' : failedCount === 0 && partialCount === 0 ? 'success' : okCount + partialCount === 0 ? 'failed' : 'partial';

  const run = {
    id: nowISO,
    startedAt: nowISO,
    finishedAt: new Date().toISOString(),
    trigger,
    status: runStatus,
    scope: only ? only.join(',') : 'all',
    sources: { ok: okCount, partial: partialCount, failed: failedCount, total: results.length },
    newCount: events.filter((e) => e.type === 'new').length,
    changedCount: events.filter((e) => e.type === 'changed' || e.type === 'deadline_passed').length,
    closedCount: events.filter((e) => e.type === 'closed').length,
    requests: client.requestCount,
    errors: results.filter((r) => r.error).map((r) => ({ sourceId: r.sourceId, status: r.status, error: r.error })),
  };

  const prevMeta = await readJson(join(dataDir, 'meta.json'), {});
  const meta = {
    schemaVersion: 1,
    lastRunAt: nowISO,
    lastRunStatus: runStatus,
    lastSuccessfulRunAt: runStatus === 'success' ? nowISO : prevMeta.lastSuccessfulRunAt ?? null,
    lastDataRefreshAt: okCount + partialCount > 0 ? nowISO : prevMeta.lastDataRefreshAt ?? null,
    targetCycle,
    counts: {
      stored: items.length,
      open: items.filter((o) => o.status === 'open' && !o.duplicateOf).length,
      automatedSources: all.filter((s) => s.type !== 'manual' && s.enabled !== false).length,
      manualSources: all.filter((s) => s.type === 'manual').length,
    },
  };

  await writeJson(join(dataDir, 'opportunities.json'), { schemaVersion: 1, generatedAt: nowISO, items });
  await writeJson(join(dataDir, 'details.json'), details, { pretty: false });
  await writeJson(join(dataDir, 'sources-status.json'), sourceStatus);
  await writeJson(join(dataDir, 'programmes-status.json'), programmeState);
  const cutoff = new Date(now.getTime() - 400 * 86400000).toISOString();
  await writeJson(join(dataDir, 'history.json'), { events: [...events, ...(history.events ?? [])].filter((e) => e.at >= cutoff).slice(0, 5000) });
  await writeJson(join(dataDir, 'runs.json'), { runs: [run, ...(runs.runs ?? [])].slice(0, 150) });
  await writeJson(join(dataDir, 'meta.json'), meta);

  log(`Run ${runStatus}: ${okCount} ok, ${partialCount} partial, ${failedCount} failed; ${run.newCount} new, ${run.changedCount} changed, ${run.closedCount} closed; ${client.requestCount} requests.`);
  return { run, items, events, sourceStatus, programmeState, meta };
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
  let fetchImpl;
  let clientOptions = {};
  if (args.fixtures) {
    const { createFixtureFetch } = await import('./lib/fixture-fetch.js');
    fetchImpl = await createFixtureFetch(resolve(String(args.fixtures)));
    clientOptions = { minIntervalMs: 0, baseDelayMs: 1 };
    console.log('Offline mode: using recorded responses from', args.fixtures);
  }
  const only = args.only && args.only !== true ? String(args.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  try {
    const { run } = await runIngest({ fetchImpl, only, clientOptions, dataDir: args.data ? resolve(String(args.data)) : undefined });
    process.exitCode = run.status === 'failed' ? 1 : 0;
  } catch (err) {
    console.error('Ingestion crashed:', err);
    process.exitCode = 2;
  }
}
