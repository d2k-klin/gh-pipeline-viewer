#!/usr/bin/env node
// Builds status.json for the dashboard. Runs in GitHub Actions (token from a
// secret) or locally via ./dev.sh — the browser never holds a token.
// ponytail: node's built-in fetch, no octokit. This is two endpoints.
//
// Usage: GH_TOKEN=<pat> node scripts/fetch-status.js

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

// ---------- pure helpers (covered by test.mjs) ----------

/**
 * config -> [{ repo, branches }]. Accepts "owner/repo" strings, full GitHub
 * URLs, or { repo, branches } objects that override the top-level branches.
 */
export function normalizeRepos(cfg) {
  const seen = new Set();
  return (cfg?.repos ?? [])
    .map((e) => (typeof e === 'string' ? { repo: e } : e ?? {}))
    .map((e) => ({
      repo: String(e.repo ?? '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, ''),
      branches: (e.branches ?? cfg?.branches ?? []).filter(Boolean),
      workflows: (e.workflows ?? cfg?.workflows ?? []).filter(Boolean),
    }))
    .filter((e) => /^[\w.-]+\/[\w.-]+$/.test(e.repo))
    .filter((e) => !seen.has(e.repo.toLowerCase()) && seen.add(e.repo.toLowerCase()));
}

/**
 * Does this run belong to a workflow you asked for? Matches the displayed name,
 * the workflow file name, or its full path — so "CI", "ci.yml" and
 * ".github/workflows/ci.yml" all work. Empty list means every workflow.
 */
export function matchesWorkflow(run, wanted) {
  if (!wanted?.length) return true;
  const path = (run.path ?? '').toLowerCase();
  const candidates = [(run.name ?? '').toLowerCase(), path, path.split('/').pop()];
  return wanted.some((w) => candidates.includes(String(w).trim().toLowerCase()));
}

/** The one run that matters per workflow: the newest. Older runs are dropped. */
export function latestPerWorkflow(runs) {
  const best = new Map();
  for (const run of runs ?? []) {
    const key = run.workflow_id ?? run.name;
    const prev = best.get(key);
    if (!prev || new Date(run.created_at) > new Date(prev.created_at)) best.set(key, run);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Run or job -> success | failure | running | queued | skipped | neutral. */
export function stateOf(x) {
  if (x.status !== 'completed') return x.status === 'queued' ? 'queued' : 'running';
  return {
    success: 'success', failure: 'failure', timed_out: 'failure',
    startup_failure: 'failure', skipped: 'skipped',
  }[x.conclusion] || 'neutral';
}

/** First step that broke, for the tooltip and the #step deep link. */
export function failedStep(job) {
  return (job.steps ?? []).find((s) => stateOf(s) === 'failure') || null;
}

/** A job's link — anchored at the failing step so the log opens where it broke. */
export function jobUrl(job) {
  const step = failedStep(job);
  return step ? `${job.html_url}#step:${step.number}:1` : job.html_url;
}

/**
 * Failure counts over the last day and week, from the runs already fetched.
 * ponytail: capped at the newest 100 runs per branch — plenty for the 24h number,
 * and `truncated` flags when the 7d window may be short. Paginate if that matters.
 */
export function windowStats(runs, now = Date.now()) {
  const within = (h) => (r) => now - new Date(r.created_at) <= h * 3600e3;
  const count = (list) => ({
    runs: list.length,
    failures: list.filter((r) => stateOf(r) === 'failure').length,
  });
  return {
    day: count((runs ?? []).filter(within(24))),
    week: count((runs ?? []).filter(within(24 * 7))),
    truncated: (runs ?? []).length >= 100,
  };
}

export function seconds(from, to) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000));
}

/** Jobs -> the dots shown under a workflow, in execution order. */
export function toStages(jobs) {
  return (jobs ?? []).map((job) => {
    const step = failedStep(job);
    return {
      name: job.name,
      state: stateOf(job),
      url: jobUrl(job),
      duration: seconds(job.started_at, job.completed_at),
      failed_step: step?.name ?? null,
    };
  });
}

// ---------- api ----------

async function gh(path) {
  const res = await fetch(API + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    const hint = { 401: 'bad token', 403: 'rate limited or token lacks access', 404: 'not found — check the name, or grant the token access' }[res.status];
    throw new Error(`${res.status} ${hint || res.statusText}`);
  }
  return res.json();
}

/** One request per watched branch; no branches configured means every branch. */
async function fetchRuns(repo, branches) {
  if (branches.length === 0) {
    return (await gh(`/repos/${repo}/actions/runs?per_page=100`)).workflow_runs;
  }
  const lists = await Promise.all(branches.map((b) =>
    gh(`/repos/${repo}/actions/runs?per_page=100&branch=${encodeURIComponent(b)}`)
      .then((r) => r.workflow_runs)));
  return lists.flat();
}

async function repoStatus({ repo, branches, workflows: wanted }) {
  // Filter first: the stats, the cards and the job requests all follow from this.
  const all = (await fetchRuns(repo, branches)).filter((run) => matchesWorkflow(run, wanted));
  const workflows = await Promise.all(latestPerWorkflow(all).map(async (run) => {
    const state = stateOf(run);
    let stages = [];
    try {
      stages = toStages((await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`)).jobs);
    } catch (err) {
      console.error(`${repo} ${run.name}: jobs unavailable (${err.message})`);
    }
    const broken = stages.find((s) => s.state === 'failure');
    return {
      name: run.name,
      state,
      branch: run.head_branch,
      event: run.event,
      sha: (run.head_sha ?? '').slice(0, 7),
      author: run.actor?.login ?? run.head_commit?.author?.name ?? null,
      message: (run.head_commit?.message ?? '').split('\n')[0],
      finished_at: run.updated_at ?? run.created_at,
      url: broken?.url ?? run.html_url,
      stages,
    };
  }));
  return { repo, branches, selected: wanted, workflows, stats: windowStats(all) };
}

/** config.local.json (git-ignored) wins, so a private repo list stays out of git. */
async function loadConfig() {
  for (const name of ['config.local.json', 'config.json']) {
    try {
      const cfg = JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), 'utf8'));
      if (name !== 'config.json') console.log(`using ${name}`);
      return cfg;
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`${name}: ${err.message}`);
    }
  }
  throw new Error('no config.json found');
}

async function main() {
  const cfg = await loadConfig();
  const repos = normalizeRepos(cfg);
  if (repos.length === 0) throw new Error('config: no valid "owner/repo" entries');
  if (!TOKEN) console.warn('warning: no GH_TOKEN — public repos only, 60 requests/hour');

  const results = await Promise.all(repos.map(async (entry) => {
    try {
      return await repoStatus(entry);
    } catch (err) {
      console.error(`${entry.repo}: ${err.message}`);
      return { ...entry, selected: entry.workflows, workflows: [], error: err.message };
    }
  }));

  await writeFile(
    new URL('../status.json', import.meta.url),
    JSON.stringify({ generated_at: new Date().toISOString(), repos: results }, null, 2) + '\n',
  );
  const failed = results.filter((r) => r.error).length;
  console.log(`wrote status.json — ${results.length - failed}/${results.length} repos ok`);
  // All of them failing is a token or config problem: make the build red.
  if (failed === results.length) process.exit(1);
}

// Run only when executed directly, so test.mjs can import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
