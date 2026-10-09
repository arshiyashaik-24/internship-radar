// Explainable 0–100 match score. Runs in the browser with the viewer's current
// settings, and in the ingestion script with the repository defaults.
// Eligibility is scored here but also filtered separately, so a strong technical
// match can never make an ineligible role look eligible.

import { FIELD_LABELS } from './taxonomy.js';
import { isComboRole } from './classify.js';

export const DEFAULT_WEIGHTS = { technical: 35, eligibility: 25, location: 15, schedule: 10, skills: 10, compensation: 5 };

const COMPONENT_LABELS = {
  technical: 'Technical fit',
  eligibility: 'Eligibility',
  location: 'Location',
  schedule: 'Dates and hours',
  skills: 'Skills',
  compensation: 'Pay',
};

// Which of the two searches does a role belong to?
export function trackOf(opp) {
  if (opp.type === 'talent_pool') return 'programme';
  const partTimeHint = opp.schedule === 'part_time' || opp.type === 'working_student' || (opp.hours?.max != null && opp.hours.max <= 24);
  if (partTimeHint) return 'part_time';
  return 'summer';
}

function inRange(iso, from, to) {
  return iso >= from && iso <= to;
}

export function locationFit(opp, prefs) {
  const loc = opp.location ?? {};
  const L = prefs.locations ?? {};
  if (loc.arrangement === 'remote') {
    switch (loc.remoteRegion) {
      case 'NL': return { score: L.remoteNL !== false || L.remoteWorldwide ? 1 : 0, compatible: L.remoteNL !== false || !!L.remoteWorldwide, why: 'Remote, open to the Netherlands' };
      case 'EU': return { score: L.remoteEurope !== false || L.remoteWorldwide ? 0.95 : 0, compatible: L.remoteEurope !== false || !!L.remoteWorldwide, why: 'Remote within Europe' };
      case 'worldwide': return { score: L.remoteWorldwide ? 0.85 : 0.2, compatible: !!L.remoteWorldwide, why: 'Remote worldwide (check residency and work-permit terms)' };
      case 'restricted_elsewhere': return { score: 0, compatible: false, why: `Remote, but limited to ${loc.text || 'another country'}` };
      default: return { score: 0.4, compatible: 'unverified', why: 'Remote, but the listing does not say where you can work from' };
    }
  }
  if (loc.isNetherlands) {
    const nlOk = L.netherlands !== false || (loc.arrangement === 'hybrid' && L.hybridNL !== false);
    if (!nlOk) return { score: 0.2, compatible: false, why: 'In the Netherlands (not in your location filters)' };
    if (loc.isBrainport) return { score: 1, compatible: true, why: `${loc.arrangement === 'hybrid' ? 'Hybrid' : 'On site'} in the Eindhoven/Brainport region` };
    return { score: L.preferBrainport ? 0.85 : 1, compatible: true, why: `${loc.arrangement === 'hybrid' ? 'Hybrid' : 'On site'} in the Netherlands` };
  }
  if (loc.region === 'europe') return { score: L.europeOnsite ? 0.6 : 0.1, compatible: !!L.europeOnsite, why: `On site in ${loc.text || 'Europe'}` };
  if (loc.region === 'outside_europe') return { score: 0, compatible: false, why: `On site in ${loc.text || 'a non-European location'}` };
  return { score: 0.4, compatible: 'unverified', why: 'Location not stated clearly' };
}

function scheduleFit(opp, prefs) {
  const track = trackOf(opp);
  if (track === 'part_time') {
    const pmin = Number(prefs.partTime?.minHours ?? 8);
    const pmax = Number(prefs.partTime?.maxHours ?? 16);
    const h = opp.hours;
    if (!h || (h.min == null && h.max == null)) return { score: 0.5, known: false, why: 'Weekly hours not stated' };
    const lo = h.min ?? h.max;
    const hi = h.max ?? h.min;
    if (lo >= pmin && hi <= pmax) return { score: 1, known: true, why: `${lo === hi ? lo : `${lo}–${hi}`} h/week fits ${pmin}–${pmax}` };
    if (lo <= pmax && hi >= pmin) return { score: 0.75, known: true, why: `${lo}–${hi} h/week partly fits ${pmin}–${pmax}` };
    return { score: lo > pmax ? 0.2 : 0.4, known: true, why: `${lo === hi ? lo : `${lo}–${hi}`} h/week is outside ${pmin}–${pmax}` };
  }
  if (track === 'programme') return { score: 0.5, known: false, why: 'Interest form, no fixed dates' };
  const from = prefs.summer?.from ?? '2027-07-01';
  const to = prefs.summer?.to ?? '2027-09-30';
  const windowMonths = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (30.4 * 86400000)));
  const s = opp.startDate;
  let score = 0.5;
  let known = false;
  let why = 'Start date not stated';
  if (s?.date) {
    known = true;
    if (s.precision === 'year') {
      score = s.date.slice(0, 4) === from.slice(0, 4) ? 0.65 : 0.1;
      why = `Starts in ${s.date.slice(0, 4)}`;
    } else if (s.precision === 'season') {
      score = s.season && /summer|zomer/.test(s.season) && s.date.slice(0, 4) === from.slice(0, 4) ? 1 : 0.2;
      why = `Starts ${s.season} ${s.date.slice(0, 4)}`;
    } else if (inRange(s.date, from, to)) {
      score = 1;
      why = `Starts ${s.date} (inside your summer window)`;
    } else {
      const gap = Math.abs(Date.parse(s.date) - Date.parse(from)) / 86400000;
      score = gap < 75 ? 0.6 : 0.1;
      why = `Starts ${s.date} (outside ${from} – ${to})`;
    }
  }
  const d = opp.duration;
  if (d?.minMonths != null && d.minMonths > windowMonths + 0.5) {
    score = Math.min(score, 0.35);
    why += `; needs at least ${d.minMonths} months`;
    known = true;
  }
  return { score, known, why };
}

function skillsFit(opp, prefs) {
  const mine = new Set((prefs.profile?.skills ?? []).map((s) => s.toLowerCase()));
  const req = opp.skills?.required ?? [];
  const pref = opp.skills?.preferred ?? [];
  if (!req.length && !pref.length) return { score: 0.5, known: false, why: 'No specific tools listed' };
  const reqHit = req.filter((s) => mine.has(s.toLowerCase()));
  const prefHit = pref.filter((s) => mine.has(s.toLowerCase()));
  const base = req.length ? reqHit.length / req.length : 0.6;
  const score = Math.min(1, base + (pref.length ? 0.15 * (prefHit.length / pref.length) : 0));
  const missing = req.filter((s) => !mine.has(s.toLowerCase()));
  return {
    score,
    known: true,
    why: `${reqHit.length}/${req.length} listed skills match${missing.length ? `; not in your profile: ${missing.slice(0, 4).join(', ')}` : ''}`,
  };
}

function technicalFit(opp, prefs) {
  const wanted = new Set(prefs.fields ?? []);
  const tags = opp.fields ?? [];
  const hits = tags.filter((t) => wanted.has(t));
  if (!tags.length) return { score: 0.25, known: false, why: 'No technical field recognised in the listing' };
  if (!hits.length) return { score: 0.1, known: true, why: `Fields (${tags.map((t) => FIELD_LABELS[t]).join(', ')}) are not in your list` };
  let score = hits.length >= 2 ? 0.85 : 0.7;
  const combo = isComboRole(hits);
  if (combo) score = Math.min(1, score + 0.15);
  return { score, known: true, why: `${hits.map((t) => FIELD_LABELS[t]).join(' + ')}${combo ? ' (combined CS/physics/hardware profile)' : ''}` };
}

const ELIG_SCORE = { eligible: 1, potential: 0.7, unknown: 0.5, future: 0.15, ineligible: 0 };

function compensationFit(opp, prefs) {
  const c = opp.compensation ?? { status: 'unknown' };
  if (c.status === 'paid') return { score: 1, known: true, why: c.amount ? `Paid (${c.currency ?? ''} ${c.amount}${c.amountMax ? `–${c.amountMax}` : ''} per ${c.period ?? 'period'})`.replace('  ', ' ') : 'Paid' };
  if (c.status === 'unpaid') {
    const research = opp.type === 'research' || opp.type === 'thesis';
    if (research && prefs.compensation?.allowUnpaidResearch !== false) return { score: 0.6, known: true, why: 'Unpaid research role (allowed in your settings)' };
    return { score: 0.1, known: true, why: 'Unpaid' };
  }
  return { score: 0.5, known: false, why: 'Pay not stated' };
}

export function scoreOpportunity(opp, prefs) {
  const w = { ...DEFAULT_WEIGHTS, ...(prefs.weights ?? {}) };
  const parts = {
    technical: technicalFit(opp, prefs),
    eligibility: { score: ELIG_SCORE[opp.eligibility?.label ?? 'unknown'] ?? 0.5, known: (opp.eligibility?.label ?? 'unknown') !== 'unknown', why: (opp.eligibility?.reasons ?? [])[0] ?? 'Not assessed' },
    location: (() => { const l = locationFit(opp, prefs); return { score: l.score, known: l.compatible !== 'unverified', why: l.why }; })(),
    schedule: scheduleFit(opp, prefs),
    skills: skillsFit(opp, prefs),
    compensation: compensationFit(opp, prefs),
  };
  const totalW = Object.values(w).reduce((a, b) => a + Number(b || 0), 0) || 1;
  let sum = 0;
  const breakdown = [];
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const weight = Number(w[key] || 0);
    const p = parts[key];
    const points = (weight * p.score * 100) / totalW;
    sum += points;
    breakdown.push({ key, label: COMPONENT_LABELS[key], points: Math.round(points * 10) / 10, max: Math.round((weight * 1000) / totalW) / 10, why: p.why, known: p.known });
  }
  const knownCount = breakdown.filter((b) => b.known).length;
  const confidence = knownCount >= 5 ? 'high' : knownCount >= 3 ? 'medium' : 'low';
  return { score: Math.round(sum), breakdown, confidence };
}
