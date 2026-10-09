// Text helpers shared by the ingestion script (Node) and the dashboard (browser).
// No dependencies, so the same file runs in both places.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', euro: '€', pound: '£', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  bull: '•', middot: '·', eacute: 'é', egrave: 'è', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü',
};

export function decodeEntities(str) {
  if (!str) return '';
  return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

// Converts job-description HTML into readable plain text that keeps paragraph
// and list structure, so section headings ("Requirements", "Nice to have") survive.
export function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  // Some APIs (Greenhouse) return HTML that is itself entity-encoded.
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|ul|ol|tr|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normaliseWhitespace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

// Short neutral summary: the first sentences of the description, cut at a word boundary.
export function summarise(text, max = 320) {
  const clean = normaliseWhitespace(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > max * 0.5) return cut.slice(0, lastStop + 1);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

// Returns the sentence (or bullet) around a regex match, for evidence snippets.
export function sentenceAround(text, index, maxLen = 220) {
  if (index < 0) return '';
  const before = text.lastIndexOf('\n', index);
  const dotBefore = text.lastIndexOf('. ', index);
  const start = Math.max(before, dotBefore >= 0 ? dotBefore + 1 : -1, 0);
  const nl = text.indexOf('\n', index);
  const dot = text.indexOf('. ', index);
  const ends = [nl, dot >= 0 ? dot + 1 : -1, text.length].filter((n) => n >= 0);
  const end = Math.min(...ends);
  let snippet = normaliseWhitespace(text.slice(start, end)).replace(/^[•\-–]\s*/, '');
  if (snippet.length > maxLen) snippet = snippet.slice(0, maxLen - 1) + '…';
  return snippet;
}

// Stable 32-bit FNV-1a hash rendered as hex. Used for duplicate fingerprints;
// not a security feature.
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
