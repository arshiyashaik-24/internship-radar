import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessEligibility, studyYearAt } from '../site/shared/eligibility.js';
import { scoreOpportunity, locationFit, trackOf } from '../site/shared/match.js';
import { readFile } from 'node:fs/promises';

const prefs = JSON.parse(await readFile(new URL('../config/preferences.json', import.meta.url), 'utf8'));
const profile = prefs.profile;
const summer = { date: '2027-07-01', precision: 'season', season: 'summer' };

test('study year at the start of a role', () => {
  assert.deepEqual(studyYearAt(profile, '2027-07-01'), { during: 1, completed: 1 });
  assert.deepEqual(studyYearAt(profile, '2027-10-01'), { during: 2, completed: 1 });
});

test('Bachelor-friendly listing is eligible; first year is allowed', () => {
  const r = assessEligibility({ title: 'Quantitative Research Intern', text: "Open to first-year Bachelor's students in mathematics.", startDate: summer }, profile);
  assert.equal(r.label, 'eligible');
  assert.equal(r.firstYearEligible, 'yes');
});

test("Master's-only and PhD-only roles are never eligible", () => {
  assert.equal(assessEligibility({ title: 'Software Intern', text: "You are currently enrolled in a Master's programme in CS." }, profile).label, 'ineligible');
  assert.equal(assessEligibility({ title: 'PhD Research Intern', text: 'Machine learning research.' }, profile).label, 'ineligible');
  assert.equal(assessEligibility({ title: 'Intern', text: 'Candidates pursuing a PhD in physics.' }, profile).label, 'ineligible');
  assert.equal(assessEligibility({ title: 'Graduation Internship', type: 'thesis', text: 'MSc students in their final year.' }, profile).label, 'ineligible');
});

test("'Master's preferred' does not exclude Bachelor students", () => {
  const r = assessEligibility({ title: 'Intern', text: "Bachelor's student in physics. A Master's degree is a plus." }, profile);
  assert.equal(r.label, 'eligible');
});

test('year-of-study requirements give future eligibility, not eligible', () => {
  assert.equal(assessEligibility({ title: 'Intern', text: "Bachelor's students graduating in 2027 or 2028.", startDate: summer }, profile).label, 'future');
  assert.equal(assessEligibility({ title: 'Intern', text: 'For third-year students.', startDate: summer }, profile).label, 'future');
  assert.equal(assessEligibility({ title: 'Summer Student', text: 'You must have completed at least 6 semesters of full-time study.', startDate: summer }, profile).label, 'future');
  assert.equal(assessEligibility({ title: 'Intern', text: 'Open to rising juniors.', startDate: summer }, profile).label, 'future');
  assert.equal(assessEligibility({ title: 'Intern', text: 'Open to rising sophomores and university students.', startDate: summer }, profile).label, 'eligible');
  assert.equal(assessEligibility({ title: 'Intern', text: 'Final-year students only.' }, profile).label, 'future');
});

test('graduation year in range is accepted; later range is ineligible', () => {
  assert.equal(assessEligibility({ title: 'Intern', text: "Bachelor's students graduating between 2028 and 2030." }, profile).label, 'eligible');
  assert.equal(assessEligibility({ title: 'Intern', text: "Bachelor's students graduating in 2031." }, profile).label, 'ineligible');
});

test('unknown and generic-student listings are labelled honestly', () => {
  assert.equal(assessEligibility({ title: 'Intern', text: 'Join our great team.' }, profile).label, 'unknown');
  assert.equal(assessEligibility({ title: 'Intern', text: 'For students who love code.' }, profile).label, 'potential');
  const exp = assessEligibility({ title: 'Intern', text: "Bachelor's students with 2+ years of professional experience." }, profile);
  assert.equal(exp.label, 'potential');
});

const base = {
  type: 'internship', schedule: 'full_time', hours: null, duration: { minMonths: 2.3 },
  fields: ['ai_ml_cv', 'comp_physics'], skills: { required: ['Python', 'PyTorch'], preferred: [] },
  location: { arrangement: 'onsite', region: 'brainport', isNetherlands: true, isBrainport: true, text: 'Eindhoven' },
  compensation: { status: 'paid' }, startDate: summer, eligibility: { label: 'eligible', reasons: ['ok'] },
};

test('match score is explainable and bounded', () => {
  const m = scoreOpportunity(base, prefs);
  assert.ok(m.score >= 90 && m.score <= 100, `score ${m.score}`);
  assert.equal(m.breakdown.length, 6);
  const sumMax = m.breakdown.reduce((a, b) => a + b.max, 0);
  assert.ok(Math.abs(sumMax - 100) < 0.5);
});

test('an ineligible role loses the whole eligibility component', () => {
  const good = scoreOpportunity(base, prefs).score;
  const bad = scoreOpportunity({ ...base, eligibility: { label: 'ineligible', reasons: [] } }, prefs).score;
  assert.equal(good - bad, 25);
});

test('missing data lowers confidence instead of being treated as a match', () => {
  const sparse = { type: 'internship', fields: [], skills: { required: [], preferred: [] }, location: {}, compensation: { status: 'unknown' }, eligibility: { label: 'unknown' } };
  const m = scoreOpportunity(sparse, prefs);
  assert.equal(m.confidence, 'low');
  assert.ok(m.score < 50);
});

test('custom weights are respected', () => {
  const onlyTech = scoreOpportunity(base, { ...prefs, weights: { technical: 1, eligibility: 0, location: 0, schedule: 0, skills: 0, compensation: 0 } });
  assert.equal(onlyTech.score, 100);
});

test('location fit honours remote restrictions', () => {
  assert.equal(locationFit({ location: { arrangement: 'remote', remoteRegion: 'restricted_elsewhere', text: 'Remote - US' } }, prefs).compatible, false);
  assert.equal(locationFit({ location: { arrangement: 'remote', remoteRegion: 'unverified' } }, prefs).compatible, 'unverified');
  assert.equal(locationFit({ location: { arrangement: 'onsite', region: 'outside_europe', text: 'Chicago' } }, prefs).compatible, false);
});

test('track assignment', () => {
  assert.equal(trackOf({ type: 'working_student' }), 'part_time');
  assert.equal(trackOf({ type: 'internship', hours: { min: 12, max: 16 } }), 'part_time');
  assert.equal(trackOf({ type: 'internship', schedule: 'full_time' }), 'summer');
  assert.equal(trackOf({ type: 'talent_pool' }), 'programme');
});
