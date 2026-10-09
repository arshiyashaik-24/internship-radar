// Recruitee public careers-site API: https://docs.recruitee.com/reference/offers
import { isStudentRole } from '../../../site/shared/classify.js';
import { htmlToText } from '../../../site/shared/text.js';

export async function fetchListings(source, client) {
  const url = `https://${encodeURIComponent(source.token)}.recruitee.com/api/offers/`;
  const data = await client.getJson(url);
  if (!data || !Array.isArray(data.offers)) throw new Error('Unexpected Recruitee response: no "offers" array');
  const listings = [];
  for (const o of data.offers) {
    if (!isStudentRole(o.title)) continue;
    const workplace = o.remote ? 'remote' : o.hybrid ? 'hybrid' : o.on_site ? 'onsite' : null;
    const hoursLine = o.min_hours || o.max_hours ? `\n${o.min_hours ?? o.max_hours}-${o.max_hours ?? o.min_hours} hours per week` : '';
    listings.push({
      externalId: o.id,
      title: o.title,
      url: o.careers_url,
      applyUrl: o.careers_apply_url ?? o.careers_url,
      sourceUrl: url,
      locations: [o.location, [o.city, o.country].filter(Boolean).join(', ')].filter(Boolean),
      descriptionText: `${htmlToText(o.description ?? '')}\n\n${htmlToText(o.requirements ?? '')}${hoursLine}`,
      department: o.department ?? null,
      scheduleHint: o.employment_type_code ?? null,
      workplaceType: workplace,
      postedAt: o.published_at ?? null,
      closeAt: o.close_at ?? null,
      compensation: o.salary && (o.salary.min || o.salary.max) ? { min: Number(o.salary.min) || null, max: Number(o.salary.max) || null, currency: o.salary.currency ?? null, period: o.salary.period ?? null } : null,
    });
  }
  return { listings, complete: true, scanned: data.offers.length };
}
