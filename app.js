// Renders status.json, which the scheduled workflow regenerates.
// ponytail: no API calls, no token, no framework — the browser reads one file.

const STATUS_URL = 'status.json';
const RELOAD_MS = 60_000; // status.json only changes every 5 min; this just re-reads it

// ---------- pure helpers (covered by test.mjs) ----------

const RANK = { failure: 0, running: 1, queued: 2, neutral: 3, success: 4 };

/** Worst state in a repo, for the card's accent and sort order. */
export function worstState(workflows) {
  return (workflows || []).map((w) => w.state).sort((a, b) => RANK[a] - RANK[b])[0] || 'neutral';
}

/** Headline counts: a repo is failed/running/healthy by its worst workflow. */
export function summarize(repos) {
  const counts = { healthy: 0, failed: 0, running: 0, unknown: 0 };
  for (const r of repos || []) {
    const state = r.error ? 'error' : worstState(r.workflows);
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

function workflowRow(w) {
  const meta = [w.branch, w.sha, w.author, w.finished_at && ago(w.finished_at)].filter(Boolean);
  return `<a class="run ${esc(w.state)}" href="${esc(w.url)}" target="_blank" rel="noopener"
      title="${esc(w.message || '')}">
    <span class="icon">${ICON[w.state] || ICON.neutral}</span>
    <span class="name">${esc(w.name)}</span>
    <span class="meta">${esc(meta.join(' · '))}</span>
  </a>`;
}

function repoCard(r) {
  const state = r.error ? 'neutral' : worstState(r.workflows);
  const body = r.error ? `<p class="error">${esc(r.error)}</p>`
    : r.workflows.length === 0 ? '<p class="muted">No workflow runs yet.</p>'
    : r.workflows.map(workflowRow).join('');
  return `<section class="card ${esc(state)}">
    <h2>${ICON[state] || ICON.neutral}
      <a href="https://github.com/${esc(r.repo)}/actions" target="_blank" rel="noopener">${esc(r.repo)}</a></h2>
    ${body}
  </section>`;
}

function render(status) {
  const repos = [...(status.repos || [])].sort((a, b) =>
    RANK[worstState(a.workflows)] - RANK[worstState(b.workflows)] || a.repo.localeCompare(b.repo));
  const c = summarize(repos);

  $('#summary').innerHTML = `
    <strong>${c.healthy} / ${repos.length} healthy</strong>
    <span>🟢 ${c.healthy}</span>${c.failed ? `<span class="bad">🔴 ${c.failed}</span>` : ''}
    ${c.running ? `<span>🟡 ${c.running}</span>` : ''}${c.unknown ? `<span>⚪️ ${c.unknown}</span>` : ''}`;

  const bad = failures(repos);
  $('#failures').innerHTML = bad.length === 0 ? '' : `<section class="card failure">
    <h2>🔴 Recent failures</h2>
    ${bad.map((w) => workflowRow({ ...w, name: `${w.repo} — ${w.name}` })).join('')}
  </section>`;

  $('#grid').innerHTML = repos.map(repoCard).join('');
  $('#status').textContent = status.generated_at
    ? `data from ${ago(status.generated_at)} (${new Date(status.generated_at).toLocaleTimeString()})`
    : '';
}

async function load() {
  try {
    // Bypass the CDN cache so a fresh deploy shows up.
    const res = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    render(await res.json());
  } catch (err) {
    $('#grid').innerHTML = `<section class="card"><p class="error">Could not read status.json — ${esc(err.message)}</p>
      <p class="muted">Run the <em>Update dashboard</em> workflow, or generate it locally:
      <code>GH_TOKEN=… node scripts/fetch-status.js</code></p></section>`;
  }
}

if (typeof document !== 'undefined') {
  $('#reload').onclick = load;
  load();
  setInterval(load, RELOAD_MS);
}
