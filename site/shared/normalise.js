// Turns a raw listing from any adapter into one normalised opportunity record.

import { htmlToText, summarise, hash, normaliseWhitespace } from './text.js';
import { extractDeadline, extractOpening, extractStart, todayISO } from './dates.js';
import {
  employmentType, extractHours, workSchedule, extractDuration, extractCompensation,
  analyseLocation, extractRestrictions, tagFields, extractSkills,
} from './classify.js';
import { assessEligibility } from './eligibility.js';
import { scoreOpportunity, trackOf } from './match.js';

export function fingerprint(employer, title, locationText) {
  const norm = (s) => normaliseWhitespace(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(?:the|and|of|in|for|bv|b v|nv)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return hash(`${norm(employer)}|${norm(title)}|${norm(locationText)}`);
}

export function normalise(raw, source, { now = new Date(), prefs } = {}) {
  const ref = todayISO(now);
  const text = raw.descriptionText ? String(raw.descriptionText) : htmlToText(raw.descriptionHtml ?? '');
  const title = normaliseWhitespace(raw.title);
  const type = employmentType(title, text);
  const hours = extractHours(text);
  const schedule = workSchedule(raw.scheduleHint, text, hours);
  const location = analyseLocation(raw.locations ?? [], text, { workplaceType: raw.workplaceType, isRemote: raw.isRemote });

  let deadline = null;
  if (raw.closeAt) deadline = { date: String(raw.closeAt).slice(0, 10), precision: 'day', evidence: 'Closing date published by the application system', from: 'structured' };
  else {
    const d = extractDeadline(text, ref);
    if (d) deadline = { ...d, from: 'text' };
  }
  const openingText = extractOpening(text, ref);
  const startDate = raw.startDate
    ? { date: String(raw.startDate).slice(0, 10), precision: 'day', evidence: 'Start date published by the application system' }
    : extractStart(title, text, ref);

  const eligibility = assessEligibility({ title, text, type, startDate }, prefs?.profile ?? {});
  const fieldInfo = tagFields(title, text);

  const opp = {
    id: `${source.id}:${raw.externalId}`,
    sourceId: source.id,
    externalId: String(raw.externalId),
    employer: source.employer,
    programme: raw.programme ?? null,
    title,
    url: raw.url,
    applyUrl: raw.applyUrl ?? raw.url,
    sourceUrl: raw.sourceUrl ?? source.publicUrl ?? null,
    department: raw.department ?? null,
    summary: summarise(text),
    type,
    schedule,
    hours,
    duration: extractDuration(text),
    fields: fieldInfo.tags,
    skills: extractSkills(text),
    location,
    restrictions: extractRestrictions(text),
    compensation: extractCompensation(text, raw.compensation),
    postedAt: raw.postedAt ? String(raw.postedAt).slice(0, 10) : null,
    openingDate: openingText ? { ...openingText, from: 'text' } : raw.postedAt ? { date: String(raw.postedAt).slice(0, 10), precision: 'day', evidence: 'Publication date in the application system', from: 'structured' } : null,
    deadline,
    startDate: startDate ?? null,
    eligibility,
    sourceTier: source.tier ?? 1,
    fingerprint: fingerprint(source.employer, title, location.text),
    textLength: text.length,
  };
  opp.track = trackOf(opp);
  if (prefs) opp.match = scoreOpportunity(opp, prefs);
  return { opp, text };
}

// Derived listing status. A listing that the source no longer returns is only
// marked closed by the merge step after a confirming recheck.
export function liveStatus(opp, refISO) {
  if (opp.closedAt) return 'closed';
  if (opp.deadline?.date && opp.deadline.precision === 'day' && opp.deadline.date < refISO) return 'deadline_passed';
  if (opp.openingDate?.date && opp.openingDate.from === 'text' && opp.openingDate.date > refISO) return 'opening_soon';
  return 'open';
}
