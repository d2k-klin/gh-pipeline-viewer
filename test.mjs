// Self-check for the pure helpers: node test.mjs
import assert from 'node:assert/strict';
import { latestPerWorkflow, stateOf, parseRepos } from './scripts/fetch-status.js';
import { worstState, summarize, failures, ago } from './app.js';

// --- fetch-status.js ---

assert.deepEqual(
  parseRepos([' owner/repo ', 'https://github.com/o2/r2/', 'owner/REPO', 'garbage', 'a/b/c', '']),
  ['owner/repo', 'o2/r2'],
  'trims, strips URLs, drops dupes and junk',
);
assert.deepEqual(parseRepos(undefined), []);

const runs = [
  { workflow_id: 1, name: 'ci', created_at: '2024-01-01T00:00:00Z', status: 'completed', conclusion: 'failure' },
  { workflow_id: 1, name: 'ci', created_at: '2024-01-02T00:00:00Z', status: 'completed', conclusion: 'success' },
  { workflow_id: 2, name: 'build', created_at: '2024-01-01T00:00:00Z', status: 'in_progress', conclusion: null },
];
assert.deepEqual(
  latestPerWorkflow(runs).map((r) => [r.name, r.created_at]),
  [['build', '2024-01-01T00:00:00Z'], ['ci', '2024-01-02T00:00:00Z']],
  'newest run per workflow, sorted by name',
);
assert.deepEqual(latestPerWorkflow([]), []);

assert.equal(stateOf(runs[1]), 'success');
assert.equal(stateOf(runs[0]), 'failure');
assert.equal(stateOf({ status: 'completed', conclusion: 'timed_out' }), 'failure');
assert.equal(stateOf({ status: 'completed', conclusion: 'cancelled' }), 'neutral');
assert.equal(stateOf({ status: 'completed', conclusion: null }), 'neutral');
assert.equal(stateOf(runs[2]), 'running');
assert.equal(stateOf({ status: 'queued' }), 'queued');

// --- app.js ---

const wf = (state, finished_at = '2024-01-02T00:00:00Z') => ({ name: state, state, finished_at });

assert.equal(worstState([wf('success'), wf('failure'), wf('running')]), 'failure', 'failure beats all');
assert.equal(worstState([wf('success'), wf('running')]), 'running');
assert.equal(worstState([wf('success')]), 'success');
assert.equal(worstState([]), 'neutral', 'no workflows is not a failure');

const repos = [
  { repo: 'a/green', workflows: [wf('success'), wf('success')] },
  { repo: 'b/red', workflows: [wf('success'), wf('failure', '2024-01-02T10:00:00Z')] },
  { repo: 'c/amber', workflows: [wf('running')] },
  { repo: 'd/broken', workflows: [], error: '404 not found' },
  { repo: 'e/empty', workflows: [] },
];
assert.deepEqual(summarize(repos), { healthy: 1, failed: 1, running: 1, unknown: 2 },
  'errored and run-less repos are unknown, never healthy or failed');
assert.deepEqual(summarize([]), { healthy: 0, failed: 0, running: 0, unknown: 0 });

assert.deepEqual(failures(repos).map((w) => w.repo), ['b/red'], 'only failures, newest first');
assert.deepEqual(
  failures([{ repo: 'x/1', workflows: [wf('failure', '2024-01-01T00:00:00Z')] },
            { repo: 'x/2', workflows: [wf('failure', '2024-01-03T00:00:00Z')] }]).map((w) => w.repo),
  ['x/2', 'x/1'],
);

const t = Date.parse('2024-01-02T12:00:00Z');
assert.equal(ago('2024-01-02T11:59:30Z', t), '30s ago');
assert.equal(ago('2024-01-02T11:00:00Z', t), '1h ago');
assert.equal(ago('2023-12-31T12:00:00Z', t), '2d ago');
assert.equal(ago('2024-01-03T00:00:00Z', t), '0s ago', 'clock skew never goes negative');

console.log('ok');
