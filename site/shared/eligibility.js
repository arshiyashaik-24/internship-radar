// Rule-based eligibility assessment against the published requirements only.
// It never infers work rights, and it never upgrades a role to "eligible" when the
// text names a degree level or study year the student does not have.

import { sentenceAround } from './text.js';

const ORDINALS = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 };
const US_YEARS = { freshman: 1, sophomore: 2, junior: 3, senior: 4 };

const BACHELOR_RE = /\b(?:bachelor(?:'s|s)?|bsc|b\.sc\.?|b\.s\.|undergraduate|undergrad|hbo|wo[- ]bachelor|university students?)\b/i;
const MASTER_RE = /\b(?:master(?:'s|s)?(?! (?:data|class|plan))|msc|m\.sc\.?|m\.s\.)\b/i;
const PHD_RE = /\b(?:ph\.?\s?d\.?|doctoral|doctorate)\b/i;
const STUDENT_RE = /\b(?:students?|studying|enrolled|currently pursuing|student status|studerend|ingeschreven)\b/i;
const NOT_REQUIRED_RE = /\b(?:preferred|a plus|nice to have|bonus|advantage|ideally|desirable|or equivalent experience)\b/i;

function requiredMention(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let any = false;
  for (const m of text.matchAll(g)) {
    any = true;
    const sentence = sentenceAround(text, m.index, 400);
    if (!NOT_REQUIRED_RE.test(sentence)) return { required: true, mentioned: true, snippet: sentence };
  }
  return { required: false, mentioned: any };
}

// Which academic year will the student be in when the role starts?
export function studyYearAt(profile, startISO) {
  const base = Number(profile.studyYear) || 1;
  const academicStart = Number(profile.academicYearStart) || 2026; // Sep of this year starts studyYear
  if (!startISO) return { during: base, completed: base - 1 };
  const y = Number(startISO.slice(0, 4));
  const m = Number(startISO.slice(5, 7));
  const academicYear = m >= 9 ? y : y - 1;
  const during = base + (academicYear - academicStart);
  const summer = m >= 6 && m <= 8;
  return { during, completed: summer ? during : during - 1 };
}

export function assessEligibility({ title = '', text = '', type = 'other', startDate = null }, profile) {
  const t = String(title);
  const body = `${t}\n${text ?? ''}`;
  const reasons = [];
  const req = { degreeLevels: [], graduationYears: [], minStudyYear: null, minCompletedYears: null, finalYearOnly: false, experienceYears: null };
  const level = String(profile?.degreeLevel ?? 'bachelor').toLowerCase();
  const gradYear = Number(profile?.expectedGraduationYear) || null;
  const yr = studyYearAt(profile ?? {}, startDate?.date ?? null);

  // ---- Degree level ------------------------------------------------------
  const bachelor = requiredMention(body, BACHELOR_RE);
  const master = requiredMention(body, MASTER_RE);
  const phd = requiredMention(body, PHD_RE);
  if (bachelor.required || bachelor.mentioned) req.degreeLevels.push('bachelor');
  if (master.required) req.degreeLevels.push('master');
  if (phd.required) req.degreeLevels.push('phd');

  let label = 'unknown';
  if (PHD_RE.test(t) && !/\b(?:bachelor|undergrad|master|msc)\b/i.test(t)) {
    label = 'ineligible';
    reasons.push('The title says the role is for PhD students.');
  } else if (/\b(?:pursuing|enrolled in|studying|candidates? for)\s+(?:a\s+)?(?:ph\.?d|doctoral)/i.test(body) && !bachelor.mentioned && !master.required) {
    label = 'ineligible';
    reasons.push(`Requires current PhD enrolment: "${phd.snippet ?? ''}"`);
  } else if (master.required && !bachelor.mentioned) {
    label = 'ineligible';
    reasons.push(`Asks for Master's-level students: "${master.snippet}"`);
  } else if (/\b(?:have (?:completed|obtained|finished)|hold(?:ing)?|holds) (?:a |your )?(?:bachelor|bsc|b\.sc)/i.test(body)) {
    label = 'future';
    reasons.push('Requires a completed Bachelor’s degree.');
  } else if (type === 'thesis' && !bachelor.mentioned) {
    label = 'future';
    reasons.push('Graduation/thesis projects are normally for final-year students; the listing does not mention Bachelor’s students.');
  } else if (bachelor.mentioned) {
    label = level === 'bachelor' ? 'eligible' : 'potential';
    reasons.push(bachelor.snippet ? `Mentions Bachelor’s students: "${bachelor.snippet}"` : 'Mentions Bachelor’s students.');
  } else if (STUDENT_RE.test(body)) {
    label = 'potential';
    reasons.push('Open to students, but no degree level is stated.');
  } else {
    reasons.push('The listing does not state degree-level requirements.');
  }

  // ---- Study year / graduation year --------------------------------------
  let yearBlock = null; // 'future' | 'ineligible'
  const gradRe = /\b(?:graduat\w*|class of|completing (?:your|their) (?:degree|studies))\s+(?:date\s+)?(?:in|between|by|from|of|before|after)?\s*(?:(?:december|may|june|july|august|spring|summer|fall|autumn|winter|january)\s+)?(20\d\d)(?:\s*(?:-|–|and|or|to|through)\s*(?:(?:december|may|june|july|august|spring|summer|fall|autumn|winter|january)\s+)?(20\d\d))?/gi;
  for (const m of body.matchAll(gradRe)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let y = Math.min(a, b); y <= Math.max(a, b); y++) if (!req.graduationYears.includes(y)) req.graduationYears.push(y);
  }
  if (req.graduationYears.length && gradYear) {
    const ys = req.graduationYears;
    if (ys.includes(gradYear)) reasons.push(`Graduation year ${gradYear} is within the stated range (${ys.join(', ')}).`);
    else if (Math.max(...ys) < gradYear) { yearBlock = 'future'; reasons.push(`For students graduating in ${ys.join('/')}; expected graduation is ${gradYear}.`); }
    else if (Math.min(...ys) > gradYear) { yearBlock = 'ineligible'; reasons.push(`For students graduating in ${ys.join('/')}, after the expected graduation in ${gradYear}.`); }
  }

  const yearRe = /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?:[- ]|\s+or\s+\w+[- ])year\s+(?:of\s+)?(?:(?:bachelor(?:'s)?|bsc|undergraduate|university|engineering)\s+)?(?:students?|of (?:your|their) stud)/gi;
  const years = [...body.matchAll(yearRe)].map((m) => ORDINALS[m[1].toLowerCase()]).filter(Boolean);
  if (years.length) {
    const min = Math.min(...years);
    req.minStudyYear = min;
    if (min > yr.during) { yearBlock ??= 'future'; reasons.push(`Asks for year ${min}+ students; you will be in year ${yr.during} when it starts.`); }
    else if (min <= 1) reasons.push('Explicitly open to first-year students.');
  }
  const rising = /\brising\s+(freshm[ae]n|sophomores?|juniors?|seniors?)\b/i.exec(body);
  if (rising) {
    const need = US_YEARS[rising[1].toLowerCase().replace(/s$/, '').replace('freshmen', 'freshman')] ?? null;
    if (need) {
      req.minStudyYear = Math.max(req.minStudyYear ?? 0, need);
      // A "rising sophomore" has completed year 1.
      if (need - 1 > yr.completed) { yearBlock ??= 'future'; reasons.push(`For rising ${rising[1]} (needs ${need - 1} completed year(s)); you will have completed ${yr.completed}.`); }
    }
  }
  const semesters = /\b(?:at least|minimum(?: of)?|completed)\s+(\d{1,2}|two|three|four|five|six|seven|eight)\s+semesters?\b/i.exec(body);
  const yearsStudy = /\b(?:at least|minimum(?: of)?|completed)\s+(\d|two|three|four)\s+years?\s+(?:of\s+)?(?:full[- ]time\s+)?(?:university|undergraduate|study|studies|bachelor)/i.exec(body);
  const words = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const num = (x) => Number(x) || words[String(x).toLowerCase()] || null;
  if (semesters || yearsStudy) {
    const need = semesters ? num(semesters[1]) / 2 : num(yearsStudy[1]);
    req.minCompletedYears = need;
    if (need > yr.completed) { yearBlock ??= 'future'; reasons.push(`Requires ${need} completed year(s) of study; you will have completed ${yr.completed} by the start.`); }
  }
  if (/\b(?:final[- ]year|last[- ]year|penultimate[- ]year|graduating (?:students?|this year)|in (?:the|your) final year)\b/i.test(body)) {
    req.finalYearOnly = true;
    if (!years.includes(1)) { yearBlock ??= 'future'; reasons.push('Aimed at final-year or penultimate-year students.'); }
  }

  const exp = /\b(\d{1,2})\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+|work\s+|hands-on\s+)?(?:work\s+)?experience\b/i.exec(body);
  if (exp) {
    req.experienceYears = Number(exp[1]);
    if (req.experienceYears >= 1) reasons.push(`Mentions ${req.experienceYears}+ years of experience: "${sentenceAround(body, exp.index)}"`);
  }

  if (yearBlock && label !== 'ineligible') label = yearBlock;
  if (label === 'eligible' && req.experienceYears >= 1) label = 'potential';

  let firstYearEligible = 'unclear';
  if (label === 'eligible' && (years.includes(1) || (!req.minStudyYear && !req.minCompletedYears && !req.finalYearOnly && !req.graduationYears.length))) firstYearEligible = 'yes';
  else if (label === 'future' || label === 'ineligible') firstYearEligible = 'no';

  return { label, reasons, requirements: req, firstYearEligible };
}
