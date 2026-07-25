// Self-check for the pure helpers: node test.mjs
import assert from 'node:assert/strict';
import {
  normalizeRepos, latestPerWorkflow, stateOf, failedStep, jobUrl, toStages, seconds, windowStats,
} from './scripts/fetch-status.js';
import { worstState, summarize, failures, stageTip, ago } from './app.js';

// --- config ---

assert.deepEqual(
  normalizeRepos({
    branches: ['main'],
    repos: [' owner/repo ', 'https://github.com/o2/r2/', { repo: 'o3/r3', branches: ['dev', 'qa'] },
            'owner/REPO', 'garbage', 'a/b/c', '', null],
  }),
  [
    { repo: 'owner/repo', branches: ['main'] },
    { repo: 'o2/r2', branches: ['main'] },
    { repo: 'o3/r3', branches: ['dev', 'qa'] },
  ],
  'inherits branches, per-repo override wins, drops dupes and junk',
);
assert.deepEqual(normalizeRepos({ repos: ['a/b'] }), [{ repo: 'a/b', branches: [] }],
  'no branches configured means every branch');
assert.deepEqual(normalizeRepos(undefined), []);

// --- runs ---

const runs = [
  { workflow_id: 1, name: 'ci', created_at: '2024-01-01T00:00:00Z', status: 'completed', conclusion: 'failure' },
  { workflow_id: 1, name: 'ci', created_at: '2024-01-02T00:00:00Z', status: 'completed', conclusion: 'success' },
  { workflow_id: 2, name: 'build', created_at: '2024-01-01T00:00:00Z', status: 'in_progress', conclusion: null },
];
assert.deepEqual(
  latestPerWorkflow(runs).map((r) => [r.name, r.created_at]),
  [['build', '2024-01-01T00:00:00Z'], ['ci', '2024-01-02T00:00:00Z']],
  'only the newest run per workflow survives',
);
assert.deepEqual(latestPerWorkflow([]), []);

assert.equal(stateOf(runs[1]), 'success');
assert.equal(stateOf(runs[0]), 'failure');
assert.equal(stateOf({ status: 'completed', conclusion: 'timed_out' }), 'failure');
assert.equal(stateOf({ status: 'completed', conclusion: 'skipped' }), 'skipped');
assert.equal(stateOf({ status: 'completed', conclusion: 'cancelled' }), 'neutral');
assert.equal(stateOf({ status: 'completed', conclusion: null }), 'neutral');
assert.equal(stateOf(runs[2]), 'running');
assert.equal(stateOf({ status: 'queued' }), 'queued');

// --- stats windows ---

const now = Date.parse('2024-01-10T12:00:00Z');
const at = (iso, conclusion = 'failure') => ({ created_at: iso, status: 'completed', conclusion });
const stats = windowStats([
  at('2024-01-10T11:00:00Z'),                    // 1h ago, failed
  at('2024-01-10T02:00:00Z', 'success'),         // 10h ago, ok
  at('2024-01-07T12:00:00Z'),                    // 3d ago, failed
  at('2024-01-01T12:00:00Z'),                    // 9d ago, outside both windows
], now);
assert.deepEqual(stats.day, { runs: 2, failures: 1 });
assert.deepEqual(stats.week, { runs: 3, failures: 2 });
assert.equal(stats.truncated, false);
assert.equal(windowStats(new Array(100).fill(at('2024-01-10T11:00:00Z')), now).truncated, true,
  'a full page means the 7d window may be short');
assert.deepEqual(windowStats([], now).day, { runs: 0, failures: 0 });

// --- jobs -> stages (the dots) ---

const job = {
  name: 'build', status: 'completed', conclusion: 'failure',
  html_url: 'https://github.com/o/r/actions/runs/1/job/2',
  started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:02:30Z',
  steps: [
    { number: 1, name: 'checkout', status: 'completed', conclusion: 'success' },
    { number: 4, name: 'npm test', status: 'completed', conclusion: 'failure' },
  ],
};
assert.equal(failedStep(job).name, 'npm test');
assert.equal(jobUrl(job), 'https://github.com/o/r/actions/runs/1/job/2#step:4:1',
  'links straight at the step that broke');
const green = { ...job, conclusion: 'success', steps: job.steps.slice(0, 1) };
assert.equal(jobUrl(green), 'https://github.com/o/r/actions/runs/1/job/2');
assert.equal(failedStep({}), null, 'jobs without steps are fine');

assert.deepEqual(toStages([job]), [{
  name: 'build', state: 'failure',
  url: 'https://github.com/o/r/actions/runs/1/job/2#step:4:1',
  duration: 150, failed_step: 'npm test',
}]);
assert.deepEqual(toStages(undefined), []);

assert.equal(seconds('2024-01-01T00:00:00Z', '2024-01-01T00:00:45Z'), 45);
assert.equal(seconds(null, '2024-01-01T00:00:45Z'), null, 'a queued job has no duration');

assert.equal(stageTip(toStages([job])[0]), 'build · failure · failed at: npm test · 3m');
assert.equal(stageTip({ name: 'lint', state: 'success', duration: 12 }), 'lint · success · 12s');

// --- roll-ups ---

const wf = (state, finished_at = '2024-01-02T00:00:00Z') => ({ name: state, state, finished_at });

assert.equal(worstState([wf('success'), wf('failure'), wf('running')]), 'failure', 'failure beats all');
assert.equal(worstState([wf('success'), wf('running')]), 'running');
assert.equal(worstState([wf('success'), wf('skipped')]), 'skipped');
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
