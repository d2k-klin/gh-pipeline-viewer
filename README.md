# PipelineHive 🐝

[![Update dashboard](https://github.com/d2k-klin/gh-pipeline-viewer/actions/workflows/update-dashboard.yml/badge.svg)](https://github.com/d2k-klin/gh-pipeline-viewer/actions/workflows/update-dashboard.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![No dependencies](https://img.shields.io/badge/dependencies-0-42d392.svg)](scripts/fetch-status.js)

A zero-dependency GitHub Actions dashboard for teams that want one fast answer:
**are the workflows and branches we care about healthy right now?**

PipelineHive shows the latest selected workflow runs, job-level stage dots, 24-hour
and 7-day failure counts, the latest selected build time, and the latest published
release. Every red stage links directly to the failed GitHub Actions step.

## Why PipelineHive

- Monitor many repositories without opening every Actions tab.
- Choose repositories, branches, and workflows from the dashboard.
- Run privately on your machine or publish as a static GitHub Pages site.
- Keep GitHub tokens out of the browser and use no runtime dependencies.
- Open failed runs, jobs, and release pages in one click.

```
PipelineHive                         3 / 5 healthy · updated 2m ago

REPOSITORIES  3 of 5    SEARCH  workflow or repo…    ☐ Failures only    [ Save ]

RECENT FAILURES
  🔴 your-org/api — CI
     🟢 🟢 🔴 ⚪   main · 83ab921 · you · 7m ago

your-org/api                                                  🔴 failing
  24H          7D           NOW          LAST BUILD          RELEASE
  1 failure    2 failures   failing      CI · 7m ago         v1.4.0 · Jul 25, 2026
  Selected: CI, Deploy · main

  🔴 CI
     🟢 🟢 🔴 ⚪   main · 83ab921 · you · 7m ago
  🟢 Deploy
     🟢 🟢 🟢      main · 17ac410 · you · 1h ago

your-org/web                                                  🟢 all green
  24H          7D           NOW          LAST BUILD          RELEASE
  0 failures   0 failures   all green    CI · 1h ago         —
  Selected: all workflows · main

  🟢 CI
     🟢 🟢 🟢      main · 73bb102 · you · 1h ago

Hover a stage dot for details; select it to open the GitHub job log.
```

## Choose how to run it

| Mode | Best for | Start |
| --- | --- | --- |
| Local private dashboard | Private repositories and personal use | `./dev.sh` |
| Project Pages site | A dashboard at `https://<owner>.github.io/<repo>/` | [Public mode](#public-mode--deploy-to-github-pages) |
| Organization Pages site | A shared dashboard owned by a GitHub organization | [Organization hosting guide](docs/organization-pages.md) |

The same static application is used in every mode.

## How it works

The browser never talks to the GitHub API and never holds a token. A scheduled
workflow does the fetching with a secret, and Pages serves the result as a static
file.

```
        your repositories
   ┌────────┬────────┬────────┐
   │ Repo A │ Repo B │ Repo C │
   └────┬───┴────┬───┴───┬────┘
        └────────┼───────┘
                 │  GitHub REST API (Actions: read)
        ┌────────▼─────────┐
        │  GitHub Action   │   every 5 minutes
        │  token = secret  │   scripts/fetch-status.js
        └────────┬─────────┘
                 │  writes status.json
        ┌────────▼─────────┐
        │   GitHub Pages   │   index.html + app.js
        └────────┬─────────┘
                 ▼
     https://you.github.io/pipelinehive
```

The page reads `status.json` and re-reads it every 60 seconds, so data is at most
about five minutes old. Three source files, no dependencies, no build step.

| File | Job |
| --- | --- |
| [`config.json`](config.json) | The list of repositories to watch |
| [`scripts/fetch-status.js`](scripts/fetch-status.js) | Queries the API, writes `status.json` |
| [`index.html`](index.html) + [`app.js`](app.js) | Renders `status.json` |
| [`dev.sh`](dev.sh) | Local private mode: refresh + serve on localhost |
| [`scripts/serve.py`](scripts/serve.py) | Static server that also accepts the Save button's write |
| [`.github/workflows/update-dashboard.yml`](.github/workflows/update-dashboard.yml) | Cron, build, deploy to Pages |

`status.json` is generated at run time and git-ignored — nothing to commit, no
status noise in your history.

## Private mode — run it on your machine

The whole dashboard, none of it published:

```bash
./dev.sh
```

That's it. It borrows the token from your `gh` CLI login, writes `status.json`,
serves <http://localhost:8000>, and refreshes every 5 minutes until you Ctrl-C. If
8000 is taken it moves to the next free port — the URL it prints is the one to open.

```bash
GH_TOKEN=github_pat_xxx ./dev.sh   # explicit token instead of the gh CLI's
PORT=9000 INTERVAL=60 ./dev.sh     # pinned port, faster refresh
```

An explicit `PORT` is treated as a requirement: if it's busy the script says so
instead of quietly using another one.

Requirements: `node` 18+ and `python3` — both already on most dev machines.

**Keep your repo list out of git** with `config.local.json`, which is git-ignored and
takes precedence over `config.json`. Seed it with everything you own, then narrow it
from the page's dropdowns and hit **Save**:

```bash
gh repo list <your-user> --limit 50 --json nameWithOwner \
  --jq '{branches: ["main","master"], workflows: [], repos: [.[].nameWithOwner]}' > config.local.json
```

Now your private repo names, your dashboard, your machine — nothing leaves it
except the API calls.

## Public mode — deploy to GitHub Pages

**1. Fork this repo** (or use it as a template).

**2. Enable Pages:** repo **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

**3. Pick your repositories and branches** — edit [`config.json`](config.json) and
commit. See [Configuration](#configuration) below.

**4. Add a token when monitoring repositories other than the dashboard repo.**
Create a **fine-grained personal access token** — GitHub → Settings → Developer
settings → Personal access tokens → Fine-grained:

- **Repository access:** only the repos on your dashboard
- **Permissions:** `Actions: Read-only`, `Contents: Read-only`, and the automatic
  `Metadata: Read-only` permission

Save it in **this** repo under **Settings → Secrets and variables → Actions → New
repository secret**, named `PIPELINEHIVE_GITHUB_TOKEN`.

**5. Push to `main`**, or run the *Update dashboard* workflow manually. Your
dashboard is at `https://<you>.github.io/<repo>/`.

Without the secret the workflow falls back to the automatic `GITHUB_TOKEN`, which
can only see this repository — enough to prove the pipeline works, not enough to
watch anything else.

> **In this repository the *Update dashboard* workflow is disabled**, because the
> reference dashboard runs in private mode. Enable it in the Actions tab (or
> `gh workflow enable "Update dashboard"`) once Pages is set up in your fork.

### Host it for a GitHub organization

An organization can host PipelineHive in either form:

- **Project site (recommended):** create `<org>/pipelinehive`; the URL is
  `https://<org>.github.io/pipelinehive/`.
- **Organization root site:** create or use the special repository
  `<org>/<org>.github.io`; the URL is `https://<org>.github.io/`. GitHub allows only
  one root Pages site per organization, so use this only when PipelineHive should
  be the organization's main site.

Both use the included workflow. Organization owners may need to allow Pages
publication and approve the fine-grained token used to read private organization
repositories. Follow the complete [organization Pages hosting guide](docs/organization-pages.md).

## Configuration

```json
{
  "branches": ["main", "master"],
  "workflows": [],
  "repos": [
    "your-org/api",
    "https://github.com/your-org/web",
    { "repo": "your-org/platform", "branches": ["main", "develop"] },
    { "repo": "your-org/monorepo", "workflows": ["CI", "Deploy", "e2e.yml"] }
  ]
}
```

- **`branches`** — the branches you care about. Runs on any other branch (feature
  branches, PRs, forks) are ignored, which is usually what you want on a dashboard.
- **`workflows`** — which workflows to show. Match by the name you see in the
  Actions tab (`"CI"`), the workflow file (`"ci.yml"`), or its full path
  (`".github/workflows/ci.yml"`) — case-insensitive. Handy for a monorepo where
  only two of fifteen workflows matter.
- Both apply to **every repo**, and **any repo can override either** with its own
  list. Omit them, or use `[]`, to mean *all branches* / *all workflows*.
- **`repos`** — `"owner/repo"` strings, full GitHub URLs, or objects with
  overrides. Duplicates and malformed entries are dropped.

Only the **newest run per workflow** is shown; previous runs are never rendered.
They still feed the 24h / 7d failure counts — which respect your filters too, so a
`CI`-only card counts `CI` failures, not everything the repo ever ran.

A card that comes up empty prints the filters it used, which is almost always how
you spot a mistyped workflow name.

Locally, put your list in **`config.local.json`** — it's git-ignored and takes
precedence, so your private repo names never reach the public repo.

## Read this before putting private repos on a hosted page

**A GitHub Pages site is public unless your organization uses GitHub Enterprise
Cloud and explicitly configures private Pages visibility.** Making the source
repository private does not by itself make the published site private.

The token is never at risk either way: it lives in Actions secrets and only ever
runs server-side. `status.json` is the exposure. Published to a public Pages site
it reveals **the names, branches, commit SHAs, authors and pass/fail state of every
repo on the dashboard**, private ones included.

So:

| You want | Do this |
| --- | --- |
| Watch private repos, keep it to yourself | **Private mode** — `./dev.sh` (above) |
| A public status page for open-source repos | Pages, with only public repos in `config.json` |
| Hosted *and* private | GitHub Enterprise Cloud (**Settings → Pages → Visibility → Private**), or host the static output behind your own auth — e.g. Cloudflare Pages + Cloudflare Access |

## Reading the dashboard

**A repo's colour is its most recent run within the selected branches and
workflows.** Green means the last selected thing that ran passed — the "did I just
break something" question. A selected workflow that failed days ago and hasn't run
since does *not* redden the repo when a newer selected run passed; it stays a red
row in the card and in the *Recent failures* list, where you can still see it.

| | Meaning (repo card) |
| --- | --- |
| 🟢 | The most recent run passed |
| 🔴 | The most recent run failed, timed out, or failed at startup |
| 🟡 | The most recent run is in progress or queued |
| ⚪️ | Nothing to trust — cancelled, skipped, awaiting approval, no runs, or an API error |

Individual workflow rows and stage dots always show their own real state.

Each card shows the **newest run per workflow** — never a history of previous runs.
Repos sort worst-first, with a *Recent failures* roll-up above the grid.

**The stats strip** across the top of every card:

```
┌────────────┬────────────┬────────────┬────────────────────┬──────────────┐
│ 24H        │ 7D         │ NOW        │ LAST BUILD         │ RELEASE      │
│ 🔴 1       │ 🔴 2       │ 🔴 failing │ 7m ago             │ v1.4.0       │
│ of 15 runs │ of 25 runs │ CI · main  │ CI · Jul 25, 14:32 │ Jul 25, 2026 │
└────────────┴────────────┴────────────┴────────────────────┴──────────────┘
```

Failed runs in the last day and the last week — across the workflows and branches
you selected — then the current state, the filters in force, and the newest build
within that selected scope. The build time links to its workflow run and updates
immediately when the branch or workflow selection changes. When the repository has
a published GitHub Release, its latest stable version and publication date appear
as a link in the final cell. A repo that
fails twice a week and is green right now looks different from one that has never
failed, and the strip is where you see that.

**The dots** under each workflow are its pipeline stages — one dot per job, in
execution order:

```
🔴 CI
   🟢 🟢 🔴 ⚪ ⚪        ← lint ok, build ok, test failed, deploy skipped
   main · 83ab921 · you · 7m ago
```

- **Hover** a dot for the job name, its result, the step that failed, and how long
  it took.
- **Click** a dot to open that job's log on GitHub — and if a step in it failed,
  the link is anchored to that step, so the log opens exactly where it broke.
- Hollow dots are skipped or cancelled jobs; the row's own name links to the run.

The repo name links to its Actions tab.

## Choosing what you see, from the page

The top bar has one repository dropdown with checkboxes, so you can keep the page
focused on just the repositories you care about:

```
┌ REPOSITORIES  4 of 18 repositories ▾ ┐  [ Search… ]  ☐ Failures only  [ Save ]
│ ☑ your-org/api                       │
│ ☑ your-org/web                       │
│ ☐ your-org/old-service               │
└──────────────────────────────────────┘
```

That choice is a browser view preference: hiding a repository does not remove it
from the underlying configuration, so it is always available to select again.

Every visible repo also gets a horizontal band with its stats and its own branch
and workflow dropdowns:

```
┌─ 🟢 your-org/api ────────────────────────────────────────────────────────┐
│  24H      7D       NOW          ┌ BRANCHES  main ▾ ┐ ┌ WORKFLOWS  CI ▾ ┐ │
│  🟢 0     🔴 2     🟢 all green  │ ☑ main           │ │ all             │ │
│  of 4     of 19    CI · main    │ ☐ develop        │ │ ☑ CI            │ │
│                                 │ ☐ release/2.1    │ │ ☐ Deploy        │ │
└─────────────────────────────────┴──────────────────┴─┴─────────────────┴─┘
```

Tick the branches and workflows you want; the view updates as you tick. Nothing
checked means *everything*, and **Select all** in each dropdown resets to that.

The single **Save** button in the top bar writes all branch and workflow choices to
`config.local.json` — a git-ignored file, so it
never reaches the repo and survives across runs. It's the same format the fetcher
reads, so from the next refresh onward it stops collecting what you don't look at.
Saving needs the local dev server ([`scripts/serve.py`](scripts/serve.py), which
`./dev.sh` starts for you); on a hosted page there's nothing to write to, so the
button falls back to remembering the selection in that browser and says so.

The dropdowns always list **every** branch and workflow the repo has, not just the
ones currently collected — so a filter can never hide its own undo.

## Filtering

Three layers, and it's worth knowing which one you want:

| | Where | What it does |
| --- | --- | --- |
| **Collection** | `config.json` / `config.local.json` | Decides what the fetcher even asks GitHub for. Fewer API calls, smaller `status.json`. |
| **Per repo** | the band's dropdowns, then the single top **Save** | Picks branches and workflows for each repo. Instant in the view; written to `config.local.json` so collection follows. |
| **View** | the filter bar at the top | Narrows what's displayed by repository, text, or failure state. The choices persist in this browser. |

The filter bar gives you the repository picker, a search box (matches repo names
*and* workflow names), and a **failures only** toggle. They persist in your browser,
and the current collection filters are printed below the bar so the page always
tells you what it is watching:

```
[ terraform            ]  ☐ failures only  [Clear]     branches: main, master · workflows: all
   8 / 18 healthy  🟢 8  🔴 2  ⚪️ 8   showing 2 of 18
```

Filtering only hides rows — it never changes a repo's colour, its 24h/7d counts, or
the headline totals, which always describe the whole fleet. A card tells you how
many of its rows the filter hid.

## Tuning

- **Refresh interval** — the `cron` in
  [`update-dashboard.yml`](.github/workflows/update-dashboard.yml). Five minutes is
  GitHub's shortest supported schedule, and scheduled runs are best-effort: under
  load GitHub may skip or delay them.
- **Note:** GitHub disables scheduled workflows after **60 days** without repo
  activity. It emails you first; a manual run re-enables them.
- **Browser re-read interval** — `RELOAD_MS` in [`app.js`](app.js).
- **API budget** — per repo: one request per watched branch, one per workflow shown
  (its jobs are the dots), two for the dropdown options, and one for the latest
  release. Roughly `repos × (branches + workflows + 3)`. With a token you get 5,000
  requests/hour, so
  ~20 repos on one branch refreshing every 5 minutes sits around 2,000/hour. Narrowing
  the bands and saving is the cheapest way to cut it — that's the point of Save.
- **Stats depth** — the 24h/7d counts come from the newest 100 runs per branch. On a
  very busy repo the 7d figure can undercount; the strip's tooltip says so when the
  page was full.

## Development

```bash
node test.mjs
```

Asserts the pure helpers — repo parsing, newest-run-per-workflow de-duplication,
status mapping, roll-up counts, relative times. It runs in CI before every deploy.
Nothing to install, nothing to build; `python3 -m http.server` is enough to preview.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
starting. Two design constraints are intentional: **no dependencies** and **no build
step**. The whole application should remain understandable in one sitting.

Obvious next steps if you want them: aggregating Dependabot alerts, CodeQL, open
PRs and deployments into the same health view, or a webhook-driven variant for
real-time updates instead of a 5-minute cron.

Security issues should be reported privately; see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) — do what you like with it.
