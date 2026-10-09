// Recurring programmes (e.g. "IMC summer internships, Amsterdam") and their
// recruitment cycles. Confirmed dates come only from listings or from evidence
// entered in config/programmes.json with a source URL. Predictions are always
// labelled as estimates and carry their basis.
import { addDays, daysBetween } from '../../site/shared/dates.js';

export const PROGRAMME_STATUS = {
  OPEN_NOW: 'OPEN NOW',
  OPENING_SOON: 'OPENING SOON',
  EXPECTED: 'EXPECTED TO OPEN',
  NOT_ANNOUNCED: 'NOT YET ANNOUNCED',
  CLOSED: 'CLOSED',
  DEADLINE_PASSED: 'DEADLINE PASSED',
  UNKNOWN: 'STATUS UNKNOWN',
};

export function matchesProgramme(p, opp) {
  if (!p.sourceId || opp.sourceId !== p.sourceId) return false;
  const m = p.match ?? {};
  if (m.titleAny?.length && !m.titleAny.some((re) => new RegExp(re, 'i').test(opp.title))) return false;
  if (m.titleNone?.length && m.titleNone.some((re) => new RegExp(re, 'i').test(opp.title))) return false;
  if (m.locationAny?.length && !m.locationAny.some((re) => new RegExp(re, 'i').test(opp.location?.text ?? ''))) return false;
  return true;
}

// The recruitment cycle a listing belongs to: a year in the title ("Summer 2027"),
// or a stated start month/season. ASAP or unstated starts belong to no cycle.
function cycleOf(opp, fallback) {
  const fromTitle = /\b(20\d\d)\b/.exec(opp.title)?.[1];
  const s = opp.startDate;
  const fromStart = s?.date && ['day', 'month', 'season', 'year'].includes(s.precision) ? s.date.slice(0, 4) : null;
  const y = fromTitle ?? fromStart;
  return y ? Number(y) : fallback;
}

// Estimate the next opening from openings observed in earlier cycles.
export function predictOpening(evidence, targetCycle) {
  const past = evidence.filter((e) => e.cycle < targetCycle && e.openedOn);
  if (!past.length) return null;
  const shifted = past.map((e) => addDays(e.openedOn, Math.round((targetCycle - e.cycle) * 365.25)));
  shifted.sort();
  const from = addDays(shifted[0], -14);
  const to = addDays(shifted[shifted.length - 1], 14);
  return {
    from,
    to,
    confidence: past.length >= 2 ? 'medium' : 'low',
    basis: past.map((e) => `${e.precision === 'on_or_before' ? 'Opened on or before' : 'Opened'} ${e.openedOn} for the ${e.cycle} cycle${e.sourceUrl ? ` (${e.sourceUrl})` : ''}`),
  };
}

export function computeProgrammes({ programmes, items, prevState = {}, sourceStatus = {}, targetCycle, now }) {
  const nowISO = now.toISOString();
  const today = nowISO.slice(0, 10);
  const state = {};
  const events = [];

  for (const p of programmes) {
    const prev = prevState[p.id] ?? {};
    const observed = { ...(prev.observedOpenings ?? {}) };
    const matching = p.kind === 'auto' ? items.filter((o) => !o.duplicateOf && matchesProgramme(p, o)) : [];
    const open = matching.filter((o) => o.status === 'open');

    // Record the first time a listing for a cycle was seen: the opening happened on or before this date.
    for (const o of matching) {
      const c = cycleOf(o, null);
      if (!c) continue;
      const seen = (o.postedAt && o.postedAt < o.firstSeenAt.slice(0, 10) ? o.postedAt : o.firstSeenAt.slice(0, 10));
      if (!observed[c] || seen < observed[c].openedOn) {
        observed[c] = { openedOn: seen, precision: o.postedAt ? 'published' : 'on_or_before', opportunityId: o.id, url: o.url };
      }
    }

    const evidence = [
      ...(p.evidence ?? []).map((e) => ({ cycle: e.cycle, openedOn: e.openedOn, deadline: e.deadline ?? null, sourceUrl: e.sourceUrl, note: e.note, precision: e.precision ?? 'day', from: 'manual' })),
      ...Object.entries(observed).map(([c, o]) => ({ cycle: Number(c), openedOn: o.openedOn, sourceUrl: o.url, precision: o.precision === 'published' ? 'day' : 'on_or_before', from: 'observed' })),
    ].sort((a, b) => a.cycle - b.cycle);

    const announced = p.announced ?? null; // { cycle, opening, deadline, sourceUrl, verifiedOn }
    const src = p.sourceId ? sourceStatus[p.sourceId] : null;
    const sourceHealthy = !!src && (src.lastStatus === 'ok' || src.lastStatus === 'partial');
    // Rolling programmes post roles all year, so an opening date cannot be predicted.
    const prediction = p.rolling === true ? null : predictOpening(evidence, targetCycle);

    let status;
    let reason;
    if (open.length) {
      status = PROGRAMME_STATUS.OPEN_NOW;
      reason = `${open.length} matching listing${open.length > 1 ? 's are' : ' is'} live on the official board.`;
    } else if (announced?.opening && announced.opening > today) {
      status = PROGRAMME_STATUS.OPENING_SOON;
      reason = `Opening date ${announced.opening} confirmed by the employer${announced.sourceUrl ? ` (${announced.sourceUrl})` : ''}.`;
    } else if (announced?.deadline && announced.deadline < today && announced.cycle === targetCycle) {
      status = PROGRAMME_STATUS.DEADLINE_PASSED;
      reason = `The ${targetCycle} deadline (${announced.deadline}) has passed.`;
    } else if (matching.some((o) => o.status === 'deadline_passed') && !open.length) {
      status = PROGRAMME_STATUS.DEADLINE_PASSED;
      reason = 'The matching listings have passed their deadline.';
    } else if (matching.length && matching.every((o) => o.status === 'closed')) {
      status = PROGRAMME_STATUS.CLOSED;
      reason = 'Previously seen listings have been taken down.';
    } else if (prediction) {
      status = PROGRAMME_STATUS.EXPECTED;
      reason = `Estimated from ${evidence.filter((e) => e.cycle < targetCycle).length} earlier cycle(s); not confirmed.`;
      if (prediction.to < today) reason += ' The estimated window has passed without a listing being seen.';
    } else if (p.kind === 'auto' && sourceHealthy) {
      status = PROGRAMME_STATUS.NOT_ANNOUNCED;
      reason = `No matching listing on the monitored board as of ${String(src.lastSuccessAt).slice(0, 10)}. No earlier cycles recorded yet.`;
    } else {
      status = PROGRAMME_STATUS.UNKNOWN;
      reason = p.kind === 'manual' ? 'Not monitored automatically. Check the page and record what you find.' : 'The source could not be checked.';
    }

    if (prev.status && prev.status !== status) {
      events.push({ at: nowISO, type: status === PROGRAMME_STATUS.OPEN_NOW ? 'programme_opened' : 'programme_status', programmeId: p.id, field: 'status', from: prev.status, to: status, evidence: open[0]?.url ?? p.url });
    }

    const upcoming = announced?.opening && announced.opening > today ? daysBetween(today, announced.opening) : null;
    state[p.id] = {
      status,
      reason,
      matchingIds: matching.map((o) => o.id),
      openIds: open.map((o) => o.id),
      observedOpenings: observed,
      evidence,
      prediction,
      announced,
      daysUntilOpening: upcoming,
      lastCheckedAt: p.kind === 'auto' ? (src?.lastSuccessAt ?? null) : (p.lastManualCheck ?? null),
      statusSince: prev.status === status ? prev.statusSince ?? nowISO : nowISO,
    };
  }
  return { state, events };
}
