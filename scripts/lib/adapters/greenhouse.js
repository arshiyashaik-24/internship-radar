// Greenhouse Job Board API (public, documented): https://developers.greenhouse.io/job-board.html
import { isStudentRole } from '../../../site/shared/classify.js';

const base = (token) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`;

export async function fetchListings(source, client) {
  const url = `${base(source.token)}/jobs?content=true`;
  const data = await client.getJson(url);
  if (!data || !Array.isArray(data.jobs)) throw new Error('Unexpected Greenhouse response: no "jobs" array');
  const listings = [];
  for (const j of data.jobs) {
    if (!isStudentRole(j.title)) continue;
    // Offices often repeat the posting location ("Amsterdam, Netherlands"); keep only new places.
    const primary = j.location?.name ?? '';
    const offices = (j.offices ?? []).map((o) => o.location || o.name).filter((o) => o && !primary.toLowerCase().includes(String(o).split(',')[0].trim().toLowerCase()));
    const locations = [primary, ...offices].filter(Boolean);
    listings.push({
      externalId: j.id,
      title: j.title,
      url: j.absolute_url,
      applyUrl: j.absolute_url,
      sourceUrl: `${base(source.token)}/jobs/${j.id}`,
      locations: [...new Set(locations)],
      descriptionHtml: j.content ?? '',
      department: j.departments?.[0]?.name ?? null,
      postedAt: j.first_published ?? null,
      updatedAt: j.updated_at ?? null,
    });
  }
  return { listings, complete: true, scanned: data.jobs.length };
}

export async function recheck(source, client, externalId) {
  try {
    await client.getJson(`${base(source.token)}/jobs/${encodeURIComponent(externalId)}`);
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    return null;
  }
}
