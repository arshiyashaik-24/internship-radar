// Page watcher for official vacancy pages that have no feed. It reads the public
// listing page (if robots.txt allows), follows links that match the configured
// pattern, and extracts each vacancy page's text. If the page layout changes and
// no links match, the source is reported as failing instead of silently showing nothing.
import { htmlToText, hash, decodeEntities, normaliseWhitespace } from '../../../site/shared/text.js';
import { isStudentRole } from '../../../site/shared/classify.js';

export function extractLinks(html, pageUrl, pattern) {
  const re = new RegExp(pattern, 'i');
  const out = new Map();
  for (const m of String(html).matchAll(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    let href;
    try { href = new URL(decodeEntities(m[2]), pageUrl).toString(); } catch { continue; }
    if (!re.test(href)) continue;
    const text = normaliseWhitespace(htmlToText(m[3]));
    const clean = href.split('#')[0];
    if (!out.has(clean) || (text && text.length > (out.get(clean) ?? '').length)) out.set(clean, text);
  }
  return [...out].map(([url, text]) => ({ url, text }));
}

function pageTitle(html) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) return normaliseWhitespace(htmlToText(h1[1]));
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return t ? normaliseWhitespace(htmlToText(t[1])).replace(/\s*[|–-]\s*[^|–-]+$/, '') : '';
}

function mainText(html) {
  const main = /<main[\s\S]*?<\/main>/i.exec(html) ?? /<article[\s\S]*?<\/article>/i.exec(html);
  return htmlToText(main ? main[0] : html.replace(/<(header|nav|footer)[\s\S]*?<\/\1>/gi, ' '));
}

export async function fetchListings(source, client, ctx = {}) {
  const pages = source.urls ?? [source.url];
  const links = new Map();
  for (const url of pages) {
    const html = await client.getText(url);
    for (const l of extractLinks(html, url, source.linkPattern)) if (!links.has(l.url)) links.set(l.url, l.text);
  }
  if (!links.size) {
    const err = new Error(`No vacancy links matched the pattern on ${pages.join(', ')} — the page layout may have changed, or the page loads its list with JavaScript.`);
    err.code = 'no_links';
    throw err;
  }
  const listings = [];
  let budget = source.maxDetails ?? 25;
  let complete = true;
  for (const [url, linkText] of links) {
    if (source.studentOnly !== false && linkText && !isStudentRole(linkText) && !isStudentRole(url.replace(/[-_/]/g, ' '))) continue;
    const externalId = hash(new URL(url).pathname);
    const id = `${source.id}:${externalId}`;
    const cached = ctx.cache?.get(id);
    if (cached?.text) { listings.push({ ...cached.raw, descriptionText: cached.text, fromCache: true }); continue; }
    if (budget-- <= 0) { complete = false; continue; }
    let html;
    try { html = await client.getText(url); } catch (err) { if (err.status !== 404 && err.status !== 410) complete = false; continue; }
    const title = pageTitle(html) || linkText;
    if (source.studentOnly !== false && !isStudentRole(title)) continue;
    listings.push({
      externalId,
      title,
      url,
      applyUrl: url,
      sourceUrl: url,
      locations: source.defaultLocation ? [source.defaultLocation] : [],
      descriptionText: mainText(html).slice(0, 20000),
    });
  }
  return { listings, complete, scanned: links.size };
}

export async function recheck(source, client, externalId, cached) {
  if (!cached?.raw?.url) return null;
  try {
    await client.getText(cached.raw.url);
    return true;
  } catch (err) {
    if (err.status === 404 || err.status === 410) return false;
    return null;
  }
}
