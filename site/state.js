// Data loading, personal state (kept in this browser only) and derived values.
import { scoreOpportunity, locationFit } from './shared/match.js';

const KEY = 'internship-radar.v1';
export const STALE_DAYS = 3;

export function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveLocal(local) {
  try {
    localStorage.setItem(KEY, JSON.stringify(local));
    return true;
  } catch {
    return false;
  }
}

export function storageAvailable() {
  try {
    const k = '__radar_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

async function getJSON(path, fallback) {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) return fallback;
    return await r.json();
  } catch {
    return fallback;
  }
}

let detailsPromise = null;
export function loadDetails() {
  detailsPromise ??= getJSON('data/details.json', {});
  return detailsPromise;
}

export async function loadData() {
  const [meta, opps, sourceStatus, programmeStatus, history, runs, sourcesCfg, programmesCfg, defaults] = await Promise.all([
    getJSON('data/meta.json', null),
    getJSON('data/opportunities.json', { items: [] }),
    getJSON('data/sources-status.json', {}),
    getJSON('data/programmes-status.json', {}),
    getJSON('data/history.json', { events: [] }),
    getJSON('data/runs.json', { runs: [] }),
    getJSON('config/sources.json', { sources: [] }),
    getJSON('config/programmes.json', { programmes: [] }),
    getJSON('config/preferences.json', {}),
  ]);
  return {
    meta,
    items: opps.items ?? [],
    sourceStatus,
    programmeStatus,
    events: history.events ?? [],
    runs: runs.runs ?? [],
    sources: sourcesCfg.sources ?? [],
    programmes: programmesCfg.programmes ?? [],
    defaults,
  };
}

export function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, over) {
  if (!isPlainObject(over)) return structuredClone(base ?? {});
  const out = structuredClone(base ?? {});
  for (const [k, v] of Object.entries(over)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : structuredClone(v);
  }
  return out;
}

export function effectivePrefs(defaults, local) {
  const { _help, ...clean } = defaults ?? {};
  return deepMerge(clean, local.settings ?? {});
}

// Adds the viewer-specific fields: score with current settings, location fit,
// staleness and whether it is new since the last time alerts were marked as seen.
export function derive(items, prefs, local, now = new Date()) {
  const seenUntil = local.seenUntil ?? null;
  const staleBefore = new Date(now.getTime() - STALE_DAYS * 86400000).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  return items.map((o) => {
    const match = scoreOpportunity(o, prefs);
    const loc = locationFit(o, prefs);
    return {
      ...o,
      match,
      locFit: loc,
      stale: !o.closedAt && o.lastVerifiedAt && o.lastVerifiedAt < staleBefore,
      isNew: seenUntil ? o.firstSeenAt > seenUntil : o.firstSeenAt > weekAgo,
      saved: Boolean(local.saved?.[o.id]),
    };
  });
}

export function isLive(o) {
  return !o.duplicateOf && (o.status === 'open' || o.status === 'opening_soon');
}

// GitHub Pages URLs look like https://<owner>.github.io/<repo>/ — used to link to the
// workflow page for manual refreshes.
export function repoFromLocation(loc = window.location) {
  const m = /^([a-z0-9-]+)\.github\.io$/i.exec(loc.hostname);
  if (!m) return null;
  const repo = loc.pathname.split('/').filter(Boolean)[0] ?? `${m[1]}.github.io`;
  return { owner: m[1], repo };
}
