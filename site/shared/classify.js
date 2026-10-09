// Rule-based extraction of structured facts from a vacancy's title, location and text.
// Every extractor returns null / 'unknown' when the text does not say, so missing data
// is never confused with "no" or zero.

import { FIELDS, SKILLS, BRAINPORT, NL_PLACES, EUROPE, NON_EUROPE, COMBO_FIELDS, CS_FIELDS } from './taxonomy.js';
import { sentenceAround } from './text.js';

const hasWord = (haystack, word) => {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${esc}($|[^a-z])`, 'i').test(haystack);
};

// ---------------------------------------------------------------------------
// Is this a student role at all, and which kind?

const STUDENT_TITLE_RE = /\b(?:intern(?:ship)?s?|stagiair(?:e)?|stage(?:opdracht|plaats)?|werkstudent|working student|student(?:[- ]assistant|[- ]job|[- ]researcher|[- ]developer|[- ]engineer|[- ]programmer|[- ]analyst)?|trainee(?:ship)?|co-?op|summer (?:analyst|associate|student|programme|program|school|research)|research assistant|thesis|graduation (?:project|assignment|internship)|afstudeer\w*|placement|praktikum|campus programme|talent community|expression of interest|interest form|insight (?:day|week)s?|spring week|bijbaan)\b/i;
const NOT_STUDENT_RE = /\b(?:internal|international|(?:early|late|multi|single|growth|seed|next)[- ]stage|student (?:loans?|success|recruitment|affairs|services)|intern(?:al)? (?:audit|control))\b/i;
const GRADUATE_ONLY_RE = /\b(?:graduate (?:trader|quant|engineer|researcher|developer|analyst|programme|program|scheme)|new grad|graduate trainee)\b/i;

export function isStudentRole(title) {
  const t = String(title ?? '');
  const cleaned = t.replace(NOT_STUDENT_RE, ' ');
  if (!STUDENT_TITLE_RE.test(cleaned)) return false;
  // "Graduate Trader" style full-time roles are not internships, unless the title also says intern.
  if (GRADUATE_ONLY_RE.test(t) && !/\bintern/i.test(t)) return false;
  return true;
}

export function employmentType(title, text = '') {
  const t = String(title ?? '');
  if (/\b(?:talent community|expression of interest|interest form|talent pool)\b/i.test(t)) return 'talent_pool';
  if (/\b(?:thesis|graduation (?:project|assignment|internship)|afstudeer\w*)\b/i.test(t)) return 'thesis';
  if (/\b(?:werkstudent|working student|student[- ]assistant|student[- ]job|bijbaan|student (?:developer|engineer|programmer|analyst))\b/i.test(t)) return 'working_student';
  if (/\b(?:research (?:intern|assistant|internship)|student[- ]researcher|research student|summer research)\b/i.test(t)) return 'research';
  if (/\b(?:intern(?:ship)?s?|stagiair|stage|trainee|co-?op|placement|praktikum|summer)\b/i.test(t)) return 'internship';
  if (/\bresearch\b/i.test(t) && /\bstudent\b/i.test(t)) return 'research';
  if (/\bpart[- ]?time\b/i.test(text)) return 'working_student';
  return 'other';
}

// ---------------------------------------------------------------------------
// Hours, duration, part-time

export function extractHours(text) {
  if (!text) return null;
  // On-site presence ("at least 3 days per week in the office") describes where you
  // work, not how many hours, so those sentences are removed first.
  const s = String(text).replace(/[^.\n]*\b(?:in[- ]person|on[- ]site|onsite|in (?:the|our) office|at (?:the|our) office|office[- ]based|presence on site)\b[^.\n]*/gi, ' ');
  // Philips-style header: "Weekly Presence: 40h (minimum 32h)"
  const header = /\b(?:weekly (?:presence|hours)|hours per week|working hours|uren per week|aantal uren)\s*[:\-]\s*(\d{1,2})\s*(?:h|hrs?|hours?|uur)?(?:\s*\(\s*(?:minimum|min\.?|at least)\s*(\d{1,2})\s*(?:h|hrs?|hours?|uur)?\s*\))?(?:\s*(?:-|–|to)\s*(\d{1,2})\s*(?:h|hrs?|hours?|uur)?)?/i.exec(s);
  if (header) {
    const a = Number(header[1]);
    const lo = header[2] ? Number(header[2]) : a;
    const hi = header[3] ? Number(header[3]) : a;
    if (a >= 1 && a <= 60) return { min: Math.min(lo, hi), max: Math.max(lo, hi, a), evidence: header[0] };
  }
  const unit = '(?:hours?|hrs?|uur|h)\\s*(?:per|a|\\/|p\\.?\\s?)\\s*(?:week|wk|w\\b)';
  const range = new RegExp(`(\\d{1,2})\\s*(?:-|–|to|tot|and)\\s*(\\d{1,2})\\s*${unit}`, 'i').exec(s);
  if (range) {
    const [min, max] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b);
    if (min >= 1 && max <= 60) return { min, max, evidence: range[0] };
  }
  const single = new RegExp(`(?:max(?:imum)?\\s+(?:of\\s+)?|up to\\s+|at least\\s+|min(?:imum)?\\s+(?:of\\s+)?)?(\\d{1,2})\\s*${unit}`, 'i').exec(s);
  if (single) {
    const n = Number(single[1]);
    if (n >= 1 && n <= 60) {
      const lead = single[0].toLowerCase();
      if (/max|up to/.test(lead)) return { min: null, max: n, evidence: single[0] };
      if (/at least|min/.test(lead)) return { min: n, max: null, evidence: single[0] };
      return { min: n, max: n, evidence: single[0] };
    }
  }
  const days = /(\d(?:[.,]5)?)\s*(?:-|–|to)?\s*(\d)?\s*(?:days?|dagen)\s*(?:per|a|\/|in de)\s*(?:week|wk)/i.exec(s);
  if (days) {
    const a = Number(days[1].replace(',', '.'));
    const b = days[2] ? Number(days[2]) : a;
    if (a >= 0.5 && b <= 5) return { min: Math.round(a * 8), max: Math.round(b * 8), evidence: days[0], derivedFromDays: true };
  }
  return null;
}

export function workSchedule(hint, text, hours) {
  const h = String(hint ?? '').toLowerCase();
  if (/part/.test(h)) return 'part_time';
  if (/full/.test(h)) return hours?.max && hours.max <= 30 ? 'part_time' : 'full_time';
  if (/\b(?:part[- ]?time|parttime|deeltijd|flexible hours|alongside (?:your|their) stud(?:y|ies)|combine[ds]? with (?:your )?stud)/i.test(text ?? '')) return 'part_time';
  if (hours?.max != null && hours.max <= 30) return 'part_time';
  if (hours?.min != null && hours.min >= 32) return 'full_time';
  if (/\bfull[- ]?time\b|\bvoltijd\b/i.test(text ?? '')) return 'full_time';
  return 'unknown';
}

export function extractDuration(text) {
  if (!text) return null;
  const s = String(text);
  const toMonths = (n, u) => (/week|weken/i.test(u) ? Math.round((n / 4.33) * 10) / 10 : n);
  const min = /(?:minimum|at least|min\.?|minimaal|ten minste)\s*(?:of\s*|duration of\s*)?[\/:]?\s*(\d{1,2})\s*(months?|weeks?|maanden|weken)/i.exec(s);
  if (min) return { minMonths: toMonths(Number(min[1]), min[2]), maxMonths: null, evidence: min[0] };
  const range = /(\d{1,2})\s*(?:-|–|to|tot)\s*(\d{1,2})\s*(months?|weeks?|maanden|weken)\b/i.exec(s);
  if (range) return { minMonths: toMonths(Number(range[1]), range[3]), maxMonths: toMonths(Number(range[2]), range[3]), evidence: range[0] };
  const single = /(\d{1,2})[- ](months?|weeks?|maanden|weken)\s+(?:internship|stage|placement|programme|program|project)/i.exec(s)
    || /(?:duration|period|looptijd|duur)\s*(?:of|:|is|van)?\s*(?:approximately|approx\.?|about|around|ca\.?|circa|roughly)?\s*(\d{1,2})\s*(months?|weeks?|maanden|weken)/i.exec(s);
  if (single) {
    const n = toMonths(Number(single[1]), single[2]);
    return { minMonths: n, maxMonths: n, evidence: single[0] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compensation

const CUR = { '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR', '$': 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP', chf: 'CHF' };

function parseAmount(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s/g, '');
  let mult = 1;
  if (/k$/i.test(s)) { mult = 1000; s = s.slice(0, -1); }
  // 1.250,50 or 1,250.50 or 1250
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s) * mult;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function extractCompensation(text, structured) {
  if (structured && (structured.min != null || structured.max != null || structured.summary)) {
    return {
      status: 'paid',
      amount: structured.min ?? null,
      amountMax: structured.max ?? null,
      currency: structured.currency ?? null,
      period: structured.period ?? null,
      evidence: structured.summary ?? null,
    };
  }
  const s = String(text ?? '');
  if (/\b(?:unpaid|onbetaald|no (?:financial )?compensation|not (?:be )?paid|without (?:pay|remuneration)|voluntary basis)\b/i.test(s)) {
    const idx = s.search(/\b(?:unpaid|onbetaald|no (?:financial )?compensation|not (?:be )?paid|without (?:pay|remuneration)|voluntary basis)\b/i);
    return { status: 'unpaid', amount: null, amountMax: null, currency: null, period: null, evidence: sentenceAround(s, idx) };
  }
  const re = /(€|\$|£|\b(?:eur|euros?|usd|gbp|chf)\b)\s?(\d[\d.,]*k?)(?:\s*(?:-|–|to|tot)\s*(?:€|\$|£)?\s?(\d[\d.,]*k?))?\s*(?:gross\s+|bruto\s+)?(?:per|\/|a|p\.?|each|every)\s*(month|hour|year|week|maand|uur|jaar|annum|hr|mo)\b/i;
  const m = re.exec(s);
  if (m) {
    const period = { maand: 'month', mo: 'month', uur: 'hour', hr: 'hour', jaar: 'year', annum: 'year' }[m[4].toLowerCase()] ?? m[4].toLowerCase();
    return {
      status: 'paid',
      amount: parseAmount(m[2]),
      amountMax: parseAmount(m[3]),
      currency: CUR[m[1].toLowerCase()] ?? null,
      period,
      evidence: m[0],
    };
  }
  // "Monthly full-time allowance between €500 - €700 gross"
  const monthly = /\b(?:monthly|maandelijkse?)\b[^.\n€$£]{0,50}?(€|\$|£|\b(?:eur|euros?)\b)\s?(\d[\d.,]*k?)(?:\s*(?:-|–|to|tot|and)\s*(?:€|\$|£)?\s?(\d[\d.,]*k?))?/i.exec(s);
  if (monthly) {
    return { status: 'paid', amount: parseAmount(monthly[2]), amountMax: parseAmount(monthly[3]), currency: CUR[monthly[1].toLowerCase()] ?? null, period: 'month', evidence: monthly[0] };
  }
  const paidRe = /\b(?:internship (?:allowance|compensation|fee|salary)|stagevergoeding|(?:monthly|competitive) (?:allowance|stipend|salary|compensation)|stipend|paid internship|we (?:offer|pay) (?:a |an )?(?:competitive )?(?:salary|allowance|compensation)|hourly (?:wage|rate)|salary|uurloon|vergoeding|(?:full-time |part-time )?allowance)\b/i;
  const pm = paidRe.exec(s);
  if (pm) return { status: 'paid', amount: null, amountMax: null, currency: null, period: null, evidence: sentenceAround(s, pm.index) };
  return { status: 'unknown', amount: null, amountMax: null, currency: null, period: null, evidence: null };
}

// ---------------------------------------------------------------------------
// Location and working arrangement

export function analyseLocation(locations, text, hints = {}) {
  const list = (Array.isArray(locations) ? locations : [locations]).filter(Boolean).map(String);
  const joined = list.join(' | ');
  const lower = joined.toLowerCase();
  const body = String(text ?? '');

  let arrangement = 'unknown';
  const wp = String(hints.workplaceType ?? '').toLowerCase();
  if (/remote/.test(wp) || hints.isRemote === true) arrangement = 'remote';
  else if (/hybrid/.test(wp)) arrangement = 'hybrid';
  else if (/on-?site|in-?office|in.person/.test(wp)) arrangement = 'onsite';
  if (arrangement === 'unknown') {
    if (/\bremote\b|\banywhere\b|\bwork from home\b/i.test(joined)) arrangement = 'remote';
    else if (/\bhybrid\b/i.test(joined)) arrangement = 'hybrid';
    else if (/\b(?:fully remote|100% remote|remote[- ]first|work from anywhere|this (?:role|position) is remote|remote position)\b/i.test(body)) arrangement = 'remote';
    else if (/\bhybrid\b/i.test(body)) arrangement = 'hybrid';
    else if (list.length && !/^\s*$/.test(joined)) arrangement = 'onsite';
  }

  const nl = NL_PLACES.some((p) => hasWord(lower, p));
  const brainport = BRAINPORT.some((p) => hasWord(lower, p));
  const europe = nl || EUROPE.some((p) => hasWord(lower, p));
  const outside = NON_EUROPE.some((p) => hasWord(lower, p));

  // Where can a remote role be done from? Only what the listing states counts.
  let remoteRegion = null;
  if (arrangement === 'remote') {
    const regionText = `${joined} ${hints.remoteRegionText ?? ''}`.toLowerCase();
    const bodyRegion = /\bremote\b[^.\n]{0,60}\b(?:netherlands|nederland|europe|european union|eu|emea|worldwide|anywhere|global(?:ly)?)\b|\b(?:from|within|in|based in|residing in)\s+(?:the\s+)?(netherlands|europe|the eu|emea)\b[^.\n]{0,40}\bremote\b/i.exec(body);
    if (/\bnetherlands|nederland\b/.test(regionText) || (nl && !outside)) remoteRegion = 'NL';
    else if (/\b(?:europe|european union|eu|eea|emea)\b/.test(regionText) || (europe && !outside)) remoteRegion = 'EU';
    else if (/\b(?:anywhere|worldwide|global)\b/.test(regionText)) remoteRegion = 'worldwide';
    else if (outside) remoteRegion = 'restricted_elsewhere';
    else if (bodyRegion) {
      const r = bodyRegion[0].toLowerCase();
      remoteRegion = /netherlands|nederland/.test(r) ? 'NL' : /europe|eu|emea/.test(r) ? 'EU' : 'worldwide';
    } else remoteRegion = 'unverified';
  }

  let region = 'unknown';
  if (nl) region = brainport ? 'brainport' : 'netherlands';
  else if (europe && !outside) region = 'europe';
  else if (outside && !europe) region = 'outside_europe';
  else if (europe && outside) region = 'multiple';

  return { text: joined, arrangement, region, isNetherlands: nl, isBrainport: brainport, remoteRegion };
}

// ---------------------------------------------------------------------------
// Work authorisation / residency statements (quoted from the listing, never inferred)

const AUTH_PATTERNS = [
  /\b(?:must|need to|should|required to)\s+(?:already\s+)?(?:have|hold|possess|be)\b[^.\n]{0,80}\b(?:work permit|right to work|work authori[sz]ation|eligible to work|authori[sz]ed to work|residence permit|EU (?:passport|citizenship)|citizen)\b/i,
  /\b(?:visa sponsorship|sponsor(?:ship)?)\b[^.\n]{0,60}\b(?:not|no|unable|cannot|can't|won't)\b/i,
  /\b(?:not|no|unable to|cannot|can't|do not|don't|won't)\b[^.\n]{0,40}\b(?:visa sponsorship|sponsor (?:a )?visas?|work permits?)\b/i,
  /\b(?:EU|EEA)\s+(?:citizens?|nationals?|passport holders?)\s+only\b/i,
  /\b(?:enrolled|registered|studying)\s+(?:at|in)\s+(?:a\s+)?(?:Dutch|Netherlands|European|EU)\s+(?:university|institution|higher education)/i,
  /\b(?:nationality|citizenship) of (?:an? )?(?:ESA|CERN|EU) member state/i,
  /\b(?:security clearance|export control(?:led)?|ITAR|EAR)\b/i,
];

export function extractRestrictions(text) {
  const s = String(text ?? '');
  const out = [];
  for (const re of AUTH_PATTERNS) {
    const m = re.exec(s);
    if (m) {
      const snippet = sentenceAround(s, m.index);
      if (snippet && !out.includes(snippet)) out.push(snippet);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Technical fields and skills

export function tagFields(title, text) {
  const t = String(title ?? '');
  const body = String(text ?? '').slice(0, 12000);
  const tags = [];
  const scores = {};
  for (const f of FIELDS) {
    let score = 0;
    for (const re of f.patterns) {
      if (re.test(t)) score += 3;
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      const hits = (body.match(g) ?? []).length;
      score += Math.min(hits, 3);
    }
    scores[f.id] = score;
    if (score >= 3) tags.push(f.id);
  }
  tags.sort((a, b) => scores[b] - scores[a]);
  return { tags, scores };
}

export function isComboRole(tags) {
  const cs = tags.some((t) => CS_FIELDS.includes(t));
  const other = tags.filter((t) => COMBO_FIELDS.includes(t));
  return (cs && other.length >= 1 && new Set([...tags.filter((t) => CS_FIELDS.includes(t)), ...other]).size >= 2) || other.length >= 2;
}

const NICE_RE = /\b(?:nice[- ]to[- ]haves?|preferred|bonus|a plus|pluses|would be (?:a )?(?:plus|nice|great)|desirable|ideally|pré)\b/i;

export function extractSkills(text) {
  const s = String(text ?? '');
  const niceIdx = s.search(NICE_RE);
  const required = [];
  const preferred = [];
  for (const [name, re] of SKILLS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let firstIdx = -1;
    for (const m of s.matchAll(g)) { firstIdx = m.index; break; }
    if (firstIdx < 0) continue;
    // Skills first mentioned after a "nice to have" marker count as preferred;
    // the marker's own sentence is also checked.
    const sentence = sentenceAround(s, firstIdx, 400);
    if ((niceIdx >= 0 && firstIdx > niceIdx) || NICE_RE.test(sentence)) preferred.push(name);
    else required.push(name);
  }
  return { required, preferred };
}
