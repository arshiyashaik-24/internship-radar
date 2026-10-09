// Workday career sites. Uses the JSON search endpoint that the public career site
// itself calls (/wday/cxs/...). Response shapes verified against NXP's live site on
// 9 Oct 2026. Searches only for student keywords, narrows to the configured
// countries using the site's own country filter when it has one, and reuses cached
// details so unchanged postings are not refetched. robots.txt is checked for every
// request by the HTTP client.
import { isStudentRole } from '../../../site/shared/classify.js';
import { htmlToText } from '../../../site/shared/text.js';

const DEFAULT_TERMS = ['intern', 'internship', 'student', 'stage', 'werkstudent', 'thesis', 'graduation', 'trainee'];
const STUDENT_TEXT_RE = /\b(?:intern(?:ship)?|stage|stagiair|graduation (?:project|assignment|internship)|thesis|afstudeer\w*|working student|werkstudent|student assistant)\b/i;

function endpoints(source) {
  const origin = `https://${source.host}`;
  return {
    search: `${origin}/wday/cxs/${source.tenant}/${source.site}/jobs`,
    detail: (path) => `${origin}/wday/cxs/${source.tenant}/${source.site}${path}`,
    public: (path) => `${origin}/${source.site}${path}`,
  };
}

// Finds facet values (e.g. Location_Country = Netherlands) anywhere in the facet tree.
export function findCountryFacets(facets, countries) {
  const wanted = countries.map((c) => c.toLowerCase());
  const applied = {};
  // Tenants name this differently: NXP uses "Location_Country"; Philips nests a
  // "Country/Region" group with parameter "locationHierarchy1".
  const walk = (list, param, groupLabel) => {
    for (const f of list ?? []) {
      const p = f.facetParameter ?? param;
      if (Array.isArray(f.values)) walk(f.values, p, f.descriptor ?? groupLabel);
      else if (f.id && wanted.includes(String(f.descriptor ?? '').toLowerCase()) && (/country/i.test(p ?? '') || /country/i.test(groupLabel ?? ''))) {
        (applied[p] ??= []).push(f.id);
      }
    }
  };
  walk(facets, null, null);
  if (Object.keys(applied).length) return applied;

  // Thermo Fisher has no country filter, only cities written as "Eindhoven, Netherlands".
  const cityRes = wanted.map((c) => new RegExp(`(?:^|,\\s*)${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
  const walkCities = (list, param) => {
    for (const f of list ?? []) {
      const p = f.facetParameter ?? param;
      if (Array.isArray(f.values)) walkCities(f.values, p);
      else if (f.id && /location/i.test(p ?? '') && cityRes.some((re) => re.test(String(f.descriptor ?? '')))) (applied[p] ??= []).push(f.id);
    }
  };
  walkCities(facets, null);
  return Object.keys(applied).length ? applied : null;
}

function locationWanted(source, locationsText) {
  if (!source.locationKeywords?.length) return true;
  const t = String(locationsText ?? '').toLowerCase();
  if (/\d+\s+locations?/.test(t)) return true; // "3 Locations": resolved from the detail page
  return source.locationKeywords.some((k) => t.includes(k.toLowerCase()));
}

export async function fetchListings(source, client, ctx = {}) {
  const ep = endpoints(source);
  const seen = new Map();
  let scanned = 0;
  let complete = true;
  const terms = source.searchTerms ?? DEFAULT_TERMS;

  let appliedFacets = {};
  if (source.countries?.length) {
    const probe = await client.postJson(ep.search, { appliedFacets: {}, limit: 1, offset: 0, searchText: terms[0] });
    const f = findCountryFacets(probe?.facets, source.countries);
    if (f) appliedFacets = f;
    else ctx.log?.(`  ${source.id}: no country filter found for ${source.countries.join(', ')}; using location keywords instead`);
  }
  const facetFiltered = Object.keys(appliedFacets).length > 0;

  for (const term of terms) {
    for (let offset = 0, page = 0; ; offset += 20, page++) {
      if (page >= (source.maxPages ?? 6)) { complete = false; break; }
      const data = await client.postJson(ep.search, { appliedFacets, limit: 20, offset, searchText: term });
      if (!data || !Array.isArray(data.jobPostings)) throw new Error('Unexpected Workday response: no "jobPostings" array');
      scanned += data.jobPostings.length;
      for (const p of data.jobPostings) {
        if (!p.externalPath || seen.has(p.externalPath)) continue;
        if (!facetFiltered && !locationWanted(source, p.locationsText)) continue;
        // With a country filter the result set is small, so titles without a student
        // keyword are checked against their description instead of being dropped.
        if (!isStudentRole(p.title) && !facetFiltered) continue;
        seen.set(p.externalPath, p);
      }
      if (offset + 20 >= (data.total ?? 0) || !data.jobPostings.length) break;
    }
  }

  const listings = [];
  let detailBudget = source.maxDetails ?? 50;
  for (const [path, p] of seen) {
    const externalId = String(p.bulletFields?.[0] ?? path);
    const id = `${source.id}:${externalId}`;
    const cached = ctx.cache?.get(id);
    if (cached?.text && cached.workdayPath === path) {
      listings.push({ ...cached.raw, descriptionText: cached.text, fromCache: true });
      continue;
    }
    if (detailBudget <= 0) { complete = false; continue; }
    detailBudget--;
    let d;
    try {
      d = await client.getJson(ep.detail(path));
    } catch (err) {
      // One broken posting should not sink the whole source.
      if (err.status !== 404 && err.status !== 410) complete = false;
      continue;
    }
    const info = d?.jobPostingInfo;
    if (!info) continue;
    const title = info.title ?? p.title;
    if (!isStudentRole(title) && !STUDENT_TEXT_RE.test(htmlToText(info.jobDescription ?? '').slice(0, 700))) continue;
    const country = info.country?.descriptor ?? null;
    // Belt and braces: if the country filter was ignored, the detail page still says where the job is.
    if (source.countries?.length && country && !source.countries.some((c) => c.toLowerCase() === country.toLowerCase()) && !/remote/i.test(`${info.location} ${info.remoteType ?? ''}`)) continue;
    const locations = [...new Set([info.location, ...(info.additionalLocations ?? []), p.locationsText].filter(Boolean).map((l) => (country && !l.includes(country) ? `${l}, ${country}` : l)))];
    if (!facetFiltered && !locationWanted(source, locations.join(' '))) continue;
    listings.push({
      externalId,
      title,
      url: info.externalUrl ?? ep.public(path),
      applyUrl: info.externalUrl ?? ep.public(path),
      sourceUrl: ep.detail(path),
      locations,
      descriptionHtml: info.jobDescription ?? '',
      scheduleHint: info.timeType ?? null,
      workplaceType: info.remoteType ?? null,
      postedAt: info.startDate ?? null, // Workday's "startDate" is the posting's publication date
      closeAt: info.endDate ?? null,
      workdayPath: path,
    });
  }
  return { listings, complete, scanned };
}

export async function recheck(source, client, externalId, cached) {
  if (!cached?.workdayPath) return null;
  try {
    const d = await client.getJson(endpoints(source).detail(cached.workdayPath));
    return Boolean(d?.jobPostingInfo) && d.jobPostingInfo.canApply !== false;
  } catch (err) {
    if (err.status === 404 || err.status === 410) return false;
    return null;
  }
}
