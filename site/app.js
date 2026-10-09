// Internship Radar dashboard. Static: reads the JSON files that the daily GitHub
// Action writes, and keeps saved roles, notes and settings in this browser only.
import { loadData, loadDetails, loadLocal, saveLocal, storageAvailable, effectivePrefs, derive, isLive, repoFromLocation, deepMerge } from './state.js';
import { FIELDS, FIELD_LABELS, ELIGIBILITY_LABELS, EMPLOYMENT_TYPES } from './shared/taxonomy.js';
import { formatDate, daysBetween, todayISO, addDays } from './shared/dates.js';
import { DEFAULT_WEIGHTS } from './shared/match.js';

// ---------------------------------------------------------------------------
// Small helpers

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };
const link = (u, text, cls = '') => { const s = safeUrl(u); return s ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer"${cls ? ` class="${cls}"` : ''}>${esc(text)}</a>` : esc(text); };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDay = (iso) => (iso ? formatDate(iso.slice(0, 10)) : '—');
const ago = (iso) => {
  if (!iso) return '';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const TODAY = todayISO();

const STATUS_LABEL = { open: 'Open', opening_soon: 'Opening soon', deadline_passed: 'Deadline passed', closed: 'Closed', unknown: 'Unknown' };
const STATUS_CLASS = { open: 'open', opening_soon: 'soon', deadline_passed: 'passed', closed: 'closed', unknown: 'unknown' };
const ELIG_SHORT = { eligible: 'Eligible', potential: 'Check with employer', future: 'Later year', ineligible: 'Not eligible', unknown: 'Not stated' };
const ARR = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On site', unknown: 'Arrangement not stated' };
const REMOTE_REGION = { NL: 'Netherlands', EU: 'Europe', worldwide: 'worldwide', restricted_elsewhere: 'restricted to another country', unverified: 'location not stated' };
const PROG_CLASS = { 'OPEN NOW': 'open', 'OPENING SOON': 'soon', 'EXPECTED TO OPEN': 'expected', 'NOT YET ANNOUNCED': 'notyet', CLOSED: 'closed', 'DEADLINE PASSED': 'passed', 'STATUS UNKNOWN': 'unknown' };
const PROG_ORDER = ['OPEN NOW', 'OPENING SOON', 'EXPECTED TO OPEN', 'NOT YET ANNOUNCED', 'STATUS UNKNOWN', 'DEADLINE PASSED', 'CLOSED'];
const APP_STAGES = ['Saved', 'Preparing', 'Applied', 'Online test', 'Interview', 'Offer', 'Accepted', 'Rejected', 'Withdrawn'];
const METHOD = { greenhouse: 'Greenhouse job API', lever: 'Lever job API', ashby: 'Ashby job API', workday: 'Workday career site', smartrecruiters: 'SmartRecruiters API', recruitee: 'Recruitee API', page: 'Official vacancy page', manual: 'Check by hand' };

const icon = {
  bookmark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8v12l-4-3-4 3z" fill="currentColor"/></svg>',
  bookmarkOff: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8v12l-4-3-4 3z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
};

// ---------------------------------------------------------------------------
// State

const S = {
  data: null,
  local: loadLocal(),
  prefs: null,
  items: [],
  storageOk: storageAvailable(),
  filters: null,
  sort: { key: 'match', dir: 'desc' },
};
S.filters = { q: '', field: '', elig: 'now', loc: 'mine', track: 'all', status: 'live', pay: 'any', ...(S.local.filters ?? {}) };

function persist() {
  if (!saveLocal(S.local) && S.storageOk) toast('Could not save in this browser (storage full or blocked).');
}

function recompute() {
  S.prefs = effectivePrefs(S.data.defaults, S.local);
  S.items = derive(S.data.items, S.prefs, S.local);
}

function eligNowSet() {
  return new Set(S.prefs.eligibility?.show ?? ['eligible', 'potential']);
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------------------------------------------------------------------------
// Alerts (shown in the dashboard; nothing is sent anywhere)

function computeAlerts() {
  const a = S.prefs.alerts ?? {};
  const types = a.types ?? {};
  const minScore = Number(a.minScore ?? 50);
  const since = S.local.seenUntil ?? addDays(TODAY, -7) + 'T00:00:00Z';
  const byId = new Map(S.items.map((o) => [o.id, o]));
  const elig = eligNowSet();
  const relevant = (o) => o && (o.saved || (o.match.score >= minScore && elig.has(o.eligibility?.label) && o.locFit.compatible !== false));
  const out = [];
  for (const e of S.data.events) {
    if (e.at <= since) continue;
    const o = e.id ? byId.get(e.id) : null;
    if (e.type === 'new' && types.new !== false && relevant(o) && isLive(o)) out.push({ kind: 'new', label: 'New', at: e.at, o, text: `${o.title}`, sub: `${o.employer} · match ${o.match.score}` });
    else if (e.type === 'programme_opened' && types.opened !== false) {
      const p = S.data.programmes.find((x) => x.id === e.programmeId);
      if (p) out.push({ kind: 'opened', label: 'Applications open', at: e.at, text: `${p.employer}: ${p.name}`, sub: 'Programme moved to OPEN NOW', href: '#radar' });
    } else if ((e.type === 'changed' || e.type === 'deadline_passed') && types.changed !== false && o && (o.saved || relevant(o)) && ['deadline', 'status', 'openingDate', 'applyUrl'].includes(e.field)) {
      const what = { deadline: 'Deadline changed', status: 'Status changed', openingDate: 'Opening date changed', applyUrl: 'Application link changed' }[e.field];
      out.push({ kind: 'changed', label: what, at: e.at, o, text: o.title, sub: `${o.employer}: ${e.from ?? 'not set'} → ${e.to ?? 'not set'}` });
    } else if (e.type === 'source_recovered' && types.sourceRecovered !== false) {
      const s = S.data.sources.find((x) => x.id === e.sourceId);
      out.push({ kind: 'source', label: 'Source working again', at: e.at, text: s?.employer ?? e.sourceId, sub: 'Listings from this source are being refreshed again', href: '#sources' });
    }
  }
  if (types.deadline !== false) {
    const days = Number(a.deadlineDays ?? 14);
    for (const o of S.items) {
      if (!isLive(o) || !o.deadline?.date || o.deadline.precision !== 'day') continue;
      const left = daysBetween(TODAY, o.deadline.date);
      if (left >= 0 && left <= days && (o.saved || relevant(o))) out.push({ kind: 'deadline', label: left === 0 ? 'Deadline today' : `Deadline in ${plural(left, 'day')}`, at: o.deadline.date, o, text: o.title, sub: o.employer, sortKey: left });
    }
  }
  if (types.openingSoon !== false) {
    const days = Number(a.openingDays ?? 14);
    for (const p of S.data.programmes) {
      const st = S.data.programmeStatus[p.id];
      if (st?.status === 'OPENING SOON' && st.daysUntilOpening != null && st.daysUntilOpening <= days) out.push({ kind: 'soon', label: `Opens in ${plural(st.daysUntilOpening, 'day')}`, at: st.announced?.opening, text: `${p.employer}: ${p.name}`, sub: 'Confirmed by the employer', href: '#radar' });
    }
    for (const o of S.items) {
      if (o.status === 'opening_soon' && o.openingDate?.date && daysBetween(TODAY, o.openingDate.date) <= days && relevant(o)) out.push({ kind: 'soon', label: `Opens ${fmtDay(o.openingDate.date)}`, at: o.openingDate.date, o, text: o.title, sub: o.employer });
    }
  }
  const rank = { deadline: 0, opened: 1, soon: 2, new: 3, changed: 4, source: 5 };
  return out.sort((x, y) => rank[x.kind] - rank[y.kind] || (x.sortKey ?? 0) - (y.sortKey ?? 0) || String(y.at).localeCompare(String(x.at)));
}

// ---------------------------------------------------------------------------
// Shared fragments

function scoreCell(o) {
  const lowConf = o.match.confidence === 'low';
  return `<span class="score${lowConf ? ' low-confidence' : ''}" title="Match ${o.match.score}/100, ${o.match.confidence} confidence"><b>${o.match.score}</b><span class="score-bar"><span style="width:${o.match.score}%"></span></span></span>`;
}

function eligPill(o) {
  const l = o.eligibility?.label ?? 'unknown';
  return `<span class="pill ${l}" title="${esc(ELIGIBILITY_LABELS[l])}">${esc(ELIG_SHORT[l])}</span>`;
}

function whereText(o) {
  const loc = o.location ?? {};
  const all = (loc.text || '').split(' | ').filter(Boolean);
  const place = all.length ? `${all[0]}${all.length > 1 ? ` (+${all.length - 1} more)` : ''}` : 'Location not stated';
  if (loc.arrangement === 'remote') return `Remote, ${REMOTE_REGION[loc.remoteRegion] ?? 'location not stated'}`;
  return `${ARR[loc.arrangement] ?? ''}${loc.arrangement && loc.arrangement !== 'unknown' ? ' · ' : ''}${place}`;
}

function dateCell(o) {
  const parts = [];
  if (o.deadline?.date) {
    const left = daysBetween(TODAY, o.deadline.date);
    const urgent = left >= 0 && left <= 7;
    parts.push(`<span class="${urgent ? 'date-urgent' : ''}">Deadline ${esc(formatDate(o.deadline.date, o.deadline.precision))}</span>`);
  } else parts.push('<span class="sub">No deadline stated</span>');
  if (o.startDate?.date) parts.push(`<span class="sub">Starts ${esc(formatDate(o.startDate.date, o.startDate.precision))}</span>`);
  if (o.status === 'opening_soon' && o.openingDate?.date) parts.push(`<span class="sub">Opens ${esc(fmtDay(o.openingDate.date))}</span>`);
  return parts.join('<br>');
}

function saveButton(o) {
  return `<button class="save-btn" data-action="toggle-save" data-id="${esc(o.id)}" aria-pressed="${o.saved}" aria-label="${o.saved ? 'Remove from saved' : 'Save'}: ${esc(o.title)}">${o.saved ? icon.bookmark : icon.bookmarkOff}</button>`;
}

function oppRow(o) {
  const tags = [];
  if (o.isNew) tags.push('<span class="tag new">New</span>');
  if (o.stale) tags.push(`<span class="tag stale" title="The source could not be checked since ${esc(fmtDateTime(o.lastVerifiedAt))}">Not re-checked since ${esc(fmtDay(o.lastVerifiedAt))}</span>`);
  if (o.restrictions?.length) tags.push('<span class="tag warn">Work-permit terms</span>');
  if (o.locFit.compatible === 'unverified') tags.push('<span class="tag warn">Location unclear</span>');
  if (o.status !== 'open') tags.push(`<span class="pill ${STATUS_CLASS[o.status] ?? 'unknown'}">${esc(STATUS_LABEL[o.status] ?? o.status)}</span>`);
  for (const f of (o.fields ?? []).slice(0, 2)) tags.push(`<span class="tag">${esc(FIELD_LABELS[f])}</span>`);
  return `<tr class="${o.isNew ? 'is-new' : ''}" data-open="${esc(o.id)}">
    <td class="c-role"><a class="role" href="#live/${encodeURIComponent(o.id)}" data-open="${esc(o.id)}">${esc(o.title)}</a><span class="sub">${esc(o.employer)} · ${esc(EMPLOYMENT_TYPES[o.type] ?? 'Student role')}</span><div class="tags">${tags.join('')}</div></td>
    <td class="c-where" data-label="Where">${esc(whereText(o))}</td>
    <td class="c-dates" data-label="Dates">${dateCell(o)}</td>
    <td class="c-elig" data-label="Eligibility">${eligPill(o)}</td>
    <td class="c-score" data-label="Match">${scoreCell(o)}</td>
    <td class="c-save">${saveButton(o)}</td>
  </tr>`;
}

function oppTable(list, { sortable = false } = {}) {
  if (!list.length) return '';
  const th = (key, label) => sortable
    ? `<th scope="col"><button data-sort="${key}" aria-sort="${S.sort.key === key ? (S.sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}">${label}</button></th>`
    : `<th scope="col">${label}</th>`;
  return `<div class="table-wrap"><table class="opps">
    <thead><tr>${th('title', 'Role')}<th scope="col">Where</th>${th('deadline', 'Dates')}<th scope="col">Eligibility</th>${th('match', 'Match')}<th scope="col"><span class="visually-hidden">Save</span></th></tr></thead>
    <tbody>${list.map(oppRow).join('')}</tbody></table></div>`;
}

function sortList(list, key, dir = 'desc') {
  const m = dir === 'desc' ? -1 : 1;
  const far = '9999-12-31';
  const cmp = {
    match: (a, b) => (a.match.score - b.match.score) * m || a.title.localeCompare(b.title),
    newest: (a, b) => String(b.firstSeenAt).localeCompare(String(a.firstSeenAt)),
    deadline: (a, b) => (a.deadline?.date ?? far).localeCompare(b.deadline?.date ?? far) * (dir === 'desc' ? 1 : -1),
    opening: (a, b) => (a.openingDate?.date ?? far).localeCompare(b.openingDate?.date ?? far),
    title: (a, b) => a.title.localeCompare(b.title) * -m,
  }[key] ?? (() => 0);
  return [...list].sort(cmp);
}

// ---------------------------------------------------------------------------
// Status bar

function renderStatus() {
  const meta = S.data.meta;
  const el = $('#statusbar');
  const repo = repoFromLocation();
  const refresh = repo
    ? `<a class="refresh" href="https://github.com/${esc(repo.owner)}/${esc(repo.repo)}/actions/workflows/radar.yml" target="_blank" rel="noopener">Refresh now on GitHub</a>`
    : '<span class="refresh">Refresh: run the “Radar” workflow on GitHub</span>';
  if (!meta) {
    el.innerHTML = `<span><strong>No data yet.</strong> The first refresh has not run.</span>${refresh}`;
    return;
  }
  const failed = Object.entries(S.data.sourceStatus).filter(([, s]) => ['failed', 'blocked'].includes(s.lastStatus)).length;
  const statusText = { success: 'All sources checked', partial: `Partial: ${plural(failed, 'source')} failed`, failed: 'Last refresh failed', skipped: 'Last run skipped' }[meta.lastRunStatus] ?? meta.lastRunStatus;
  const cls = { success: 'success', partial: 'partial', failed: 'failed' }[meta.lastRunStatus] ?? 'unknown';
  const stale = meta.lastDataRefreshAt && Date.now() - Date.parse(meta.lastDataRefreshAt) > 36 * 3600000;
  el.innerHTML = `
    <span>Data refreshed <strong>${esc(fmtDateTime(meta.lastDataRefreshAt))}</strong> (${esc(ago(meta.lastDataRefreshAt))})</span>
    <span class="pill ${cls}">${esc(statusText)}</span>
    ${stale ? '<span class="pill failed">Older than a day: check the GitHub Actions tab</span>' : ''}
    ${meta.lastSuccessfulRunAt && meta.lastRunStatus !== 'success' ? `<span>Last complete refresh ${esc(fmtDateTime(meta.lastSuccessfulRunAt))}</span>` : ''}
    ${refresh}`;
}

// ---------------------------------------------------------------------------
// Opening radar timeline (the one bold element)

function radarTimeline(programmes, { includeDeadlines = true, limit = null } = {}) {
  const start = TODAY.slice(0, 8) + '01';
  const end = addDays(start, 365);
  const total = daysBetween(start, end);
  const pos = (iso) => Math.max(0, Math.min(100, (daysBetween(start, iso) / total) * 100));
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + i);
    const label = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    const isYear = d.getUTCMonth() === 0;
    months.push(`<span class="${isYear ? 'is-year' : ''}">${label}${isYear || i === 0 ? ` ${d.getUTCFullYear()}` : ''}</span>`);
  }
  const todayLeft = pos(TODAY);
  const rows = [];
  const progs = programmes
    .map((p) => ({ p, st: S.data.programmeStatus[p.id] }))
    .filter((x) => x.st)
    .sort((a, b) => PROG_ORDER.indexOf(a.st.status) - PROG_ORDER.indexOf(b.st.status));
  for (const { p, st } of (limit ? progs.slice(0, limit) : progs)) {
    const marks = [];
    if (st.status === 'OPEN NOW') {
      const opened = Object.values(st.observedOpenings ?? {}).map((o) => o.openedOn).sort()[0] ?? TODAY;
      const from = opened < start ? start : opened;
      marks.push(`<span class="mark open" style="left:${pos(from)}%;width:${Math.max(0.8, pos(TODAY) - pos(from))}%" title="Open: first seen ${esc(fmtDay(opened))}"></span>`);
      for (const id of st.openIds ?? []) {
        const o = S.items.find((x) => x.id === id);
        if (o?.deadline?.date && o.deadline.date >= start && o.deadline.date <= end) marks.push(`<span class="mark deadline" style="left:${pos(o.deadline.date)}%" title="Deadline ${esc(fmtDay(o.deadline.date))}: ${esc(o.title)}"></span>`);
      }
    }
    if (st.announced?.opening && st.announced.opening >= start && st.announced.opening <= end) {
      marks.push(`<span class="mark confirmed" style="left:${pos(st.announced.opening)}%;width:1.2%" title="Confirmed opening ${esc(fmtDay(st.announced.opening))}"></span>`);
    }
    if (st.announced?.deadline && st.announced.deadline >= start && st.announced.deadline <= end) {
      marks.push(`<span class="mark deadline" style="left:${pos(st.announced.deadline)}%" title="Confirmed deadline ${esc(fmtDay(st.announced.deadline))}"></span>`);
    }
    if (st.prediction && st.status !== 'OPEN NOW' && st.prediction.to >= start && st.prediction.from <= end) {
      const f = st.prediction.from < start ? start : st.prediction.from;
      const t = st.prediction.to > end ? end : st.prediction.to;
      marks.push(`<span class="mark estimate" style="left:${pos(f)}%;width:${Math.max(1, pos(t) - pos(f))}%" title="Estimated window ${esc(fmtDay(st.prediction.from))} – ${esc(fmtDay(st.prediction.to))} (${esc(st.prediction.confidence)} confidence, not confirmed)"></span>`);
    }
    if (!marks.length) {
      const note = { 'NOT YET ANNOUNCED': 'Not announced yet; board checked daily', 'STATUS UNKNOWN': p.kind === 'manual' ? 'Check by hand' : 'Could not be checked', CLOSED: 'Closed', 'DEADLINE PASSED': 'Deadline passed', 'EXPECTED TO OPEN': 'Estimate outside this window' }[st.status] ?? '';
      marks.push(`<span class="track-note" style="left:${Math.min(todayLeft + 1, 70)}%">${esc(note)}</span>`);
    }
    const aria = `${p.employer}, ${p.name}: ${st.status}`;
    rows.push(`<div class="radar-row-label" title="${esc(aria)}">${esc(p.employer)}<small>${esc(p.name)}</small></div>
      <div class="radar-track" role="img" aria-label="${esc(aria)}">${marks.join('')}<span class="radar-today" style="left:${todayLeft}%"></span></div>`);
  }
  if (includeDeadlines) {
    const dl = S.items.filter((o) => isLive(o) && o.deadline?.date && o.deadline.precision === 'day' && o.deadline.date >= TODAY && o.deadline.date <= end && eligNowSet().has(o.eligibility?.label));
    if (dl.length) {
      rows.push(`<div class="radar-row-label">All deadlines<small>${plural(dl.length, 'open role')} you can apply to</small></div>
        <div class="radar-track" role="img" aria-label="${plural(dl.length, 'upcoming deadline')}">${dl.map((o) => `<span class="mark deadline" style="left:${pos(o.deadline.date)}%" title="${esc(fmtDay(o.deadline.date))}: ${esc(o.employer)}, ${esc(o.title)}"></span>`).join('')}<span class="radar-today" style="left:${todayLeft}%"></span></div>`);
    }
  }
  const body = rows.length ? rows.join('') : '<div class="radar-empty">No programmes are tracked yet. They appear after the first refresh.</div>';
  return `<div class="radar"><div class="radar-grid">
      <div></div><div class="radar-months">${months.join('')}<span class="radar-today-label" style="left:${todayLeft}%">Today</span></div>
      ${body}
    </div>
    <div class="radar-legend">
      <span><i class="open"></i>Open now (since first seen)</span>
      <span><i class="confirmed"></i>Confirmed opening date</span>
      <span><i class="estimate"></i>Estimated window, not confirmed</span>
      <span><i class="deadline"></i>Deadline</span>
    </div></div>`;
}

// ---------------------------------------------------------------------------
// Views

function viewOverview() {
  const meta = S.data.meta;
  const elig = eligNowSet();
  const live = S.items.filter(isLive);
  const mine = live.filter((o) => elig.has(o.eligibility?.label) && o.locFit.compatible !== false && o.type !== 'talent_pool');
  const newOnes = mine.filter((o) => o.isNew);
  const deadlines = mine.filter((o) => o.deadline?.date && o.deadline.precision === 'day' && daysBetween(TODAY, o.deadline.date) >= 0 && daysBetween(TODAY, o.deadline.date) <= 14);
  const soonProgs = S.data.programmes.filter((p) => S.data.programmeStatus[p.id]?.status === 'OPENING SOON').length + live.filter((o) => o.status === 'opening_soon').length;
  const failing = Object.values(S.data.sourceStatus).filter((s) => ['failed', 'blocked'].includes(s.lastStatus)).length;
  const saved = Object.keys(S.local.saved ?? {}).length;
  const alerts = computeAlerts();
  const best = sortList(mine, 'match').slice(0, 6);

  const firstRun = !meta ? `<div class="callout info"><p><strong>Waiting for the first refresh.</strong> Open the repository on GitHub, go to Actions, choose “Radar” and press “Run workflow”. The dashboard fills in a few minutes later. SETUP.md has the steps.</p></div>` : '';

  return `
    <div class="page-head"><div><h1>Overview</h1><p>Student roles from official employer sources in the Netherlands and remote, checked once a day. Counts use your eligibility and location settings.</p></div></div>
    ${firstRun}
    <div class="metrics">
      <div class="metric"><a href="#live"><div class="metric-value">${mine.length}</div><div class="metric-label">Open roles you can apply to</div></a></div>
      <div class="metric"><a href="#live"><div class="metric-value">${newOnes.length}</div><div class="metric-label">New since last visit</div></a></div>
      <div class="metric"><a href="#radar"><div class="metric-value">${soonProgs}</div><div class="metric-label">Opening soon (confirmed)</div></a></div>
      <div class="metric ${deadlines.length ? 'is-alert' : ''}"><a href="#live"><div class="metric-value">${deadlines.length}</div><div class="metric-label">Deadlines in 14 days</div></a></div>
      <div class="metric"><a href="#saved"><div class="metric-value">${saved}</div><div class="metric-label">Saved</div></a></div>
      <div class="metric ${failing ? 'is-alert' : ''}"><a href="#sources"><div class="metric-value">${failing}</div><div class="metric-label">Sources failing</div></a></div>
    </div>

    <section class="section"><div class="section-head"><h2>Next 12 months</h2><a href="#radar">Open the full radar</a></div>${radarTimeline(S.data.programmes, { limit: 8 })}</section>

    <div class="cols section">
      <section>
        <div class="section-head"><h2>Needs attention</h2>${alerts.length ? '<button class="linkbtn" data-action="mark-seen">Mark all as seen</button>' : ''}</div>
        ${alerts.length ? `<ul class="list">${alerts.slice(0, 12).map(alertItem).join('')}</ul>${alerts.length > 12 ? `<p class="note">${alerts.length - 12} more.</p>` : ''}` : `<p class="empty">Nothing new since ${S.local.seenUntil ? esc(fmtDateTime(S.local.seenUntil)) : 'last week'}. Alerts appear here for new matches above ${esc(S.prefs.alerts?.minScore ?? 50)}, programmes that open, changes to saved roles and deadlines.</p>`}
      </section>
      <section>
        <div class="section-head"><h2>Best matches open now</h2><a href="#live">See all</a></div>
        ${best.length ? `<ul class="list">${best.map((o) => `<li><div><a href="#live/${encodeURIComponent(o.id)}" data-open="${esc(o.id)}">${esc(o.title)}</a><div class="sub">${esc(o.employer)} · ${esc(whereText(o))}</div></div>${scoreCell(o)}</li>`).join('')}</ul>` : '<p class="empty">No open roles match your current settings yet.</p>'}
      </section>
    </div>`;
}

function alertItem(a) {
  const href = a.o ? `#live/${encodeURIComponent(a.o.id)}` : a.href ?? '#overview';
  const kindClass = { new: 'k-new', opened: 'k-opened', deadline: 'k-deadline', soon: 'k-soon' }[a.kind] ?? '';
  return `<li><div><div class="kind ${kindClass}">${esc(a.label)}</div><a href="${href}"${a.o ? ` data-open="${esc(a.o.id)}"` : ''}>${esc(a.text)}</a><div class="sub">${esc(a.sub ?? '')}</div></div>${a.o ? scoreCell(a.o) : ''}</li>`;
}

function filterItems(f) {
  const elig = eligNowSet();
  const q = f.q.trim().toLowerCase();
  return S.items.filter((o) => {
    if (f.status === 'live' && !isLive(o)) return false;
    if (f.status === 'all' && o.duplicateOf) return false;
    if (f.track !== 'all' && o.track !== f.track) return false;
    if (f.field && !(o.fields ?? []).includes(f.field)) return false;
    if (f.pay === 'paid' && o.compensation?.status !== 'paid') return false;
    if (f.pay === 'notunpaid' && o.compensation?.status === 'unpaid') return false;
    if (f.loc === 'mine' && o.locFit.compatible === false) return false;
    if (f.loc === 'nl' && !o.location?.isNetherlands) return false;
    if (f.loc === 'brainport' && !o.location?.isBrainport) return false;
    if (f.loc === 'remote' && o.location?.arrangement !== 'remote') return false;
    if (q && !`${o.title} ${o.employer} ${o.summary} ${o.location?.text}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function applyElig(list, mode) {
  const elig = eligNowSet();
  if (mode === 'now') return list.filter((o) => elig.has(o.eligibility?.label));
  if (mode === 'later') return list.filter((o) => o.eligibility?.label === 'future');
  return list;
}

function viewLive() {
  const f = S.filters;
  const base = filterItems(f);
  const list = sortList(applyElig(base, f.elig), S.sort.key, S.sort.dir);
  const counts = { eligible: 0, potential: 0, future: 0, ineligible: 0, unknown: 0 };
  for (const o of base) counts[o.eligibility?.label ?? 'unknown']++;
  const hiddenElig = base.length - list.length;
  const seg = (name, value, label) => `<button data-filter="${name}" data-value="${value}" aria-pressed="${f[name] === value}">${label}</button>`;
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  return `
    <div class="page-head"><div><h1>Opportunities</h1><p>Every student role found on the monitored sources. Click a role for its requirements, score breakdown and the original listing.</p></div></div>
    <div class="toolbar" role="search">
      <label class="field grow">Search<input type="search" data-filter-input="q" value="${esc(f.q)}" placeholder="Title, employer or keyword"></label>
      <div class="field">Eligibility<div class="seg">${seg('elig', 'now', 'Can apply now')}${seg('elig', 'later', 'Later years')}${seg('elig', 'all', 'All')}</div></div>
      <details class="filters-more"${matchMedia('(max-width: 640px)').matches ? '' : ' open'}><summary>More filters</summary><div class="filters-more-body">
      <label class="field">Search type<select data-filter-select="track">${opt('all', 'Both', f.track)}${opt('summer', 'Summer 2027', f.track)}${opt('part_time', 'Part-time', f.track)}${opt('programme', 'Programme interest forms', f.track)}</select></label>
      <label class="field">Location<select data-filter-select="loc">${opt('mine', 'My locations', f.loc)}${opt('brainport', 'Eindhoven region', f.loc)}${opt('nl', 'Netherlands', f.loc)}${opt('remote', 'Remote', f.loc)}${opt('all', 'Anywhere', f.loc)}</select></label>
      <label class="field">Field<select data-filter-select="field">${opt('', 'All fields', f.field)}${FIELDS.map((x) => opt(x.id, x.label, f.field)).join('')}</select></label>
      <label class="field">Pay<select data-filter-select="pay">${opt('any', 'Any', f.pay)}${opt('paid', 'Paid (stated)', f.pay)}${opt('notunpaid', 'Not stated unpaid', f.pay)}</select></label>
      <label class="field">Status<select data-filter-select="status">${opt('live', 'Open', f.status)}${opt('all', 'Include closed', f.status)}</select></label>
      </div></details>
      <label class="field">Sort<select data-sort-select>${opt('match', 'Best match', S.sort.key)}${opt('newest', 'Newest', S.sort.key)}${opt('deadline', 'Nearest deadline', S.sort.key)}${opt('opening', 'Earliest opening', S.sort.key)}</select></label>
    </div>
    <div class="result-line"><span>${plural(list.length, 'role')}</span>
      ${hiddenElig ? `<span>${hiddenElig} hidden by eligibility: ${counts.unknown} not stated, ${counts.future} later years, ${counts.ineligible} not eligible. <button class="linkbtn" data-filter="elig" data-value="all">Show all</button></span>` : ''}
    </div>
    ${list.length ? oppTable(list, { sortable: true }) : emptyFor(f)}`;
}

function emptyFor(f) {
  if (!S.data.meta) return '<p class="empty"><strong>No data yet.</strong> Listings appear after the first refresh runs on GitHub.</p>';
  if (!S.data.items.length) return '<p class="empty"><strong>No student roles were found on the monitored sources.</strong> Check Sources and health for failures, or add more employers.</p>';
  return `<p class="empty"><strong>No roles match these filters.</strong> Try “Anywhere” for location, “All” for eligibility, or clear the search.</p>`;
}

function viewRemote() {
  const elig = eligNowSet();
  const remote = S.items.filter((o) => isLive(o) && o.location?.arrangement === 'remote');
  const groups = [
    ['NL', 'Remote, open to the Netherlands', 'The listing names the Netherlands.'],
    ['EU', 'Remote within Europe', 'Europe, the EU or EMEA is stated. Work-permit rules still apply per country.'],
    ['worldwide', 'Remote worldwide', 'Stated as worldwide or anywhere. Employer location, residency and contract rules can still restrict who is hired.'],
    ['unverified', 'Remote, location not stated', 'The listing says remote but not from where. Treat as unverified until the employer confirms.'],
    ['restricted_elsewhere', 'Remote, but restricted to another country', 'Shown for completeness; these exclude applicants based in the Netherlands.'],
  ];
  return `
    <div class="page-head"><div><h1>Remote</h1><p>Grouped by what each listing says about where you may work from. Nothing here is assumed to be legal to do from the Netherlands unless the listing says so.</p></div></div>
    ${groups.map(([key, title, note]) => {
      const list = sortList(remote.filter((o) => o.location.remoteRegion === key), 'match');
      const now = list.filter((o) => elig.has(o.eligibility?.label));
      return `<section class="section"><div class="section-head"><h2>${esc(title)} <span class="count">${list.length}</span></h2></div><p class="note" style="margin-bottom:8px">${esc(note)}${list.length !== now.length ? ` ${list.length - now.length} of these are outside your eligibility filter.` : ''}</p>${list.length ? oppTable(list) : '<p class="empty">None at the moment.</p>'}</section>`;
    }).join('')}`;
}

function viewPartTime() {
  const pt = S.prefs.partTime ?? {};
  const elig = eligNowSet();
  const list = S.items.filter((o) => isLive(o) && o.track === 'part_time' && o.locFit.compatible !== false && elig.has(o.eligibility?.label));
  const startKey = (o) => (o.startDate?.precision === 'asap' ? '0000' : o.startDate?.date ?? '9999');
  const sorted = [...list].sort((a, b) => startKey(a).localeCompare(startKey(b)) || b.match.score - a.match.score);
  const other = S.items.filter((o) => isLive(o) && o.track === 'part_time').length - list.length;
  return `
    <div class="page-head"><div><h1>Part-time now</h1><p>Working-student, research-assistant and part-time roles you could combine with your studies, earliest start first.</p></div></div>
    <div class="toolbar">
      <label class="field">Minimum hours per week<input type="number" min="1" max="40" data-pt="minHours" value="${esc(pt.minHours ?? 8)}" style="width:90px"></label>
      <label class="field">Maximum hours per week<input type="number" min="1" max="40" data-pt="maxHours" value="${esc(pt.maxHours ?? 16)}" style="width:90px"></label>
      <p class="note" style="align-self:center">Roles outside this range stay listed with a lower score. Roles that do not state hours are included and marked in the score breakdown.</p>
    </div>
    ${sorted.length ? oppTable(sorted) : '<p class="empty"><strong>No part-time roles match right now.</strong> Most part-time research jobs at TU/e are announced by departments rather than on public feeds: see the manual sources list.</p>'}
    ${other > 0 ? `<p class="note" style="margin-top:12px">${plural(other, 'more part-time role')} hidden by eligibility or location. <a href="#live" data-preset="parttime">See them in Opportunities</a>.</p>` : ''}`;
}

function viewRadar() {
  const progs = S.data.programmes.map((p) => ({ p, st: S.data.programmeStatus[p.id] })).filter((x) => x.st)
    .sort((a, b) => PROG_ORDER.indexOf(a.st.status) - PROG_ORDER.indexOf(b.st.status) || a.p.employer.localeCompare(b.p.employer));
  return `
    <div class="page-head"><div><h1>Opening radar</h1><p>Recurring programmes and when they open. Confirmed dates come from employer listings or announcements. Estimates come only from openings recorded in earlier years and are always shown hatched.</p></div></div>
    ${radarTimeline(S.data.programmes)}
    <section class="section"><h2>Programmes</h2>
      <div class="programmes">${progs.length ? progs.map(programmeCard).join('') : '<p class="empty">Programmes appear after the first refresh.</p>'}</div>
      <div class="callout info"><p><strong>How estimates get better.</strong> Each time Radar first sees a listing for a programme, it records that date as an observed opening for that year. Next year those dates become the estimate. You can also add dates you know about, with a source link, in <code>config/programmes.json</code> on GitHub.</p></div>
    </section>`;
}

function programmeCard({ p, st }) {
  const open = (st.openIds ?? []).map((id) => S.items.find((o) => o.id === id)).filter(Boolean);
  const ev = (st.evidence ?? []);
  return `<article class="programme">
    <header><div><h3>${esc(p.employer)}</h3><div class="sub">${esc(p.name)}</div></div><span class="pill ${PROG_CLASS[st.status]}">${esc(st.status)}</span></header>
    <p class="reason">${esc(st.reason)}</p>
    <dl>
      ${st.announced?.opening ? `<dt>Confirmed opening</dt><dd>${esc(fmtDay(st.announced.opening))} ${st.announced.sourceUrl ? link(st.announced.sourceUrl, '(source)') : ''}</dd>` : ''}
      ${st.announced?.deadline ? `<dt>Confirmed deadline</dt><dd>${esc(fmtDay(st.announced.deadline))}</dd>` : ''}
      ${st.prediction && st.status !== 'OPEN NOW' ? `<dt>Estimated window</dt><dd>${esc(fmtDay(st.prediction.from))} – ${esc(fmtDay(st.prediction.to))}, ${esc(st.prediction.confidence)} confidence, not confirmed</dd>` : ''}
      <dt>Rolling</dt><dd>${p.rolling === true ? 'Yes, roles are posted through the year' : p.rolling === false ? 'No, one application round' : 'Not known'}</dd>
      <dt>Last checked</dt><dd>${st.lastCheckedAt ? esc(fmtDateTime(st.lastCheckedAt)) : p.kind === 'manual' ? 'Not checked automatically' : '—'}</dd>
      <dt>Where to look</dt><dd>${p.url ? link(p.url, new URL(safeUrl(p.url) ?? 'https://invalid').hostname) : '—'}</dd>
    </dl>
    ${p.eligibilityNote ? `<div class="callout" style="margin:10px 0 0">${esc(p.eligibilityNote)}</div>` : ''}
    ${open.length ? `<details open><summary>${plural(open.length, 'open listing')}</summary><ul class="reasons">${open.map((o) => `<li><a href="#live/${encodeURIComponent(o.id)}" data-open="${esc(o.id)}">${esc(o.title)}</a> <span class="sub">${esc(o.location?.text ?? '')}</span></li>`).join('')}</ul></details>` : ''}
    <details><summary>Recruitment history (${ev.length ? plural(ev.length, 'record') : 'none yet'})</summary>
      ${ev.length ? `<ul class="reasons">${ev.map((e) => `<li>${esc(e.cycle)} cycle: ${e.precision === 'on_or_before' ? 'open on or before' : 'opened'} ${esc(fmtDay(e.openedOn))} ${e.sourceUrl ? link(e.sourceUrl, e.from === 'observed' ? '(first listing seen)' : '(source)') : ''}${e.note ? ` — ${esc(e.note)}` : ''}</li>`).join('')}</ul>` : '<p class="note">No earlier openings recorded, so no estimate is made.</p>'}
      ${st.prediction ? `<p class="note">Basis: ${st.prediction.basis.map(esc).join('; ')}</p>` : ''}
    </details>
  </article>`;
}

function viewSaved() {
  const saved = S.local.saved ?? {};
  const rows = Object.entries(saved).map(([id, t]) => ({ id, t, o: S.items.find((x) => x.id === id) }));
  rows.sort((a, b) => (a.t.followUp ?? '9999').localeCompare(b.t.followUp ?? '9999') || String(b.t.savedAt).localeCompare(String(a.t.savedAt)));
  const storageNote = S.storageOk ? '' : '<div class="callout error"><p>This browser is blocking local storage (private window or blocked site data), so saved roles will not be kept. Use a normal window.</p></div>';
  return `
    <div class="page-head"><div><h1>Saved and applied</h1><p>Your shortlist and application tracker. It lives only in this browser: nothing is uploaded. Export a backup to move it to another device.</p></div>
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-action="export-csv">Export CSV</button>
        <button class="btn" data-action="export-backup">Export backup</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" data-action="import-backup" hidden></label>
      </div></div>
    ${storageNote}
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Role</th><th>Stage</th><th>Deadline</th><th>Applied</th><th>Follow up</th><th class="hide-sm">Notes</th></tr></thead><tbody>
      ${rows.map(({ id, t, o }) => {
        const overdue = t.followUp && t.followUp <= TODAY;
        return `<tr data-open="${esc(id)}">
          <td><a class="role" href="#live/${encodeURIComponent(id)}" data-open="${esc(id)}">${esc(o?.title ?? t.title ?? id)}</a><span class="sub">${esc(o?.employer ?? t.employer ?? '')}${o && !isLive(o) ? ` · ${esc(STATUS_LABEL[o.status] ?? '')}` : ''}${!o ? ' · no longer listed' : ''}</span></td>
          <td>${esc(t.stage ?? 'Saved')}</td>
          <td>${o?.deadline?.date ? esc(formatDate(o.deadline.date, o.deadline.precision)) : '—'}</td>
          <td>${t.appliedAt ? esc(fmtDay(t.appliedAt)) : '—'}</td>
          <td class="${overdue ? 'date-urgent' : ''}">${t.followUp ? esc(fmtDay(t.followUp)) : '—'}</td>
          <td class="hide-sm sub">${esc((t.notes ?? '').slice(0, 80))}</td></tr>`;
      }).join('')}</tbody></table></div>` : '<p class="empty"><strong>Nothing saved yet.</strong> Use the bookmark button on any role to start a shortlist.</p>'}`;
}

function viewSources() {
  const auto = S.data.sources.filter((s) => s.type !== 'manual');
  const manual = S.data.sources.filter((s) => s.type === 'manual');
  const counts = {};
  for (const o of S.data.items) if (!o.closedAt) counts[o.sourceId] = (counts[o.sourceId] ?? 0) + 1;
  const healthPill = (st) => {
    const h = st?.health ?? 'unknown';
    const label = { healthy: 'Working', degraded: st?.lastStatus === 'partial' ? 'Partly checked' : 'Failed once', failing: 'Failing', blocked: 'Blocked by robots.txt', manual: 'Manual', disabled: 'Disabled', unknown: 'Not run yet' }[h] ?? h;
    return `<span class="pill ${h === 'healthy' ? 'healthy' : h}">${esc(label)}</span>`;
  };
  const repo = repoFromLocation();
  return `
    <div class="page-head"><div><h1>Sources and health</h1><p>Where Radar looks, how, and whether it worked. Listings from a failing source are kept but marked as not re-checked.</p></div>
      ${repo ? `<a class="btn primary" href="https://github.com/${esc(repo.owner)}/${esc(repo.repo)}/actions/workflows/radar.yml" target="_blank" rel="noopener">Run a refresh on GitHub</a>` : ''}</div>
    <section><h2 class="visually-hidden">Automatic sources</h2>
    <div class="table-wrap"><table><thead><tr><th>Employer</th><th>Method</th><th>Health</th><th>Last successful check</th><th>Student roles</th><th>Problem</th></tr></thead><tbody>
      ${auto.map((s) => { const st = S.data.sourceStatus[s.id]; return `<tr>
        <td>${link(s.publicUrl, s.employer)}${s.enabled === false ? ' <span class="sub">(disabled)</span>' : ''}</td>
        <td>${esc(METHOD[s.type] ?? s.type)}<div class="sub">daily</div></td>
        <td>${healthPill(st)}</td>
        <td>${st?.lastSuccessAt ? `${esc(fmtDateTime(st.lastSuccessAt))}<div class="sub">${esc(ago(st.lastSuccessAt))}</div>` : '—'}</td>
        <td>${counts[s.id] ?? 0}${st?.scanned != null ? `<div class="sub">of ${st.scanned} scanned</div>` : ''}</td>
        <td class="sub">${esc(st?.lastError ?? '')}${s.note ? `<div>${esc(s.note)}</div>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div></section>

    <section class="section"><h2>Check these by hand</h2>
      <p class="note" style="margin-bottom:10px">These employers offer no feed Radar may read. Radar only checks once a week that the link still works. Their own job-alert emails are the best way to hear about openings.</p>
      <div class="table-wrap"><table><thead><tr><th>Employer</th><th>Why it is manual</th><th>Link</th></tr></thead><tbody>
      ${manual.map((s) => { const st = S.data.sourceStatus[s.id] ?? {}; const linkState = st.linkOk === true ? 'Link works' : st.linkOk === false ? `Link failed: ${st.linkNote ?? ''}` : s.linkVerified === false ? 'Link not yet checked' : st.linkNote ?? ''; return `<tr>
        <td>${esc(s.employer)}</td><td class="sub">${esc(s.reason ?? '')}</td>
        <td>${link(s.publicUrl, 'Open')}<div class="sub">${esc(linkState)}${st.linkCheckedAt ? `, ${esc(fmtDay(st.linkCheckedAt))}` : ''}</div></td></tr>`; }).join('')}
      </tbody></table></div></section>

    <section class="section"><h2>Refresh log</h2>
      ${S.data.runs.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Trigger</th><th>Result</th><th>Sources</th><th>New</th><th>Changed</th><th>Closed</th><th>Errors</th></tr></thead><tbody>
      ${S.data.runs.slice(0, 30).map((r) => `<tr><td>${esc(fmtDateTime(r.startedAt))}</td><td>${esc({ schedule: 'Daily', workflow_dispatch: 'Manual', local: 'Local' }[r.trigger] ?? r.trigger)}</td>
        <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td><td>${r.sources.ok + r.sources.partial}/${r.sources.total} ok</td><td>${r.newCount}</td><td>${r.changedCount}</td><td>${r.closedCount}</td>
        <td class="sub">${r.errors.map((e) => `${esc(e.sourceId)}: ${esc(e.error)}`).join('<br>')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No refreshes have run yet.</p>'}
    </section>`;
}

// ---------------------------------------------------------------------------
// Settings

function viewSettings() {
  const p = S.prefs;
  const w = { ...DEFAULT_WEIGHTS, ...(p.weights ?? {}) };
  const sum = Object.values(w).reduce((a, b) => a + Number(b), 0);
  const chk = (path, label, checked) => `<label class="check"><input type="checkbox" data-pref="${path}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  const num = (path, label, value, attrs = '') => `<label class="field">${label}<input type="number" data-pref="${path}" value="${esc(value)}" ${attrs}></label>`;
  const date = (path, label, value) => `<label class="field">${label}<input type="date" data-pref="${path}" value="${esc(value)}"></label>`;
  const elig = new Set(p.eligibility?.show ?? []);
  return `
    <div class="page-head"><div><h1>Settings</h1><p>Changes apply immediately and are kept in this browser. To make them the default on every device, download preferences.json and replace the file in the repository’s config folder.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-action="download-prefs">Download preferences.json</button><button class="btn" data-action="reset-prefs">Reset to repository defaults</button></div></div>
    <form class="settings" data-settings onsubmit="return false">
      <fieldset><legend>You</legend><div class="row">
        <label class="field">Degree level<select data-pref="profile.degreeLevel">${['bachelor', 'master', 'phd'].map((v) => `<option value="${v}"${p.profile?.degreeLevel === v ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
        ${num('profile.studyYear', 'Year of study now', p.profile?.studyYear ?? 1, 'min="1" max="6" style="width:90px"')}
        ${num('profile.academicYearStart', 'Academic year started (September)', p.profile?.academicYearStart ?? 2026, 'min="2020" max="2035" style="width:110px"')}
        ${num('profile.expectedGraduationYear', 'Expected graduation year', p.profile?.expectedGraduationYear ?? 2029, 'min="2024" max="2035" style="width:110px"')}
      </div>
      <label class="field" style="margin-top:10px">Skills you have (comma separated, used for the skills score)<input type="text" data-pref="profile.skills" data-list value="${esc((p.profile?.skills ?? []).join(', '))}"></label>
      <p class="note" style="margin-top:6px">Eligibility uses these to compare against stated year-of-study and graduation-year requirements. Work permits and residency are never assumed.</p></fieldset>

      <fieldset><legend>Summer internship window</legend><div class="row">${date('summer.from', 'From', p.summer?.from ?? '2027-07-01')}${date('summer.to', 'To', p.summer?.to ?? '2027-09-30')}</div></fieldset>
      <fieldset><legend>Part-time during the year</legend><div class="row">${num('partTime.minHours', 'Minimum hours per week', p.partTime?.minHours ?? 8, 'min="1" max="40" style="width:90px"')}${num('partTime.maxHours', 'Maximum hours per week', p.partTime?.maxHours ?? 16, 'min="1" max="40" style="width:90px"')}</div></fieldset>

      <fieldset><legend>Locations</legend><div class="checks">
        ${chk('locations.netherlands', 'On site anywhere in the Netherlands', p.locations?.netherlands !== false)}
        ${chk('locations.hybridNL', 'Hybrid in the Netherlands', p.locations?.hybridNL !== false)}
        ${chk('locations.preferBrainport', 'Rank the Eindhoven/Brainport region higher', !!p.locations?.preferBrainport)}
        ${chk('locations.remoteNL', 'Remote, open to the Netherlands', p.locations?.remoteNL !== false)}
        ${chk('locations.remoteEurope', 'Remote within Europe/EU', p.locations?.remoteEurope !== false)}
        ${chk('locations.remoteWorldwide', 'Remote worldwide (check residency terms)', !!p.locations?.remoteWorldwide)}
        ${chk('locations.europeOnsite', 'On site elsewhere in Europe', !!p.locations?.europeOnsite)}
      </div></fieldset>

      <fieldset><legend>Technical fields</legend><div class="checks">
        ${FIELDS.map((f) => chk(`fields:${f.id}`, f.label, (p.fields ?? []).includes(f.id))).join('')}
      </div><p class="note" style="margin-top:6px">Roles that combine computer science with physics, ML, imaging, robotics, quantum or hardware get a bonus.</p></fieldset>

      <fieldset><legend>Eligibility shown as “Can apply now”</legend><div class="checks">
        ${['eligible', 'potential', 'unknown'].map((k) => chk(`elig:${k}`, ELIGIBILITY_LABELS[k], elig.has(k))).join('')}
      </div><p class="note" style="margin-top:6px">Roles for later years are always kept, under “Later years”. Roles with a confirmed requirement you do not meet are only shown under “All”.</p></fieldset>

      <fieldset><legend>Pay</legend><div class="checks">
        ${chk('compensation.paidPreferred', 'Prefer paid roles', p.compensation?.paidPreferred !== false)}
        ${chk('compensation.allowUnpaidResearch', 'Unpaid research roles are acceptable', p.compensation?.allowUnpaidResearch !== false)}
      </div></fieldset>

      <fieldset><legend>Match score weights</legend>
        <div class="weights">${Object.keys(DEFAULT_WEIGHTS).map((k) => `<label><span>${esc({ technical: 'Technical fit', eligibility: 'Eligibility', location: 'Location', schedule: 'Dates and hours', skills: 'Skills', compensation: 'Pay' }[k])}</span><input type="range" min="0" max="60" step="1" data-pref="weights.${k}" value="${esc(w[k])}"><output>${esc(w[k])}</output></label>`).join('')}</div>
        <p class="note" style="margin-top:6px">Weights are relative; they currently add up to ${sum} and are scaled to 100.</p>
      </fieldset>

      <fieldset><legend>Dashboard alerts</legend><div class="row">
        ${num('alerts.minScore', 'Minimum match score', p.alerts?.minScore ?? 50, 'min="0" max="100" style="width:90px"')}
        ${num('alerts.deadlineDays', 'Warn about deadlines within (days)', p.alerts?.deadlineDays ?? 14, 'min="1" max="60" style="width:90px"')}
        ${num('alerts.openingDays', 'Warn about openings within (days)', p.alerts?.openingDays ?? 14, 'min="1" max="60" style="width:90px"')}
      </div><div class="checks" style="margin-top:8px">
        ${chk('alerts.types.new', 'New relevant roles', p.alerts?.types?.new !== false)}
        ${chk('alerts.types.opened', 'Programmes that open', p.alerts?.types?.opened !== false)}
        ${chk('alerts.types.openingSoon', 'Confirmed openings coming up', p.alerts?.types?.openingSoon !== false)}
        ${chk('alerts.types.deadline', 'Deadlines coming up', p.alerts?.types?.deadline !== false)}
        ${chk('alerts.types.changed', 'Deadline or status changes', p.alerts?.types?.changed !== false)}
        ${chk('alerts.types.sourceRecovered', 'A failing source works again', p.alerts?.types?.sourceRecovered !== false)}
      </div>
      <p class="note" style="margin-top:8px">Alerts appear on the Overview page. Email is not set up; see SETUP.md if you want daily emails later.</p></fieldset>

      <fieldset><legend>Appearance</legend><div class="row"><label class="field">Theme<select data-theme-select>${['auto', 'light', 'dark'].map((v) => `<option value="${v}"${(S.local.theme ?? 'auto') === v ? ' selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label></div></fieldset>
    </form>`;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (const k of parts.slice(0, -1)) o = (o[k] ??= {});
  o[parts.at(-1)] = value;
}

function onSettingChange(el) {
  const key = el.dataset.pref;
  const settings = deepMerge(S.prefs, {}); // full current copy
  if (key.startsWith('fields:')) {
    const id = key.slice(7);
    const set = new Set(settings.fields ?? []);
    el.checked ? set.add(id) : set.delete(id);
    settings.fields = FIELDS.map((f) => f.id).filter((f) => set.has(f));
  } else if (key.startsWith('elig:')) {
    const id = key.slice(5);
    const set = new Set(settings.eligibility?.show ?? []);
    el.checked ? set.add(id) : set.delete(id);
    setPath(settings, 'eligibility.show', ['eligible', 'potential', 'unknown'].filter((x) => set.has(x)));
  } else if (el.type === 'checkbox') setPath(settings, key, el.checked);
  else if (el.type === 'number' || el.type === 'range') {
    const n = Number(el.value);
    if (!Number.isFinite(n)) return;
    setPath(settings, key, n);
    if (el.type === 'range') el.nextElementSibling.textContent = n;
  } else if (el.dataset.list !== undefined) setPath(settings, key, el.value.split(',').map((s) => s.trim()).filter(Boolean));
  else setPath(settings, key, el.value);
  // Store only what differs from the repository defaults' shape: simplest is the whole object.
  S.local.settings = settings;
  persist();
  recompute();
  renderStatus();
  updateCounts();
}

// ---------------------------------------------------------------------------
// Detail drawer

async function openDetail(id) {
  const o = S.items.find((x) => x.id === id);
  const drawer = $('#drawer');
  if (!o) {
    drawer.innerHTML = `<button class="btn small drawer-close" data-action="close-drawer">Close</button><h2 id="drawer-title">Not found</h2><p class="empty">This role is no longer in the data. It may have been removed more than 120 days ago.</p>`;
  } else {
    drawer.innerHTML = detailHTML(o, null);
    loadDetails().then((d) => {
      if ($('#drawer').dataset.id === id) {
        const box = $('#desc-box');
        if (box) box.innerHTML = d[id]?.text ? `<div class="desc">${esc(d[id].text)}</div><p class="note" style="margin-top:6px">Text as fetched ${esc(fmtDateTime(d[id].fetchedAt))}. The official listing is the authority.</p>` : '<p class="empty">Full text not stored for this role.</p>';
      }
    });
  }
  drawer.dataset.id = id;
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  $('#drawer-backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => drawer.querySelector('.drawer-close')?.focus(), 30);
}

function closeDetail() {
  const drawer = $('#drawer');
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  $('#drawer-backdrop').hidden = true;
  document.body.style.overflow = '';
  const opened = drawer.dataset.id;
  drawer.dataset.id = '';
  if (location.hash.startsWith('#live/')) history.replaceState(null, '', '#live');
  if (opened) document.querySelector(`[data-open="${CSS.escape(opened)}"]`)?.focus();
}

function detailHTML(o) {
  const e = o.eligibility ?? {};
  const req = e.requirements ?? {};
  const t = S.local.saved?.[o.id];
  const hist = S.data.events.filter((ev) => ev.id === o.id).slice(0, 12);
  const comp = o.compensation ?? {};
  const compText = comp.status === 'paid' ? (comp.amount ? `Paid: ${comp.currency ?? ''} ${comp.amount}${comp.amountMax ? `–${comp.amountMax}` : ''}${comp.period ? ` per ${comp.period}` : ''}` : 'Paid (amount not stated)') : comp.status === 'unpaid' ? 'Unpaid (stated)' : 'Not stated';
  const hours = o.hours ? `${o.hours.min ?? '?'}–${o.hours.max ?? '?'} hours per week${o.hours.derivedFromDays ? ' (from days per week)' : ''}` : 'Not stated';
  const dur = o.duration ? `${o.duration.minMonths ?? '?'}${o.duration.maxMonths && o.duration.maxMonths !== o.duration.minMonths ? `–${o.duration.maxMonths}` : ''} months${o.duration.maxMonths == null ? ' minimum' : ''}` : 'Not stated';
  const degreeTxt = req.degreeLevels?.length ? req.degreeLevels.map((d) => ({ bachelor: 'Bachelor’s', master: 'Master’s', phd: 'PhD' })[d]).join(', ') + ' mentioned' : 'Not stated';
  const yearTxt = [req.minStudyYear ? `year ${req.minStudyYear}+` : null, req.minCompletedYears ? `${req.minCompletedYears} completed year(s)` : null, req.graduationYears?.length ? `graduating ${req.graduationYears.join('/')}` : null, req.finalYearOnly ? 'final-year students' : null].filter(Boolean).join('; ') || 'Not stated';
  const firstYear = { yes: 'Appears eligible', no: 'No, per stated requirements', unclear: 'Unclear: ask the employer' }[e.firstYearEligible ?? 'unclear'];
  const stageOpts = APP_STAGES.map((s) => `<option${(t?.stage ?? 'Saved') === s ? ' selected' : ''}>${s}</option>`).join('');
  return `
    <button class="btn small drawer-close" data-action="close-drawer">Close</button>
    <h2 id="drawer-title">${esc(o.title)}</h2>
    <p class="employer">${esc(o.employer)}${o.department ? ` · ${esc(o.department)}` : ''}</p>
    <div class="tags" style="margin-top:8px"><span class="pill ${STATUS_CLASS[o.status] ?? 'unknown'}">${esc(STATUS_LABEL[o.status] ?? o.status)}</span>${eligPill(o)}${o.stale ? `<span class="tag stale">Not re-checked since ${esc(fmtDay(o.lastVerifiedAt))}</span>` : ''}</div>
    <div class="actions">
      ${safeUrl(o.applyUrl) ? `<a class="btn primary" href="${esc(safeUrl(o.applyUrl))}" target="_blank" rel="noopener noreferrer">Open official listing</a>` : ''}
      <button class="btn" data-action="toggle-save" data-id="${esc(o.id)}" aria-pressed="${!!t}">${t ? 'Saved' : 'Save'}</button>
    </div>
    ${o.summary ? `<p>${esc(o.summary)}</p>` : ''}

    <section><h3>Key facts</h3><dl class="facts">
      <dt>Type</dt><dd>${esc(EMPLOYMENT_TYPES[o.type] ?? 'Student role')}; ${esc({ summer: 'summer internship search', part_time: 'part-time search', programme: 'programme interest form' }[o.track])}</dd>
      <dt>Location</dt><dd>${esc(o.location?.text || 'Not stated')}</dd>
      <dt>Working arrangement</dt><dd>${esc(ARR[o.location?.arrangement] ?? 'Not stated')}${o.location?.arrangement === 'remote' ? `, from ${esc(REMOTE_REGION[o.location.remoteRegion] ?? 'not stated')}` : ''}</dd>
      <dt>Weekly hours</dt><dd>${esc(hours)}</dd>
      <dt>Duration</dt><dd>${esc(dur)}</dd>
      <dt>Start</dt><dd>${o.startDate ? `${esc(formatDate(o.startDate.date, o.startDate.precision))} <span class="sub">(${esc(o.startDate.evidence ?? '')})</span>` : 'Not stated'}</dd>
      <dt>Application deadline</dt><dd>${o.deadline ? `${esc(formatDate(o.deadline.date, o.deadline.precision))} <span class="sub">(${esc(o.deadline.evidence ?? '')})</span>` : 'Not stated'}</dd>
      <dt>Published / opened</dt><dd>${o.openingDate ? `${esc(fmtDay(o.openingDate.date))} <span class="sub">(${esc(o.openingDate.evidence ?? '')})</span>` : 'Not stated'}</dd>
      <dt>Pay</dt><dd>${esc(compText)}${comp.evidence ? ` <span class="sub">(“${esc(comp.evidence.slice(0, 120))}”)</span>` : ''}</dd>
      <dt>Fields</dt><dd>${(o.fields ?? []).map((f) => esc(FIELD_LABELS[f])).join(', ') || 'None recognised'}</dd>
      <dt>Skills asked for</dt><dd>${o.skills?.required?.length ? esc(o.skills.required.join(', ')) : 'None recognised'}${o.skills?.preferred?.length ? `<div class="sub">Nice to have: ${esc(o.skills.preferred.join(', '))}</div>` : ''}</dd>
    </dl></section>

    <section><h3>Eligibility</h3><dl class="facts">
      <dt>Assessment</dt><dd>${esc(ELIGIBILITY_LABELS[e.label ?? 'unknown'])}</dd>
      <dt>Degree level</dt><dd>${esc(degreeTxt)}</dd>
      <dt>Study or graduation year</dt><dd>${esc(yearTxt)}</dd>
      <dt>First-year Bachelor’s</dt><dd>${esc(firstYear)}</dd>
      ${req.experienceYears ? `<dt>Experience</dt><dd>${esc(req.experienceYears)}+ years mentioned</dd>` : ''}
    </dl>
    <ul class="reasons" style="margin-top:8px">${(e.reasons ?? []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${o.restrictions?.length ? `<div class="callout"><p><strong>Work permit, residency or enrolment terms stated by the employer.</strong> Check these yourself; Radar does not assess your situation.</p>${o.restrictions.map((r) => `<p>“${esc(r)}”</p>`).join('')}</div>` : '<p class="note" style="margin-top:8px">No work-permit or residency terms were found in the text. That does not mean there are none: confirm with the employer.</p>'}
    </section>

    <section><h3>Match ${o.match.score}/100 <span class="sub">(${esc(o.match.confidence)} confidence)</span></h3><div class="breakdown">
      ${o.match.breakdown.map((b) => `<div class="breakdown-row"><span>${esc(b.label)}</span><span class="bar ${b.known ? '' : 'unknown'}"><span style="width:${b.max ? (b.points / b.max) * 100 : 0}%"></span></span><span class="sub">${b.points}/${b.max}</span><span class="why">${esc(b.why)}${b.known ? '' : ' (not stated, scored as neutral)'}</span></div>`).join('')}
    </div></section>

    ${t ? `<section><h3>Your application</h3><div class="tracker" data-tracker="${esc(o.id)}">
      <label class="field">Stage<select data-track="stage">${stageOpts}</select></label>
      <label class="field">Date applied<input type="date" data-track="appliedAt" value="${esc(t.appliedAt ?? '')}"></label>
      <label class="field">Follow up on<input type="date" data-track="followUp" value="${esc(t.followUp ?? '')}"></label>
      <label class="field">Outcome<input type="text" data-track="outcome" value="${esc(t.outcome ?? '')}" placeholder="e.g. offer, rejected after interview"></label>
      <label class="field full">Interview dates and notes<textarea data-track="interviews" placeholder="One per line, e.g. 2026-11-20 technical interview">${esc(t.interviews ?? '')}</textarea></label>
      <label class="field full">Notes<textarea data-track="notes">${esc(t.notes ?? '')}</textarea></label>
      <p class="note full">Saved in this browser only.</p>
    </div></section>` : ''}

    <section><h3>Sources and history</h3><dl class="facts">
      <dt>First seen</dt><dd>${esc(fmtDateTime(o.firstSeenAt))}</dd>
      <dt>Last confirmed online</dt><dd>${esc(fmtDateTime(o.lastVerifiedAt))}</dd>
      <dt>Evidence</dt><dd>${(o.evidenceUrls ?? []).map((u) => link(u, (safeUrl(u) ? new URL(u).hostname : u))).join('<br>')}</dd>
    </dl>
    ${hist.length ? `<ul class="reasons" style="margin-top:8px">${hist.map((h) => `<li>${esc(fmtDay(h.at))}: ${esc(h.type === 'new' ? 'First found' : h.type === 'closed' ? `Closed (${h.reason ?? ''})` : `${h.field ?? h.type} changed from ${h.from ?? 'not set'} to ${h.to ?? 'not set'}`)}</li>`).join('')}</ul>` : ''}
    </section>

    <section><h3>Full text</h3><div id="desc-box"><p class="note">Loading…</p></div></section>`;
}

function toggleSave(id) {
  S.local.saved ??= {};
  if (S.local.saved[id]) {
    const t = S.local.saved[id];
    if ((t.notes || t.appliedAt || (t.stage && t.stage !== 'Saved')) && !confirm('Remove this role and its notes from your tracker?')) return;
    delete S.local.saved[id];
  } else {
    const o = S.items.find((x) => x.id === id);
    S.local.saved[id] = { savedAt: new Date().toISOString(), stage: 'Saved', title: o?.title, employer: o?.employer, url: o?.applyUrl };
  }
  persist();
  recompute();
  route();
  if ($('#drawer').dataset.id === id) openDetail(id);
  updateCounts();
}

// ---------------------------------------------------------------------------
// Export / import

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function exportCSV() {
  const cols = ['Employer', 'Role', 'Stage', 'Date saved', 'Date applied', 'Follow up', 'Deadline', 'Status', 'Match', 'Eligibility', 'Location', 'Official link', 'Interviews', 'Outcome', 'Notes'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(q).join(',')];
  for (const [id, t] of Object.entries(S.local.saved ?? {})) {
    const o = S.items.find((x) => x.id === id);
    lines.push([o?.employer ?? t.employer, o?.title ?? t.title, t.stage, t.savedAt?.slice(0, 10), t.appliedAt, t.followUp, o?.deadline?.date, o ? STATUS_LABEL[o.status] : 'No longer listed', o?.match.score, o ? ELIG_SHORT[o.eligibility?.label] : '', o?.location?.text, o?.applyUrl ?? t.url, t.interviews, t.outcome, t.notes].map(q).join(','));
  }
  download(`internship-radar-applications-${TODAY}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

function exportBackup() {
  download(`internship-radar-backup-${TODAY}.json`, JSON.stringify({ app: 'internship-radar', version: 1, exportedAt: new Date().toISOString(), saved: S.local.saved ?? {}, settings: S.local.settings ?? null }, null, 1), 'application/json');
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'internship-radar' || typeof data.saved !== 'object') throw new Error('Not an Internship Radar backup file.');
    const merged = { ...(S.local.saved ?? {}) };
    let added = 0;
    for (const [id, t] of Object.entries(data.saved)) {
      if (typeof id !== 'string' || typeof t !== 'object' || !t) continue;
      const clean = Object.fromEntries(Object.entries(t).filter(([k, v]) => ['savedAt', 'stage', 'title', 'employer', 'url', 'appliedAt', 'followUp', 'outcome', 'interviews', 'notes'].includes(k) && (typeof v === 'string' || v == null)));
      if (!merged[id]) added++;
      merged[id] = { ...merged[id], ...clean };
    }
    S.local.saved = merged;
    if (data.settings && typeof data.settings === 'object' && confirm('The backup also contains settings. Replace your current settings with them?')) S.local.settings = data.settings;
    persist();
    recompute();
    route();
    updateCounts();
    toast(`Imported. ${plural(added, 'new role')} added to your tracker.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Routing and events

const VIEWS = { overview: viewOverview, live: viewLive, radar: viewRadar, remote: viewRemote, parttime: viewPartTime, saved: viewSaved, sources: viewSources, settings: viewSettings };

function route() {
  const [name, arg] = location.hash.replace(/^#/, '').split('/');
  const view = VIEWS[name] ? name : 'overview';
  const main = $('#main');
  const keepFocus = document.activeElement?.dataset?.filterInput;
  main.innerHTML = VIEWS[view]();
  for (const a of document.querySelectorAll('.rail nav a')) a.toggleAttribute('aria-current', a.dataset.view === view) && a.setAttribute('aria-current', 'page');
  document.title = `${{ overview: 'Overview', live: 'Opportunities', radar: 'Opening radar', remote: 'Remote', parttime: 'Part-time now', saved: 'Saved and applied', sources: 'Sources and health', settings: 'Settings' }[view]} · Internship Radar`;
  if (keepFocus) {
    const input = main.querySelector(`[data-filter-input="${keepFocus}"]`);
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
  if (view === 'live' && arg) openDetail(decodeURIComponent(arg));
}

function updateCounts() {
  const elig = eligNowSet();
  const n = S.items.filter((o) => isLive(o) && elig.has(o.eligibility?.label) && o.locFit.compatible !== false).length;
  const set = (k, v) => { const el = document.querySelector(`[data-count="${k}"]`); if (el) el.textContent = v ? String(v) : ''; };
  set('live', n);
  set('saved', Object.keys(S.local.saved ?? {}).length);
}

function applyTheme() {
  const t = S.local.theme ?? 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

let searchTimer = null;
function bind() {
  window.addEventListener('hashchange', () => {
    if ($('#drawer').classList.contains('is-open') && !location.hash.startsWith('#live/')) closeDetail();
    route();
    if (!location.hash.startsWith('#live/')) $('#main').focus({ preventScroll: true });
  });
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-action],[data-open],[data-filter],[data-sort],[data-preset]');
    if (!t) return;
    if (t.dataset.action === 'toggle-save') { ev.stopPropagation(); toggleSave(t.dataset.id); return; }
    if (t.dataset.action === 'close-drawer') { closeDetail(); return; }
    if (t.dataset.action === 'mark-seen') { S.local.seenUntil = new Date().toISOString(); persist(); recompute(); route(); return; }
    if (t.dataset.action === 'export-csv') { exportCSV(); return; }
    if (t.dataset.action === 'export-backup') { exportBackup(); return; }
    if (t.dataset.action === 'download-prefs') { download('preferences.json', JSON.stringify(S.prefs, null, 2) + '\n', 'application/json'); return; }
    if (t.dataset.action === 'reset-prefs') { if (confirm('Discard your browser settings and use the repository defaults?')) { delete S.local.settings; persist(); recompute(); route(); } return; }
    if (t.dataset.preset === 'parttime') { S.filters = { ...S.filters, track: 'part_time', elig: 'all', loc: 'all' }; S.local.filters = S.filters; persist(); return; }
    if (t.dataset.filter) { S.filters[t.dataset.filter] = t.dataset.value; S.local.filters = S.filters; persist(); route(); return; }
    if (t.dataset.sort) {
      const key = t.dataset.sort;
      S.sort = { key, dir: S.sort.key === key && S.sort.dir === 'desc' ? 'asc' : key === 'deadline' || key === 'title' ? 'asc' : 'desc' };
      route();
      return;
    }
    if (t.dataset.open) {
      if (ev.metaKey || ev.ctrlKey || ev.target.closest('a[target="_blank"]')) return;
      ev.preventDefault();
      history.pushState(null, '', `#live/${encodeURIComponent(t.dataset.open)}`);
      openDetail(t.dataset.open);
    }
  });
  $('#drawer-backdrop').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('#drawer').classList.contains('is-open')) closeDetail(); });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.filterInput) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { S.filters[el.dataset.filterInput] = el.value; S.local.filters = S.filters; persist(); route(); }, 160);
    } else if (el.dataset.pref && el.type === 'range') onSettingChange(el);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.filterSelect) { S.filters[el.dataset.filterSelect] = el.value; S.local.filters = S.filters; persist(); route(); }
    else if (el.matches('[data-sort-select]')) { S.sort = { key: el.value, dir: el.value === 'deadline' ? 'asc' : 'desc' }; route(); }
    else if (el.dataset.pref && el.type !== 'range') { onSettingChange(el); }
    else if (el.matches('[data-theme-select]')) { S.local.theme = el.value; persist(); applyTheme(); }
    else if (el.dataset.pt) { const n = Number(el.value); if (Number.isFinite(n)) { S.local.settings = deepMerge(S.prefs, { partTime: { [el.dataset.pt]: n } }); persist(); recompute(); route(); } }
    else if (el.dataset.action === 'import-backup' && el.files?.[0]) importBackup(el.files[0]);
    else if (el.dataset.track) {
      const id = el.closest('[data-tracker]').dataset.tracker;
      S.local.saved[id] = { ...S.local.saved[id], [el.dataset.track]: el.value };
      if (el.dataset.track === 'stage' && el.value === 'Applied' && !S.local.saved[id].appliedAt) S.local.saved[id].appliedAt = TODAY;
      persist();
      toast('Saved in this browser');
    }
  });
}

async function main() {
  applyTheme();
  try {
    S.data = await loadData();
  } catch (err) {
    $('#main').innerHTML = `<div class="callout error"><p><strong>The data files could not be loaded.</strong> ${esc(err.message)}</p></div>`;
    return;
  }
  recompute();
  renderStatus();
  updateCounts();
  bind();
  route();
}

main();
