// Ashby public job board API (documented): https://developers.ashbyhq.com/docs/public-job-posting-api
import { isStudentRole } from '../../../site/shared/classify.js';

export async function fetchListings(source, client) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.token)}?includeCompensation=true`;
  const data = await client.getJson(url);
  if (!data || !Array.isArray(data.jobs)) throw new Error('Unexpected Ashby response: no "jobs" array');
  const listings = [];
  for (const j of data.jobs) {
    if (j.isListed === false || !isStudentRole(j.title)) continue;
    const comp = (j.compensation?.summaryComponents ?? []).find((c) => /salary|hourly|stipend/i.test(c.compensationType ?? ''));
    listings.push({
      externalId: j.id,
      title: j.title,
      url: j.jobUrl,
      applyUrl: j.applyUrl ?? j.jobUrl,
      sourceUrl: url,
      locations: [j.location, ...(j.secondaryLocations ?? []).map((l) => l.location)].filter(Boolean),
      descriptionHtml: j.descriptionHtml ?? '',
      descriptionText: j.descriptionPlain ?? undefined,
      department: j.department ?? j.team ?? null,
      scheduleHint: j.employmentType ?? null,
      workplaceType: j.workplaceType ?? null,
      isRemote: j.isRemote ?? null,
      postedAt: j.publishedAt ?? null,
      compensation: comp ? { min: comp.minValue ?? null, max: comp.maxValue ?? null, currency: comp.currencyCode ?? null, period: String(comp.interval ?? '').replace(/^1\s*/, '').toLowerCase() || null, summary: j.compensation?.compensationTierSummary ?? null } : null,
    });
  }
  return { listings, complete: true, scanned: data.jobs.length };
}
