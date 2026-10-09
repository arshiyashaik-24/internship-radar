// Merges a run's fresh listings into the stored dataset: deduplicates, records
// meaningful changes, and closes listings only with evidence.
import { liveStatus } from '../../site/shared/normalise.js';
import { daysBetween } from '../../site/shared/dates.js';

const TRACKED = [
  ['status', (o) => o.status],
  ['deadline', (o) => o.deadline?.date ?? null],
  ['openingDate', (o) => (o.openingDate?.from === 'text' ? o.openingDate.date : null)],
  ['applyUrl', (o) => o.applyUrl ?? null],
  ['title', (o) => o.title],
  ['eligibility', (o) => o.eligibility?.label ?? null],
];

export function mergeSourceResults({ previous, results, now, recheckResults = new Map() }) {
  const nowISO = now.toISOString();
  const today = nowISO.slice(0, 10);
  const byId = new Map(previous.map((o) => [o.id, { ...o }]));
  const events = [];
  const ev = (e) => events.push({ at: nowISO, ...e });

  for (const r of results) {
    if (r.status !== 'ok' && r.status !== 'partial') continue; // failed sources keep their old data untouched
    const freshIds = new Set();
    for (const fresh of r.opportunities) {
      freshIds.add(fresh.id);
      const prev = byId.get(fresh.id);
      const merged = {
        ...fresh,
        firstSeenAt: prev?.firstSeenAt ?? nowISO,
        lastSeenAt: nowISO,
        lastVerifiedAt: nowISO,
        missedRuns: 0,
        closedAt: null,
        evidenceUrls: [...new Set([fresh.url, fresh.sourceUrl, ...(prev?.evidenceUrls ?? [])].filter(Boolean))].slice(0, 6),
      };
      merged.status = liveStatus(merged, today);
      if (!prev) {
        ev({ type: 'new', id: merged.id, sourceId: r.sourceId, to: merged.title, evidence: merged.url });
      } else {
        if (prev.closedAt) ev({ type: 'reopened', id: merged.id, sourceId: r.sourceId, evidence: merged.url });
        for (const [field, get] of TRACKED) {
          const a = get(prev);
          const b = get(merged);
          if (a !== b && !(field === 'status' && prev.closedAt)) {
            ev({ type: field === 'status' && b === 'deadline_passed' ? 'deadline_passed' : 'changed', id: merged.id, sourceId: r.sourceId, field, from: a, to: b, evidence: merged.url });
          }
        }
      }
      byId.set(merged.id, merged);
    }

    // Listings that this source no longer returns.
    for (const o of byId.values()) {
      if (o.sourceId !== r.sourceId || freshIds.has(o.id) || o.closedAt) continue;
      if (!r.complete) continue; // a truncated fetch proves nothing
      const check = recheckResults.get(o.id);
      if (check === true) {
        o.lastVerifiedAt = nowISO;
        o.note = 'Still online, but no longer returned by the student-role search';
        continue;
      }
      o.missedRuns = (o.missedRuns ?? 0) + 1;
      if (check === false || o.missedRuns >= 2) {
        o.closedAt = nowISO;
        const prevStatus = o.status;
        o.status = 'closed';
        ev({
          type: 'closed', id: o.id, sourceId: r.sourceId, field: 'status', from: prevStatus, to: 'closed', evidence: o.url,
          reason: check === false ? 'The application system reports the posting no longer exists' : 'Not listed on two consecutive successful checks',
        });
      }
    }
  }

  // Deadlines that passed since the last run, for listings not refreshed this run.
  for (const o of byId.values()) {
    if (o.closedAt) continue;
    const s = liveStatus(o, today);
    if (s !== o.status) {
      ev({ type: s === 'deadline_passed' ? 'deadline_passed' : 'changed', id: o.id, sourceId: o.sourceId, field: 'status', from: o.status, to: s, evidence: o.url });
      o.status = s;
    }
  }

  // Duplicate detection: same employer + title + location from more than one record.
  const byFp = new Map();
  const items = [...byId.values()].sort((a, b) => (a.sourceTier ?? 1) - (b.sourceTier ?? 1) || String(a.firstSeenAt).localeCompare(String(b.firstSeenAt)) || a.id.localeCompare(b.id));
  for (const o of items) {
    o.duplicateOf = null;
    if (o.closedAt) continue;
    const primary = byFp.get(o.fingerprint);
    if (primary) {
      o.duplicateOf = primary.id;
      primary.evidenceUrls = [...new Set([...(primary.evidenceUrls ?? []), o.url])].slice(0, 8);
    } else byFp.set(o.fingerprint, o);
  }

  // Drop closed listings after 120 days; keep everything else.
  const kept = items.filter((o) => !o.closedAt || daysBetween(o.closedAt, nowISO) <= 120);
  return { items: kept, events };
}

export function updateSourceStatus(prevStatus = {}, result, now) {
  const nowISO = now.toISOString();
  const s = { ...prevStatus };
  const wasFailing = ['failed', 'blocked'].includes(s.lastStatus);
  s.lastAttemptAt = nowISO;
  s.lastStatus = result.status;
  s.durationMs = result.durationMs;
  if (result.status === 'ok' || result.status === 'partial') {
    s.lastSuccessAt = nowISO;
    s.consecutiveFailures = 0;
    s.listingsFound = result.opportunities.length;
    s.scanned = result.scanned ?? null;
    s.lastError = result.status === 'partial' ? result.error ?? 'Some details were skipped this run (request budget reached)' : null;
    s.lastErrorCode = null;
  } else {
    s.consecutiveFailures = (s.consecutiveFailures ?? 0) + 1;
    s.lastError = result.error;
    s.lastErrorCode = result.errorCode ?? null;
  }
  s.health = result.status === 'ok' ? 'healthy'
    : result.status === 'partial' ? 'degraded'
    : result.status === 'blocked' ? 'blocked'
    : s.consecutiveFailures >= 3 ? 'failing' : 'degraded';
  s.recovered = wasFailing && (result.status === 'ok' || result.status === 'partial');
  s.history = [{ at: nowISO, status: result.status, found: result.opportunities?.length ?? 0, error: result.error ?? null }, ...(s.history ?? [])].slice(0, 30);
  return s;
}
