// Lever Postings API (public, documented): https://github.com/lever/postings-api
import { isStudentRole } from '../../../site/shared/classify.js';
import { htmlToText } from '../../../site/shared/text.js';

const host = (source) => (source.region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co');

function toText(p) {
  const parts = [p.descriptionPlain ?? htmlToText(p.description ?? '')];
  for (const l of p.lists ?? []) parts.push(`${l.text}\n${htmlToText(l.content ?? '')}`);
  if (p.additionalPlain) parts.push(p.additionalPlain);
  return parts.filter(Boolean).join('\n\n');
}

export async function fetchListings(source, client) {
  const listings = [];
  let scanned = 0;
  const limit = 100;
  for (let skip = 0; skip < 2000; skip += limit) {
    const page = await client.getJson(`${host(source)}/v0/postings/${encodeURIComponent(source.token)}?mode=json&limit=${limit}&skip=${skip}`);
    if (!Array.isArray(page)) throw new Error('Unexpected Lever response: expected an array');
    scanned += page.length;
    for (const p of page) {
      if (!isStudentRole(p.text)) continue;
      const c = p.categories ?? {};
      const sal = p.salaryRange;
      listings.push({
        externalId: p.id,
        title: p.text,
        url: p.hostedUrl,
        applyUrl: p.applyUrl ?? p.hostedUrl,
        sourceUrl: `${host(source)}/v0/postings/${source.token}/${p.id}`,
        locations: [...new Set([c.location, ...(c.allLocations ?? [])].filter(Boolean))],
        descriptionText: toText(p),
        department: c.team ?? c.department ?? null,
        scheduleHint: c.commitment ?? null,
        workplaceType: p.workplaceType ?? null,
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        compensation: sal && (sal.min || sal.max) ? { min: sal.min ?? null, max: sal.max ?? null, currency: sal.currency ?? null, period: String(sal.interval ?? '').replace(/^per-/, '').replace(/-salary$/, '') || null } : null,
      });
    }
    if (page.length < limit) break;
  }
  return { listings, complete: true, scanned };
}

export async function recheck(source, client, externalId) {
  try {
    await client.getJson(`${host(source)}/v0/postings/${encodeURIComponent(source.token)}/${encodeURIComponent(externalId)}`);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    return null;
  }
}
