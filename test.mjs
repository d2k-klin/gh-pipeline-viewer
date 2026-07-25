// Self-check for the pure helpers: node test.mjs
import assert from 'node:assert/strict';
import {
  normalizeRepos, matchesWorkflow, latestPerWorkflow, stateOf, failedStep, jobUrl, toStages,
  seconds, windowStats,
} from './scripts/fetch-status.js';
import {
  latestState, summarize, failures, stageTip, scope, applyFilters, configSummary, ago,
} from './app.js';

// --- config ---

assert.deepEqual(
  normalizeRepos({
    branches: ['main'],
    workflows: ['CI'],
    repos: [' owner/repo ', 'https://github.com/o2/r2/',
            { repo: 'o3/r3', branches: ['dev', 'qa'], workflows: ['Deploy', 'e2e.yml'] },
            'owner/REPO', 'garbage', 'a/b/c', '', null],
  }),
  [
    { repo: 'owner/repo', branches: ['main'], workflows: ['CI'] },
    { repo: 'o2/r2', branches: ['main'], workflows: ['CI'] },
    { repo: 'o3/r3', branches: ['dev', 'qa'], workflows: ['Deploy', 'e2e.yml'] },
  ],
  'inherits branches and workflows, per-repo override wins, drops dupes and junk',
);
assert.deepEqual(normalizeRepos({ repos: ['a/b'] }), [{ repo: 'a/b', branches: [], workflows: [] }],
  'nothing configured means every branch and every workflow');
assert.deepEqual(normalizeRepos(undefined), []);

const ciRun = { name: 'CI', path: '.github/workflows/ci.yml' };
assert.equal(matchesWorkflow(ciRun, []), true, 'no filter means everything');
assert.equal(matchesWorkflow(ciRun, undefined), true);
assert.equal(matchesWorkflow(ciRun, ['ci']), true, 'display name, case-insensitive');
assert.equal(matchesWorkflow(ciRun, ['ci.yml']), true, 'workflow file name');
assert.equal(matchesWorkflow(ciRun, ['.github/workflows/ci.yml']), true, 'full path');
assert.equal(matchesWorkflow(ciRun, ['Deploy']), false);
assert.equal(matchesWorkflow(ciRun, ['Deploy', 'CI']), true, 'any of the listed ones');
assert.equal(matchesWorkflow({ name: 'CI' }, ['ci.yml']), false, 'no path, no file match');

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

// A repo is coloured by its most recent run, not by the worst one.
assert.equal(
  latestState([wf('failure', '2024-01-01T00:00:00Z'), wf('success', '2024-01-05T00:00:00Z')]),
  'success',
  'an older failing workflow no longer reddens the repo',
);
assert.equal(
  latestState([wf('success', '2024-01-01T00:00:00Z'), wf('failure', '2024-01-05T00:00:00Z')]),
  'failure',
  'the newest run failing does',
);
assert.equal(latestState([wf('running', '2024-01-05T00:00:00Z'), wf('success')]), 'running');
assert.equal(latestState([wf('success')]), 'success');
assert.equal(latestState([]), 'neutral', 'no workflows is not a failure');

const repos = [
  { repo: 'a/green', workflows: [wf('success'), wf('success')] },
  { repo: 'b/red', workflows: [wf('success'), wf('failure', '2024-01-02T10:00:00Z')] },
  { repo: 'c/amber', workflows: [wf('running')] },
  { repo: 'd/broken', workflows: [], error: '404 not found' },
  { repo: 'e/empty', workflows: [] },
  { repo: 'f/stale', workflows: [wf('failure', '2024-01-01T00:00:00Z'), wf('success', '2024-01-09T00:00:00Z')] },
];
assert.deepEqual(summarize(repos), { healthy: 2, failed: 1, running: 1, unknown: 2 },
  'f/stale counts as healthy: its latest run passed');
assert.deepEqual(summarize([]), { healthy: 0, failed: 0, running: 0, unknown: 0 });

// --- on-page filters ---

const wfn = (name, state, finished_at = '2024-01-02T00:00:00Z') => ({ name, state, finished_at });
const fleet = [
  { repo: 'org/api', workflows: [wfn('CI', 'failure'), wfn('Deploy', 'success')] },
  { repo: 'org/web', workflows: [wfn('CI', 'success')] },
  { repo: 'other/tool', workflows: [wfn('Release', 'success')] },
];

assert.deepEqual(applyFilters(fleet, {}).map((r) => r.repo), ['org/api', 'org/web', 'other/tool'],
  'no filter shows everything');
assert.deepEqual(applyFilters(fleet, { q: 'org/' }).map((r) => r.repo), ['org/api', 'org/web'],
  'matching the repo name keeps all its workflows');
assert.deepEqual(applyFilters(fleet, { q: 'org/' })[0].workflows.length, 2);
assert.deepEqual(applyFilters(fleet, { q: 'deploy' }).map((r) => [r.repo, r.workflows.map((w) => w.name), r.hidden]),
  [['org/api', ['Deploy'], 1]], 'matching a workflow narrows the rows and counts what it hid');
assert.deepEqual(applyFilters(fleet, { failuresOnly: true }).map((r) => [r.repo, r.workflows.map((w) => w.name)]),
  [['org/api', ['CI']]], 'failures only drops green repos and green rows');
assert.deepEqual(applyFilters(fleet, { q: 'nothing-matches' }), []);
assert.equal(applyFilters(fleet, { failuresOnly: true })[0].state, 'failure',
  'state comes from the unfiltered list, so filtering cannot recolour a card');
assert.deepEqual(applyFilters(undefined, {}), []);

assert.equal(
  configSummary([{ branches: ['main'], selected: ['CI'] }, { branches: ['main', 'dev'], selected: [] }]),
  'branches: dev, main · workflows: CI',
);
assert.equal(configSummary([{ }]), 'branches: all · workflows: all');

assert.deepEqual(failures(repos).map((w) => w.repo), ['b/red', 'f/stale'],
  'the roll-up still surfaces a red workflow whose repo counts as healthy');
assert.deepEqual(
  failures([{ repo: 'x/1', workflows: [wf('failure', '2024-01-01T00:00:00Z')] },
            { repo: 'x/2', workflows: [wf('failure', '2024-01-03T00:00:00Z')] }]).map((w) => w.repo),
  ['x/2', 'x/1'],
);

assert.equal(scope({ branches: ['main'], selected: ['CI'] }), 'CI · main');
assert.equal(scope({ branches: ['main'] }), 'main');
assert.equal(scope({}), 'all branches');

const t = Date.parse('2024-01-02T12:00:00Z');
assert.equal(ago('2024-01-02T11:59:30Z', t), '30s ago');
assert.equal(ago('2024-01-02T11:00:00Z', t), '1h ago');
assert.equal(ago('2023-12-31T12:00:00Z', t), '2d ago');
assert.equal(ago('2024-01-03T00:00:00Z', t), '0s ago', 'clock skew never goes negative');

console.log('ok');
