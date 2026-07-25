#!/usr/bin/env node
// Builds status.json for the dashboard. Runs inside GitHub Actions, where the
// token is a secret — the browser never sees it and never calls the API.
// ponytail: node's built-in fetch, no octokit. This is two endpoints.
//
// Usage: GH_TOKEN=<pat> node scripts/fetch-status.js

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

// ---------- pure helpers (covered by test.mjs) ----------

/** Newest run per workflow. The API sorts newest-first, but don't rely on it. */
export function latestPerWorkflow(runs) {
  const best = new Map();
  for (const run of runs || []) {
    const key = run.workflow_id ?? run.name;
    const prev = best.get(key);
    if (!prev || new Date(run.created_at) > new Date(prev.created_at)) best.set(key, run);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Run -> one of success | failure | running | queued | neutral. */
export function stateOf(run) {
  if (run.status !== 'completed') return run.status === 'queued' ? 'queued' : 'running';
  return { success: 'success', failure: 'failure', timed_out: 'failure', startup_failure: 'failure' }[run.conclusion] || 'neutral';
}

/** "owner/repo" entries -> deduped, validated list. Accepts full GitHub URLs. */
export function parseRepos(list) {
  const seen = new Set();
  return (list || [])
    .map((l) => String(l).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, ''))
    .filter((l) => /^[\w.-]+\/[\w.-]+$/.test(l))
    .filter((l) => !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
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

/** For a failed run, point at the job that failed so the click lands on its log. */
async function failedJobUrl(repo, run) {
  try {
    const { jobs } = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
    const failed = jobs.find((j) => j.conclusion && !['success', 'skipped'].includes(j.conclusion));
    return failed?.html_url || run.html_url;
  } catch {
    return run.html_url; // job lookup is a nicety, not worth failing the build over
  }
}

async function repoStatus(repo) {
  const { workflow_runs } = await gh(`/repos/${repo}/actions/runs?per_page=100`);
  const workflows = await Promise.all(latestPerWorkflow(workflow_runs).map(async (run) => {
    const state = stateOf(run);
    return {
      name: run.name,
      state,
      branch: run.head_branch,
      event: run.event,
      sha: (run.head_sha || '').slice(0, 7),
      author: run.actor?.login || run.head_commit?.author?.name || null,
      message: (run.head_commit?.message || '').split('\n')[0],
      finished_at: run.updated_at || run.created_at,
      url: state === 'failure' ? await failedJobUrl(repo, run) : run.html_url,
    };
  }));
  return { repo, workflows };
}

async function main() {
  const cfg = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
  const repos = parseRepos(cfg.repos);
  if (repos.length === 0) throw new Error('config.json lists no valid "owner/repo" entries');
  if (!TOKEN) console.warn('warning: no GH_TOKEN — public repos only, 60 requests/hour');

  const results = await Promise.all(repos.map(async (repo) => {
    try {
      return await repoStatus(repo);
    } catch (err) {
      console.error(`${repo}: ${err.message}`);
      return { repo, workflows: [], error: err.message };
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
