# Internship Radar

A personal monitor for student opportunities: Summer 2027 internships and part-time
roles during the academic year. A daily GitHub Action reads official employer job
systems, extracts what each listing actually says, and publishes a dashboard on
GitHub Pages. It needs no server, database or API keys, and costs nothing.

**To set up your own copy, follow [SETUP.md](SETUP.md).** No coding is needed.

---

## What it does

### Collects real listings every day

- Reads official job systems through their public, documented APIs: Greenhouse,
  Lever, Ashby, Recruitee and SmartRecruiters.
- Reads Workday career sites through the JSON search those sites themselves use.
- Reads official vacancy pages that have no feed.
- Keeps only student roles: internships, working-student jobs, student-assistant
  and research-assistant roles, thesis projects, and programme interest forms.

### Extracts facts, never invents them

From each listing it pulls out:

- deadlines, opening dates and start dates, in English and Dutch
- weekly hours, duration and pay
- location, working arrangement, and where a remote role may be done from
- technical field and skills
- quoted work-permit or residency terms
- degree level, study year and graduation year

Anything the text does not say is stored as *unknown*. It is never stored as no or zero.

### Assesses eligibility, separately from the match score

Each role gets one of five labels:

- **Eligible** based on the published requirements
- **Potentially eligible**: verify with the employer
- **Future eligibility**: you don't meet the stated year requirement yet
- **Ineligible** based on a confirmed requirement
- **Unknown**

Master's-only, PhD-only, final-year and graduation-year restrictions are never
marked eligible. Work rights are never inferred.

### Scores matches, and explains the score

The 0–100 score has editable weights:

| Component | Default weight |
|---|---|
| Technical fit | 35 |
| Eligibility | 25 |
| Location | 15 |
| Dates and hours | 10 |
| Skills | 10 |
| Pay | 5 |

Roles that combine computer science with physics, ML, imaging, robotics, quantum
or hardware get a bonus. Missing data counts as neutral and lowers the confidence
shown next to the score.

### Tracks changes and keeps evidence

- **No duplicates.** Each record has a stable ID per source, and a fingerprint for
  repeats across sources. The official source wins.
- **Change history.** Status, deadline, opening date, application link, title and
  eligibility changes are recorded with before and after values.
- **Closures need confirmation.** A listing is closed only when the source confirms
  it is gone (404), or after two consecutive complete checks without it.

### Shows when programmes open (Opening radar)

- **OPEN NOW** comes from live listings.
- **OPENING SOON** needs a date the employer announced, with a source URL.
- **EXPECTED TO OPEN** is estimated only from openings recorded in earlier years,
  is always labelled as an estimate, and shows its basis.
- Without history, a programme is **NOT YET ANNOUNCED** (monitored board, no
  listing) or **STATUS UNKNOWN** (manual source).

### Reports on its own health

- Each source has a health status and its last successful check.
- Every run is logged.
- The dashboard shows the real time of the last refresh, and whether it was
  complete, partial or failed.
- Listings from a source that failed are labelled "not re-checked since …".

### Dashboard

Views: Overview, Opportunities, Opening radar, Remote, Part-time now,
Saved and applied, Sources and health, and Settings.

- **Alerts** appear in the dashboard: new matches, programmes that opened, upcoming
  openings and deadlines, changes to saved roles, and sources that recovered.
- **Saved roles, application stages, notes and follow-up dates** stay in the
  browser. They can be exported as CSV or as a backup file.
- Responsive, keyboard accessible, with light and dark themes.

## Sources

### Read automatically

All of these refresh daily at 04:17 UTC. You can also refresh manually from the
Actions tab or the dashboard.

| Employer | Method | Checked |
|---|---|---|
| IMC Trading | Greenhouse API `imc` | 9 Oct 2026: live, with student roles, including an Amsterdam hardware internship |
| Optiver | Greenhouse API `optiverus` | 9 Oct 2026: live, includes an Amsterdam FPGA internship (2027 start) |
| Flow Traders | Greenhouse API `flowtraders` | 9 Oct 2026: live |
| Adyen | Greenhouse API `adyen` | 9 Oct 2026: live |
| Databricks | Greenhouse API `databricks` | 9 Oct 2026: live |
| Quantinuum | Lever EU API `quantinuum` | 9 Oct 2026: live |
| NXP Semiconductors | Workday `nxp/careers`, filtered to the Netherlands | 9 Oct 2026: search and detail responses checked. About 20–30 Dutch results for "intern", including robotics and ML internships in Eindhoven and Nijmegen |
| Philips | Workday `philips/jobs-and-careers`, filtered to the Netherlands | 9 Oct 2026: checked, 46 Dutch internship results |
| Thermo Fisher Scientific | Workday `thermofisher/ThermoFisherCareers`, Dutch cities | 9 Oct 2026: checked, including an Eindhoven AI/ML electron-microscopy internship |
| NVIDIA | Workday `nvidia/NVIDIAExternalCareerSite`, filtered to the Netherlands | Site and robots.txt checked; the country filter was not checked |
| TNO | Page watcher on tno.nl vacancy pages | Listing page checked; links are server-rendered |
| Canon Production Printing | Page watcher on the internship search | Experimental: may need switching to manual if results load with JavaScript |

### Checked by hand

The dashboard links to these and checks weekly that each link still works:
ASML, Booking.com, TU/e, DIFFER, CERN, Google, Prodrive, Microsoft, IBM, Qblox,
QuTech, imec, ESA, Vanderlande, DAF and VDL.

The reason for each is shown on the Sources page. Usually there is no public feed,
or the site uses an applicant system without an API. Their own job-alert emails are
the best complement.

### Ground rules

- Every request identifies itself as `InternshipRadar/1.0`.
- robots.txt is checked before every source.
- At most about one request per second per host.
- Retries use backoff and honour `Retry-After`.
- No sign-ins, no CAPTCHA solving and no bypassing of blocks.
- A source that disallows access is shown as **Blocked**, not silently skipped.

## How it works

```
GitHub Actions (daily)                              GitHub Pages
  scripts/ingest.js                                   site/ (static)
    adapters/*  →  site/shared/normalise.js  →  data/*.json  →  index.html + app.js
    (fetch)        (classify, eligibility,      (committed      (reads data/, config/;
                    dates, match)               to the repo)     personal data stays
                                                                 in localStorage)
```

- **Runtime.** Node 20+ with no dependencies, so there is nothing to install or
  keep updated.
- **Shared rules.** `site/shared/` is used both by the collector and in the browser.
  The match score therefore updates instantly when weights change.
- **History for free.** Data lives in git, so every refresh is a commit and the
  repository history doubles as an audit trail.

### Why not Next.js + Supabase + Vercel?

The original brief suggested that stack. It was swapped for GitHub Actions + Pages
because the radar has to be owned and run by someone without a developer setup:

- one account instead of three
- no secrets to manage
- no database to migrate or pay for
- no service-role keys to leak

The trade-off is that personal tracking data lives in the browser rather than in a
database behind a login.

## Data files (schema)

Written by `scripts/ingest.js` to `data/`. All timestamps are ISO 8601 UTC, and
`schemaVersion` is `1`.

**`opportunities.json` → `items[]`**

| Group | Fields |
|---|---|
| Identity | `id` (`sourceId:externalId`), `sourceId`, `externalId`, `employer`, `title`, `department` |
| Links | `url`, `applyUrl`, `sourceUrl`, `evidenceUrls[]` |
| Content | `summary`, `fields[]`, `skills{required,preferred}` |
| Role type | `type` (internship / research / working_student / thesis / talent_pool / other), `track` (summer / part_time / programme), `schedule`, `hours{min,max}`, `duration{minMonths,maxMonths}` |
| Location | `location{text,arrangement,region,isNetherlands,isBrainport,remoteRegion}`, `restrictions[]` (quoted) |
| Pay | `compensation{status,amount,amountMax,currency,period,evidence}` |
| Dates | `postedAt`, `openingDate`, `deadline`, `startDate`. Each date is `{date,precision,evidence,from}`. |
| Eligibility | `eligibility{label,reasons[],requirements,firstYearEligible}` |
| Status | `status` (open / opening_soon / deadline_passed / closed), `closedAt`, `missedRuns`, `note` |
| Timestamps | `firstSeenAt`, `lastSeenAt`, `lastVerifiedAt` |
| Duplicates | `fingerprint`, `duplicateOf`, `sourceTier` |
| Score | `match{score,breakdown[],confidence}`, using the repository defaults |

**The other files in `data/`:**

| File | Contents |
|---|---|
| `details.json` | Description text per id (for the detail panel), cached fetch metadata, `fetchedAt` |
| `history.json` | `events[]` of type new / changed / closed / reopened / deadline_passed / programme_opened / programme_status / source_failed / source_recovered, each with `from`, `to`, `evidence`, `at`. Kept for 400 days. |
| `sources-status.json` | Per source: `lastStatus`, `health`, `lastSuccessAt`, `lastAttemptAt`, `consecutiveFailures`, `lastError`, `listingsFound`, `scanned`, last 30 attempts. For manual sources: link-check results. |
| `programmes-status.json` | Per programme: `status`, `reason`, `openIds`, `observedOpenings{cycle:{openedOn,precision,url}}`, `evidence[]`, `prediction{from,to,confidence,basis[]}`, `announced` |
| `runs.json` | The last 150 runs, with status and per-source errors |
| `meta.json` | `lastRunAt`, `lastRunStatus`, `lastSuccessfulRunAt`, `lastDataRefreshAt`, counts |

**Migrations.** The collector reads old files and rewrites them on every run. If
the schema ever changes, bump `schemaVersion` and add the conversion at the start
of `runIngest`. To start from scratch, delete the files in `data/` and run the
workflow.

**Browser storage.** The `internship-radar.v1` key holds:

- `saved{id: {stage, savedAt, appliedAt, followUp, interviews, outcome, notes}}`
- `settings`, `filters`, `seenUntil` and `theme`

## Running it locally (optional)

```bash
npm test                    # 42 tests, no install step needed (Node 20+)
npm run ingest              # real run against all sources; writes data/
npm run ingest -- --only=gh-imc,wd-nxp
npm run serve               # dashboard on http://localhost:8080
```

## Notifications

Alerts are shown on the dashboard, which is the setting chosen for this copy.
GitHub also emails the repository owner when a scheduled run fails.

Email digests are not built in. To add them later:

1. Add a step after the refresh that turns new `history.json` events into a message.
2. Send it with an email API, keeping the API key in **Settings → Secrets → Actions**.

## Limitations

- **Coverage is limited to employers with a readable source.** ASML, Booking.com,
  Google, Microsoft, IBM, CERN, ESA, TU/e and others have no usable public feed, so
  they are links to check by hand. TU/e student-assistant jobs are mostly
  advertised inside departments.
- **Extraction is rule-based.** Unusual phrasings can be missed. When that happens
  the field shows *not stated* rather than a wrong value, and the original listing
  is always one click away and is the authority.
- **Eligibility is only as good as the text.** Many listings state no year
  requirement and appear as *potentially eligible* or *unknown*. Residency and
  work-permit terms are quoted, never assessed.
- **Opening-date estimates start empty.** No historical recruitment dates were
  available to seed them, and none were invented. Radar records the openings it
  sees from now on, and dates you add with a source. Estimates become meaningful
  from the 2027–28 cycle.
- **Workday searches are capped** at 50 detail lookups and 6 result pages per
  search term per run. A capped run is reported as *partial*.
- **Page watchers can break** when an employer redesigns its site. When that
  happens they report an error rather than silently showing nothing.
- **Saved roles and notes live in one browser.** Use Export backup and Import backup
  to move them between devices.
- **GitHub may pause schedules** in repositories inactive for 60 days. The daily
  data commits should prevent this. If it happens, re-enable the workflow on the
  Actions tab.

## Sharing this with someone else

Give them the zip, or a template repository with an **empty** `data/` folder. If
your own copy collects data and they fork it, their **Sync fork** would conflict
on `data/`. Either have them use **Use this template**, or keep the shared original
free of collected data.
