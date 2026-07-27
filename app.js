// Renders status.json, which the scheduled workflow regenerates.
// ponytail: no API calls, no token, no framework — the browser reads one file.

const STATUS_URL = 'status.json';
const RELOAD_MS = 60_000; // status.json only changes every 5 min; this just re-reads it

// ---------- pure helpers (covered by test.mjs) ----------

const RANK = { failure: 0, running: 1, queued: 2, neutral: 3, skipped: 3.5, success: 4 };

/** Tooltip text for one pipeline stage (a job). Shown by the native title attr. */
export function stageTip(stage) {
  const bits = [stage.name, stage.state];
  if (stage.failed_step) bits.push(`failed at: ${stage.failed_step}`);
  if (stage.duration != null) bits.push(stage.duration >= 60 ? `${Math.round(stage.duration / 60)}m` : `${stage.duration}s`);
  return bits.join(' · ');
}

/**
 * A repo's state is its most recent run's state: green if the last thing that ran
 * passed. Older workflows that are still red stay visible as red rows and in the
 * failures roll-up, but they no longer colour the whole repo.
 */
export function latestState(workflows) {
  const newest = (workflows ?? []).reduce(
    (best, w) => (!best || new Date(w.finished_at) > new Date(best.finished_at) ? w : best), null);
  return newest?.state ?? 'neutral';
}

/** Headline counts: a repo is failed/running/healthy by its most recent run. */
export function summarize(repos) {
  const counts = { healthy: 0, failed: 0, running: 0, unknown: 0 };
  for (const r of repos || []) {
    const state = r.error ? 'error' : latestState(r.workflows);
    if (state === 'failure') counts.failed++;
    else if (state === 'running' || state === 'queued') counts.running++;
    else if (state === 'success') counts.healthy++;
    else counts.unknown++;
  }
  return counts;
}

/** Failed workflows across all repos, worst-first, for the "recent failures" list. */
export function failures(repos) {
  return (repos || []).flatMap((r) => (r.workflows || [])
    .filter((w) => w.state === 'failure')
    .map((w) => ({ ...w, repo: r.repo })))
    .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));
}

/**
 * What a repo's band is set to: the saved per-repo selection if there is one,
 * otherwise whatever the fetcher collected. Empty list means "everything".
 */
export function selectionFor(repo, saved = {}) {
  const mine = saved[repo.repo] ?? {};
  return {
    branches: mine.branches ?? repo.branches ?? [],
    workflows: mine.workflows ?? repo.selected ?? [],
  };
}

/**
 * Branch/workflow selections define repository health. Search and "failures only"
 * only narrow the visible rows, so view filters cannot recolour a repository.
 */
export function applyFilters(repos, { q = '', failuresOnly = false, repositories = null, saved = {} } = {}) {
  const needle = q.trim().toLowerCase();
  return (repos ?? [])
    .filter((r) => repositories === null || repositories.some((name) =>
      name.toLowerCase() === r.repo.toLowerCase()))
    .map((r) => {
      const repoHit = r.repo.toLowerCase().includes(needle);
      const sel = selectionFor(r, saved);
      const pick = (list, value) => list.length === 0 || list.some((x) =>
        String(x).toLowerCase() === String(value ?? '').toLowerCase());
      const selected = (r.workflows ?? []).filter((w) =>
        pick(sel.branches, w.branch) && pick(sel.workflows, w.name));
      const visible = selected.filter((w) =>
        (!needle || repoHit || w.name.toLowerCase().includes(needle))
        && (!failuresOnly || w.state === 'failure'));
      return {
        ...r,
        state: r.error ? 'neutral' : latestState(selected),
        selection: sel,
        hidden: (r.workflows ?? []).length - visible.length,
        workflows: visible,
      };
    })
    .filter((r) => {
      if (failuresOnly) return r.workflows.length > 0;
      return !needle || r.repo.toLowerCase().includes(needle) || r.workflows.length > 0;
    });
}

/**
 * The saved selections as a config.json-shaped object, ready to become
 * config.local.json so the *fetcher* honours it on the next refresh too.
 */
export function buildConfig(repos, saved = {}) {
  return {
    _comment: 'Written by the dashboard\'s Save button. Git-ignored; edit either here or in the UI.',
    repos: (repos ?? []).map((r) => {
      const sel = selectionFor(r, saved);
      return { repo: r.repo, branches: sel.branches, workflows: sel.workflows };
    }),
  };
}

/** The config-level filters in force, so the page shows what it is watching. */
export function configSummary(repos) {
  const uniq = (xs) => [...new Set(xs)].sort();
  const branches = uniq((repos ?? []).flatMap((r) => r.branches ?? []));
  const workflows = uniq((repos ?? []).flatMap((r) => r.selected ?? []));
  return `branches: ${branches.join(', ') || 'all'} · workflows: ${workflows.join(', ') || 'all'}`;
}

export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso)) / 1000);
  for (const [suffix, size] of [['d', 86400], ['h', 3600], ['m', 60]]) {
    if (s >= size) return `${Math.floor(s / size)}${suffix} ago`;
  }
  return `${Math.floor(s)}s ago`;
}

// ---------- render ----------

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICON = { success: '🟢', failure: '🔴', running: '🟡', queued: '🟡', neutral: '⚪️' };

/** The horizontal dots: one per pipeline stage, hover for detail, click to open it. */
function stageDots(stages) {
  if (!stages?.length) return '';
  return `<span class="stages">${stages.map((s) => `<a class="dot ${esc(s.state)}"
    href="${esc(s.url)}" target="_blank" rel="noopener"
    title="${esc(stageTip(s))}" aria-label="${esc(stageTip(s))}"></a>`).join('')}</span>`;
}

function workflowRow(w) {
  const meta = [w.branch, w.sha, w.author, w.finished_at && ago(w.finished_at)].filter(Boolean);
  return `<div class="run ${esc(w.state)}">
    <span class="icon">${ICON[w.state] || ICON.neutral}</span>
    <a class="name" href="${esc(w.url)}" target="_blank" rel="noopener"
       title="${esc(w.message || '')}">${esc(w.name)}</a>
    ${stageDots(w.stages)}
    <span class="meta">${esc(meta.join(' · '))}</span>
  </div>`;
}

const NOW_LABEL = { success: 'all green', failure: 'failing', running: 'running', queued: 'queued', skipped: 'skipped', neutral: 'unknown' };

/** What this card is actually watching, for the "now" cell. */
export function scope(r) {
  const branches = (r.branches ?? []).join(', ') || 'all branches';
  return r.selected?.length ? `${r.selected.join(', ')} · ${branches}` : branches;
}

/** The horizontal strip: failures over 24h / 7d, then the current state. */
function statsStrip(r, state) {
  const s = r.stats;
  if (!s) return '';
  const cell = (label, w) => `<span class="stat">
    <em>${label}</em>
    <b class="${w.failures ? 'bad' : ''}">${w.failures ? `🔴 ${w.failures}` : '🟢 0'}</b>
    <i>of ${w.runs} run${w.runs === 1 ? '' : 's'}</i></span>`;
  return `<div class="stats" title="${s.truncated ? 'based on the newest 100 runs per branch' : ''}">
    ${cell('24h', s.day)}${cell('7d', s.week)}
    <span class="stat"><em>now</em><b>${ICON[state] || ICON.neutral} ${NOW_LABEL[state] || state}</b>
    <i title="${esc(scope(r))}">${esc(scope(r))}</i></span>
    ${r.release ? `<span class="stat"><em>release</em>
      <b><a href="${esc(r.release.url)}" target="_blank" rel="noopener">${esc(r.release.version)}</a></b>
      <i>${esc(new Date(r.release.published_at).toLocaleDateString(undefined, { dateStyle: 'medium' }))}</i>
    </span>` : ''}
  </div>`;
}

/** A native dropdown: <details> + checkboxes. No library, keyboard-accessible. */
function dropdown(repo, kind, options, chosen) {
  const label = chosen.length === 0 ? `all ${kind}` : chosen.join(', ');
  const items = options.length === 0
    ? `<p class="muted">none found</p>`
    : options.map((name) => `<label><input type="checkbox" data-repo="${esc(repo)}"
        data-kind="${esc(kind)}" value="${esc(name)}"
        ${chosen.some((c) => c.toLowerCase() === name.toLowerCase()) ? 'checked' : ''}>
        ${esc(name)}</label>`).join('');
  return `<details class="dd" data-dd="${esc(repo)}:${esc(kind)}">
    <summary title="${esc(label)}"><span class="dd-kind">${kind}</span> ${esc(label)}</summary>
    <div class="menu">
      <div class="menu-head"><span class="muted">Show</span>
        <button class="link" data-all="${esc(repo)}:${esc(kind)}">Select all</button></div>
      ${items}
    </div>
  </details>`;
}

/** The per-repo horizontal band: stats, then what to show. */
function repoBand(r, state) {
  const sel = r.selection ?? { branches: [], workflows: [] };
  const avail = r.available ?? { branches: [], workflows: [] };
  return `<div class="band">
    ${statsStrip(r, state)}
    <div class="picker">
      ${dropdown(r.repo, 'branches', avail.branches, sel.branches)}
      ${dropdown(r.repo, 'workflows', avail.workflows, sel.workflows)}
    </div>
  </div>`;
}

function repoCard(r) {
  const state = r.state ?? 'neutral';
  const hidden = r.hidden ? `<p class="muted">+ ${r.hidden} hidden by the filter</p>` : '';
  const body = r.error ? `<p class="error">${esc(r.error)}</p>`
    : r.workflows.length > 0 ? r.workflows.map(workflowRow).join('') + hidden
    // An empty card with filters set is nearly always a typo in the config.
    : r.selected?.length ? `<p class="muted">No runs for ${esc(r.selected.join(', '))} on
        ${esc((r.branches ?? []).join(', ') || 'any branch')} — check the names in your config.</p>`
    : `<p class="muted">No workflow runs yet.</p>${hidden}`;
  return `<section class="card ${esc(state)}">
    <h2>${ICON[state] || ICON.neutral}
      <a href="https://github.com/${esc(r.repo)}/actions" target="_blank" rel="noopener">${esc(r.repo)}</a></h2>
    ${repoBand(r, state)}
    ${body}
  </section>`;
}

let STATUS = { repos: [] };

const filters = {
  get q() { return localStorage.getItem('ghpv.q') ?? ''; },
  get failuresOnly() { return localStorage.getItem('ghpv.failuresOnly') === '1'; },
  get repositories() {
    const value = localStorage.getItem('ghpv.repositories');
    if (value === null) return null;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  get saved() { return readSaved(); },
};

/** Per-repo selections live in localStorage; Save also writes config.local.json. */
function readSaved() {
  try {
    return JSON.parse(localStorage.getItem('ghpv.selection') ?? '{}');
  } catch {
    return {};
  }
}

function writeSaved(saved) {
  localStorage.setItem('ghpv.selection', JSON.stringify(saved));
}

/** Toggle one checkbox's value in the saved selection, then re-render. */
function toggle(repo, kind, value, on) {
  const saved = readSaved();
  const repoData = STATUS.repos.find((r) => r.repo === repo);
  const current = [...selectionFor(repoData ?? { repo }, saved)[kind]];
  const next = on
    ? [...new Set([...current, value])]
    : current.filter((x) => x.toLowerCase() !== value.toLowerCase());
  saved[repo] = { ...selectionFor(repoData ?? { repo }, saved), [kind]: next };
  writeSaved(saved);
  render();
}

function selectAll(repo, kind) {
  const saved = readSaved();
  saved[repo] = { ...selectionFor(STATUS.repos.find((r) => r.repo === repo) ?? { repo }, saved), [kind]: [] };
  writeSaved(saved);
  render();
}

function setRepositories(repositories) {
  if (repositories === null) localStorage.removeItem('ghpv.repositories');
  else localStorage.setItem('ghpv.repositories', JSON.stringify(repositories));
  render();
}

function toggleRepository(repo, on) {
  const all = (STATUS.repos ?? []).map((r) => r.repo);
  const current = filters.repositories ?? all;
  const next = on
    ? [...new Set([...current, repo])]
    : current.filter((name) => name.toLowerCase() !== repo.toLowerCase());
  setRepositories(next.length === all.length ? null : next);
}

function repositoryDropdown(repos) {
  const chosen = filters.repositories;
  const active = chosen ?? repos.map((r) => r.repo);
  const label = active.length === repos.length ? 'All repositories'
    : active.length === 0 ? 'No repositories'
    : `${active.length} of ${repos.length} repositories`;
  return `<details class="dd" data-repository-filter>
    <summary><span class="dd-kind">Repositories</span>${esc(label)}</summary>
    <div class="menu">
      <div class="menu-head">
        <button class="link" data-repositories="all">Select all</button>
        <button class="link" data-repositories="none">Clear</button>
      </div>
      ${repos.map((r) => `<label title="${esc(r.repo)}">
        <input type="checkbox" data-view-repo="${esc(r.repo)}"
          ${active.some((name) => name.toLowerCase() === r.repo.toLowerCase()) ? 'checked' : ''}>
        ${esc(r.repo)}
      </label>`).join('')}
    </div>
  </details>`;
}

/**
 * Persist to config.local.json via the local dev server, so the next fetch
 * collects exactly this. On GitHub Pages there is nothing to write to — the
 * selection still persists in this browser.
 */
async function save(button) {
  const body = JSON.stringify(buildConfig(STATUS.repos, readSaved()), null, 2);
  button.disabled = true;
  try {
    const res = await fetch('config.local.json', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    button.textContent = 'saved to file';
  } catch {
    button.textContent = 'saved in browser';
  }
  setTimeout(() => { button.textContent = 'Save'; button.disabled = false; }, 2500);
}

function render() {
  const all = STATUS.repos ?? [];
  // Counts describe the selected scope across the whole fleet, not text/view filters.
  const c = summarize(applyFilters(all, { saved: filters.saved }));
  const repoMenuOpen = $('#repo-filter details')?.open;
  const shown = applyFilters(all, {
    q: filters.q, failuresOnly: filters.failuresOnly,
    repositories: filters.repositories, saved: filters.saved,
  })
    .sort((a, b) => RANK[a.state] - RANK[b.state] || a.repo.localeCompare(b.repo));

  $('#repo-filter').innerHTML = repositoryDropdown(all);
  $('#repo-filter details').open = repoMenuOpen;
  $('#summary').innerHTML = `
    <strong>${c.healthy} / ${all.length} healthy</strong>
    <span>🟢 ${c.healthy}</span>${c.failed ? `<span class="bad">🔴 ${c.failed}</span>` : ''}
    ${c.running ? `<span>🟡 ${c.running}</span>` : ''}${c.unknown ? `<span>⚪️ ${c.unknown}</span>` : ''}
    ${shown.length === all.length ? '' : `<span class="muted">showing ${shown.length} of ${all.length}</span>`}`;

  $('#config').textContent = configSummary(all);

  const bad = failures(shown);
  $('#failures').innerHTML = bad.length === 0 ? '' : `<section class="card failure">
    <h2>🔴 Recent failures</h2>
    ${bad.map((w) => workflowRow({ ...w, name: `${w.repo} — ${w.name}` })).join('')}
  </section>`;

  // Keep open dropdowns open across the re-render that ticking a box triggers.
  const open = new Set([...document.querySelectorAll('#grid details[open]')].map((d) => d.dataset.dd));
  $('#grid').innerHTML = shown.length === 0
    ? '<p class="muted">Nothing matches the filter.</p>'
    : shown.map(repoCard).join('');
  for (const d of document.querySelectorAll('#grid details')) d.open = open.has(d.dataset.dd);
  $('#status').textContent = STATUS.generated_at
    ? `data from ${ago(STATUS.generated_at)} (${new Date(STATUS.generated_at).toLocaleTimeString()})`
    : '';
}

async function load() {
  try {
    // Bypass the CDN cache so a fresh deploy shows up.
    const res = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    STATUS = await res.json();
    render();
  } catch (err) {
    $('#grid').innerHTML = `<section class="card"><p class="error">Could not read status.json — ${esc(err.message)}</p>
      <p class="muted">Run the <em>Update dashboard</em> workflow, or generate it locally:
      <code>GH_TOKEN=… node scripts/fetch-status.js</code></p></section>`;
  }
}

if (typeof document !== 'undefined') {
  const q = $('#q');
  const only = $('#only');
  q.value = filters.q;
  only.checked = filters.failuresOnly;

  // Filters are a view over status.json: re-render, no refetch.
  q.oninput = () => { localStorage.setItem('ghpv.q', q.value); render(); };
  only.onchange = () => { localStorage.setItem('ghpv.failuresOnly', only.checked ? '1' : '0'); render(); };
  $('#clear').onclick = () => {
    localStorage.removeItem('ghpv.q');
    localStorage.removeItem('ghpv.failuresOnly');
    localStorage.removeItem('ghpv.repositories');
    q.value = ''; only.checked = false; render();
  };
  $('#reload').onclick = load;
  $('#save').onclick = (e) => save(e.currentTarget);

  $('#repo-filter').addEventListener('change', (e) => {
    const box = e.target.closest('[data-view-repo]');
    if (box) toggleRepository(box.dataset.viewRepo, box.checked);
  });
  $('#repo-filter').addEventListener('click', (e) => {
    const action = e.target.closest('[data-repositories]')?.dataset.repositories;
    if (action === 'all') setRepositories(null);
    if (action === 'none') setRepositories([]);
  });

  // One delegated pair of listeners: the grid is re-rendered constantly.
  $('#grid').addEventListener('change', (e) => {
    const box = e.target.closest('input[type=checkbox][data-repo]');
    if (box) toggle(box.dataset.repo, box.dataset.kind, box.value, box.checked);
  });
  $('#grid').addEventListener('click', (e) => {
    const all = e.target.closest('[data-all]');
    if (all) return selectAll(...all.dataset.all.split(':'));
  });

  load();
  setInterval(load, RELOAD_MS);
}
