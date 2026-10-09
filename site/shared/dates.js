// Date parsing for job descriptions in English and Dutch.
// All parsed dates are returned as { date: 'YYYY-MM-DD', precision: 'day' | 'month' | 'season' }.
// Numeric dates are read in European order (day first), because the sources are
// mostly European; ISO dates (2026-11-15) are always unambiguous.

const MONTHS = {
  january: 1, jan: 1, januari: 1,
  february: 2, feb: 2, februari: 2,
  march: 3, mar: 3, maart: 3, mrt: 3,
  april: 4, apr: 4,
  may: 5, mei: 5,
  june: 6, jun: 6, juni: 6,
  july: 7, jul: 7, juli: 7,
  august: 8, aug: 8, augustus: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const pad = (n) => String(n).padStart(2, '0');

export function isValidDate(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toISO(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromISO, toISOStr) {
  const a = Date.parse(fromISO.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(toISOStr.slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// When a date is written without a year ("apply before 15 November"), pick the
// first occurrence that is not long in the past relative to the reference date.
function inferYear(m, d, refISO) {
  if (!refISO) return null;
  const refYear = Number(refISO.slice(0, 4));
  for (const y of [refYear, refYear + 1]) {
    if (isValidDate(y, m, d) && daysBetween(refISO, toISO(y, m, d)) >= -14) return y;
  }
  return null;
}

// Finds every date mention in a string, in order of appearance.
export function findDates(str, refISO) {
  if (!str) return [];
  const s = String(str);
  const found = [];
  const push = (index, length, value) => found.push({ index, length, ...value });

  // 2026-11-15
  for (const m of s.matchAll(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (isValidDate(y, mo, d)) push(m.index, m[0].length, { date: toISO(y, mo, d), precision: 'day' });
  }
  // 15-11-2026, 15/11/2026, 15.11.2026 (European order)
  for (const m of s.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d\d)\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (isValidDate(y, mo, d)) push(m.index, m[0].length, { date: toISO(y, mo, d), precision: 'day' });
  }
  // 15 November 2026, 15th of Nov 2026, 15 november (no year)
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_RE})\\.?(?:,?\\s+(20\\d\\d))?\\b`, 'gi');
  for (const m of s.matchAll(dmy)) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2].toLowerCase()];
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, refISO);
    if (y && isValidDate(y, mo, d)) push(m.index, m[0].length, { date: toISO(y, mo, d), precision: 'day' });
  }
  // November 15, 2026 / Nov 15th 2026 / November 15
  const mdy = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d\\d))?\\b`, 'gi');
  for (const m of s.matchAll(mdy)) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, refISO);
    if (y && isValidDate(y, mo, d)) push(m.index, m[0].length, { date: toISO(y, mo, d), precision: 'day' });
  }
  // November 2026 (month precision)
  const my = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(20\\d\\d)\\b`, 'gi');
  for (const m of s.matchAll(my)) {
    const mo = MONTHS[m[1].toLowerCase()];
    push(m.index, m[0].length, { date: toISO(Number(m[2]), mo, 1), precision: 'month' });
  }
  // Summer 2027 / zomer 2027 (season precision; summer is read as 1 July)
  for (const m of s.matchAll(/\b(summer|zomer|spring|voorjaar|autumn|fall|najaar|winter)\s+(?:of\s+)?(20\d\d)\b/gi)) {
    const season = m[1].toLowerCase();
    const month = { summer: 7, zomer: 7, spring: 4, voorjaar: 4, autumn: 10, fall: 10, najaar: 10, winter: 1 }[season];
    push(m.index, m[0].length, { date: toISO(Number(m[2]), month, 1), precision: 'season', season });
  }

  // Remove matches that sit inside a longer match (e.g. "November 2026" inside "15 November 2026").
  found.sort((a, b) => a.index - b.index || b.length - a.length);
  const result = [];
  let coveredUntil = -1;
  for (const f of found) {
    if (f.index < coveredUntil) continue;
    result.push(f);
    coveredUntil = f.index + f.length;
  }
  return result;
}

export function parseDate(str, refISO) {
  const all = findDates(str, refISO);
  if (!all.length) return null;
  const { date, precision, season } = all[0];
  return season ? { date, precision, season } : { date, precision };
}

// Looks for a date shortly after one of the keyword phrases.
function dateAfterKeyword(text, keywordRe, refISO, windowLen = 90) {
  if (!text) return null;
  for (const m of text.matchAll(keywordRe)) {
    const windowText = text.slice(m.index + m[0].length, m.index + m[0].length + windowLen);
    const firstBreak = windowText.search(/\n\n/);
    const scoped = firstBreak >= 0 ? windowText.slice(0, firstBreak) : windowText;
    const d = parseDate(scoped, refISO);
    if (d) return { ...d, evidence: (m[0] + scoped).replace(/\s+/g, ' ').trim().slice(0, 160) };
  }
  return null;
}

const DEADLINE_RE = /\b(?:application\s+deadline|deadline(?:\s+for\s+applications?)?|apply\s+(?:before|by|no\s+later\s+than)|applications?\s+(?:will\s+)?(?:close|closes|closing|are\s+due|must\s+be\s+(?:received|submitted)\s+by)(?:\s+on)?|closing\s+date|sluitingsdatum|reageren\s+(?:kan\s+)?(?:tot|uiterlijk)|solliciteren\s+(?:kan\s+)?(?:tot|uiterlijk)|uiterlijk)\b[:\s]*/gi;
const OPENING_RE = /\b(?:applications?\s+(?:will\s+)?(?:open|opens|opening)(?:\s+on|\s+from)?|application\s+(?:period|window)\s+(?:opens|starts|runs\s+from)|opening\s+date)\b[:\s]*/gi;
const START_RE = /\b(?:start(?:ing)?\s+(?:date|in|on|from|as\s+of)|(?:you\s+)?(?:can\s+|will\s+)?start\s+(?:in|on|from)|begin(?:s|ning)?\s+(?:in|on)|startdatum|start\s+per|available\s+from|beschikbaar\s+(?:vanaf|per))\b[:\s]*/gi;

export function extractDeadline(text, refISO) {
  return dateAfterKeyword(text, DEADLINE_RE, refISO);
}

export function extractOpening(text, refISO) {
  return dateAfterKeyword(text, OPENING_RE, refISO);
}

// Start date: an explicit "start date" phrase wins; otherwise a season ("Summer 2027")
// mentioned in the title or text.
export function extractStart(title, text, refISO) {
  const explicit = dateAfterKeyword(text, START_RE, refISO, 60);
  if (explicit) return explicit;
  const asap = /\bstart(?:ing)?(?:\s+date)?\s*[:\-]?\s*(?:as soon as possible|asap|immediately|z\.?s\.?m\.?|zo snel mogelijk|per direct)\b/i.exec(text ?? '');
  if (asap) return { date: refISO ?? null, precision: 'asap', evidence: asap[0] };
  const seasonal = findDates(`${title ?? ''}\n${text ?? ''}`, refISO).find((d) => d.precision === 'season');
  if (seasonal) return { date: seasonal.date, precision: 'season', season: seasonal.season, evidence: `mentions ${seasonal.season} ${seasonal.date.slice(0, 4)}` };
  const yearOnly = /\b(20\d\d)\s+(?:start|intake|internship|summer)\b|\((20\d\d)\s+start\)/i.exec(title ?? '');
  if (yearOnly) {
    const y = yearOnly[1] || yearOnly[2];
    return { date: `${y}-01-01`, precision: 'year', evidence: `title mentions ${y} start` };
  }
  return null;
}

// Formats a parsed date for display, honouring its precision.
export function formatDate(iso, precision = 'day', locale = 'en-GB') {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  if (precision === 'asap') return 'As soon as possible';
  if (precision === 'year') return String(d.getUTCFullYear());
  if (precision === 'season') {
    const m = d.getUTCMonth() + 1;
    const name = m >= 6 && m <= 8 ? 'Summer' : m >= 3 && m <= 5 ? 'Spring' : m >= 9 && m <= 11 ? 'Autumn' : 'Winter';
    return `${name} ${d.getUTCFullYear()}`;
  }
  if (precision === 'month') return d.toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
