import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, findDates, extractDeadline, extractStart, extractOpening } from '../site/shared/dates.js';
import { htmlToText } from '../site/shared/text.js';
import {
  isStudentRole, employmentType, extractHours, workSchedule, extractDuration, extractCompensation,
  analyseLocation, extractRestrictions, tagFields, extractSkills,
} from '../site/shared/classify.js';

test('dates: European, ISO, written and Dutch formats', () => {
  assert.deepEqual(parseDate('2026-11-15'), { date: '2026-11-15', precision: 'day' });
  assert.deepEqual(parseDate('closes 05/12/2026'), { date: '2026-12-05', precision: 'day' });
  assert.deepEqual(parseDate('on 15th of November 2026'), { date: '2026-11-15', precision: 'day' });
  assert.deepEqual(parseDate('November 15, 2026'), { date: '2026-11-15', precision: 'day' });
  assert.deepEqual(parseDate('uiterlijk 1 december 2026'), { date: '2026-12-01', precision: 'day' });
  assert.deepEqual(parseDate('July 2027'), { date: '2027-07-01', precision: 'month' });
  assert.equal(parseDate('Summer 2027').precision, 'season');
});

test('dates: invalid dates are rejected, missing years inferred from the reference date', () => {
  assert.equal(parseDate('31/02/2027'), null);
  assert.equal(parseDate('version 1.2.3'), null);
  assert.deepEqual(parseDate('apply by 15 January', '2026-10-09'), { date: '2027-01-15', precision: 'day' });
  assert.deepEqual(parseDate('apply by 20 October', '2026-10-09'), { date: '2026-10-20', precision: 'day' });
  assert.equal(parseDate('apply by 15 January'), null, 'without a reference date no year is guessed');
});

test('dates: a longer match is not double-counted', () => {
  const all = findDates('Deadline 15 November 2026');
  assert.equal(all.length, 1);
});

test('dates: deadline, opening and start extraction', () => {
  assert.equal(extractDeadline('Application deadline: 30 November 2026.', '2026-10-09').date, '2026-11-30');
  assert.equal(extractDeadline('Apply before 1 Dec 2026', '2026-10-09').date, '2026-12-01');
  assert.equal(extractDeadline('Founded in 2010, we build chips.', '2026-10-09'), null);
  assert.equal(extractOpening('Applications open on 1 November 2026', '2026-10-09').date, '2026-11-01');
  assert.equal(extractStart('Research Intern - Summer 2027', '', '2026-10-09').precision, 'season');
  assert.equal(extractStart('Intern', 'Start date: 1 July 2027', '2026-10-09').date, '2027-07-01');
  assert.equal(extractStart('FPGA Internship (2027 Start)', '', '2026-10-09').precision, 'year');
});

test('html to text keeps structure and decodes double-encoded Greenhouse HTML', () => {
  const t = htmlToText('&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;');
  assert.match(t, /Hello & welcome/);
  assert.match(t, /• Python/);
});

test('student-role detection', () => {
  for (const t of ['Hardware Engineer Intern', 'Werkstudent Data Science', 'Stagiair Software', 'Graduation Internship Embedded', 'Student Assistant Physics Lab', 'Quantitative Trading Intern Summer 2027', '2027 EU Campus Programme Talent Community', 'FPGA Internship (2027 Start)']) {
    assert.equal(isStudentRole(t), true, t);
  }
  for (const t of ['Internal Audit Specialist', 'International Sales Manager', 'Graduate Trader', 'Software Engineer', 'Early-stage Investor', 'Student Recruitment Lead']) {
    assert.equal(isStudentRole(t), false, t);
  }
});

test('employment type', () => {
  assert.equal(employmentType('Graduation Internship Embedded Security'), 'thesis');
  assert.equal(employmentType('Werkstudent Python'), 'working_student');
  assert.equal(employmentType('Deep Learning Research Intern'), 'research');
  assert.equal(employmentType('Hardware Engineer Intern'), 'internship');
  assert.equal(employmentType('2027 EU Campus Programme Talent Community'), 'talent_pool');
});

test('hours, schedule and duration', () => {
  assert.deepEqual(extractHours('about 12-16 hours per week').min, 12);
  assert.equal(extractHours('max 16 uur per week').max, 16);
  assert.equal(extractHours('2 days a week').max, 16);
  assert.equal(extractHours('We were founded 16 years ago'), null);
  assert.equal(workSchedule('Part-time', ''), 'part_time');
  assert.equal(workSchedule(null, 'flexible hours alongside your studies'), 'part_time');
  assert.equal(workSchedule(null, 'nothing here'), 'unknown', 'unknown is not the same as full-time');
  assert.equal(extractDuration('Minimum of 5 months').minMonths, 5);
  assert.equal(extractDuration('a 10-week internship').minMonths, 2.3);
});

test('compensation: stated amount, stated paid, stated unpaid, and unknown stay distinct', () => {
  const a = extractCompensation('We offer an internship allowance of €600 per month.');
  assert.equal(a.status, 'paid');
  assert.equal(a.amount, 600);
  assert.equal(a.currency, 'EUR');
  assert.equal(a.period, 'month');
  assert.equal(extractCompensation('Salary: € 1.250,50 per maand').amount, 1250.5);
  assert.equal(extractCompensation('This internship is unpaid.').status, 'unpaid');
  assert.equal(extractCompensation('We offer a stipend.').status, 'paid');
  const u = extractCompensation('Great team, nice office.');
  assert.equal(u.status, 'unknown');
  assert.equal(u.amount, null);
});

test('location and remote eligibility are taken only from what the listing states', () => {
  const ehv = analyseLocation(['Eindhoven, Netherlands'], '');
  assert.equal(ehv.isBrainport, true);
  assert.equal(ehv.arrangement, 'onsite');
  assert.equal(analyseLocation(['Remote - Europe'], '').remoteRegion, 'EU');
  assert.equal(analyseLocation(['Remote'], '').remoteRegion, 'unverified');
  assert.equal(analyseLocation(['Remote - US'], '').remoteRegion, 'restricted_elsewhere');
  assert.equal(analyseLocation(['Anywhere (remote)'], '').remoteRegion, 'worldwide');
  assert.equal(analyseLocation(['Amsterdam'], 'This is a hybrid role').arrangement, 'hybrid');
  assert.equal(analyseLocation(['Chicago, Illinois, United States'], '').region, 'outside_europe');
  assert.equal(analyseLocation([], '').arrangement, 'unknown');
});

test('work-authorisation statements are quoted, not inferred', () => {
  const r = extractRestrictions('Nice team. Candidates must be eligible to work in the Netherlands; we are unable to provide visa sponsorship.');
  assert.ok(r.length >= 1);
  assert.match(r[0], /eligible to work/);
  assert.deepEqual(extractRestrictions('We welcome international students.'), []);
});

test('field tagging and skills', () => {
  const { tags } = tagFields('Internship Image Processing for Wafer Inspection', 'computer vision and deep learning for semiconductor wafers');
  assert.ok(tags.includes('ai_ml_cv'));
  assert.ok(tags.includes('semiconductors_hw'));
  const s = extractSkills('Requirements: Python and linear algebra.\nNice to have: C++ and Qiskit.');
  assert.deepEqual(s.required.sort(), ['Linear algebra', 'Python']);
  assert.deepEqual(s.preferred.sort(), ['C++', 'Qiskit']);
});

// Phrasings taken from live Philips/NXP Workday postings (checked 9 Oct 2026).
test('real-world phrasings from live Workday postings', () => {
  assert.deepEqual([extractHours('Weekly Presence: 40h (minimum 32h)').min, extractHours('Weekly Presence: 40h (minimum 32h)').max], [32, 40]);
  assert.equal(extractHours('For our office-based teams, this means working in-person at least 3 days per week.'), null, 'office presence is not weekly hours');
  assert.equal(extractHours('Weekly presence: at least 3 days per week on-site'), null);
  assert.equal(extractDuration('Duration: at least / 6 months').minMonths, 6);
  assert.equal(extractDuration('Duration: approximately 6 months').minMonths, 6);
  const c = extractCompensation('Monthly full-time allowance between €500 - €700 gross, depending on your education level');
  assert.deepEqual([c.status, c.amount, c.amountMax, c.period, c.currency], ['paid', 500, 700, 'month', 'EUR']);
  assert.equal(extractStart('Intern', 'Start Date: As soon as possible', '2026-10-09').precision, 'asap');
  assert.equal(extractStart('Intern', 'Start date: November 2026 (we are flexible)', '2026-10-09').date, '2026-11-01');
  assert.equal(isStudentRole('Internship: Change Management (Master, non-thesis)'), true);
  assert.equal(isStudentRole('Internship/Thesis – Signal Processing and AI for autonomous driving'), true);
});
