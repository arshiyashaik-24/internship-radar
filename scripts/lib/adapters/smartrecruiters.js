// SmartRecruiters Posting API (public, documented): https://developers.smartrecruiters.com/docs/posting-api
import { isStudentRole } from '../../../site/shared/classify.js';
import { htmlToText } from '../../../site/shared/text.js';

const base = (id) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings`;

export async function fetchListings(source, client, ctx = {}) {
  const found = new Map();
  let scanned = 0;
  let complete = true;
  for (const term of source.searchTerms ?? ['intern', 'internship', 'student', 'stage', 'trainee']) {
    for (let offset = 0; offset < 500; offset += 100) {
      const data = await client.getJson(`${base(source.token)}?q=${encodeURIComponent(term)}&limit=100&offset=${offset}`);
      if (!data || !Array.isArray(data.content)) throw new Error('Unexpected SmartRecruiters response: no "content" array');
      scanned += data.content.length;
      for (const p of data.content) if (isStudentRole(p.name)) found.set(p.id, p);
      if (offset + 100 >= (data.totalFound ?? 0)) break;
    }
  }
  const listings = [];
  let budget = source.maxDetails ?? 40;
  for (const [id, p] of found) {
    const key = `${source.id}:${id}`;
    const cached = ctx.cache?.get(key);
    if (cached?.text) { listings.push({ ...cached.raw, descriptionText: cached.text, fromCache: true }); continue; }
    if (budget-- <= 0) { complete = false; continue; }
    let d;
    try { d = await client.getJson(`${base(source.token)}/${encodeURIComponent(id)}`); } catch (err) { if (err.status !== 404) complete = false; continue; }
    const s = d?.jobAd?.sections ?? {};
    const text = ['jobDescription', 'qualifications', 'additionalInformation'].map((k) => htmlToText(s[k]?.text ?? '')).join('\n\n');
    const loc = d?.location ?? p.location ?? {};
    listings.push({
      externalId: id,
      title: d?.name ?? p.name,
      url: d?.postingUrl ?? `https://jobs.smartrecruiters.com/${source.token}/${id}`,
      applyUrl: d?.applyUrl ?? d?.postingUrl,
      sourceUrl: `${base(source.token)}/${id}`,
      locations: [loc.fullLocation ?? [loc.city, loc.country].filter(Boolean).join(', ')].filter(Boolean),
      descriptionText: text,
      scheduleHint: d?.typeOfEmployment?.label ?? null,
      workplaceType: loc.remote ? 'remote' : loc.hybrid ? 'hybrid' : null,
      postedAt: d?.releasedDate ?? p.releasedDate ?? null,
    });
  }
  return { listings, complete, scanned };
}

export async function recheck(source, client, externalId) {
  try {
    await client.getJson(`${base(source.token)}/${encodeURIComponent(externalId)}`);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    return null;
  }
}
