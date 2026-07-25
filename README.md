# PipelineHive 🐝

One page that tells you whether all your GitHub Actions are green — the latest run
of every workflow, on the branches you care about, with each pipeline's stages as a
row of dots you can hover and click. Every red dot links straight to the **step that
failed** — not the repo, not the run list, the exact line of the log.

```
PipelineHive 🐝     3 / 5 healthy   🟢 3  🔴 1  🟡 1        data from 2m ago

┌─ 🔴 Recent failures ──────────────────────────────────────────────────────┐
│ 🔴 your-org/api — CI     🟢🟢🔴⚪   main · 83ab921 · you · 7m ago          │
└───────────────────────────────────────────────────────────────────────────┘

┌─ 🔴 your-org/api ──────────────────┐  ┌─ 🟢 your-org/web ─────────────────┐
│  24H       7D        NOW           │  │  24H       7D        NOW          │
│  🔴 1      🔴 2      🔴 failing    │  │  🟢 0      🟢 0      🟢 all green  │
│  of 15     of 25     main          │  │  of 4      of 9      main         │
│ ────────────────────────────────── │  │ ───────────────────────────────── │
│ 🔴 CI        🟢🟢🔴⚪  main · 7m    │  │ 🟢 CI        🟢🟢🟢   main · 1h    │
│ 🟢 Security  🟢🟢     main · 7m    │  │ 🟢 Deploy    🟢🟢🟢   main · 1h    │
└────────────────────────────────────┘  └───────────────────────────────────┘
     ↑ hover a dot for detail, click it to open that job's log
```

Two ways to run it, same code:

- **Private, on your machine** — `./dev.sh`. Nothing is published; works with private
  repos; no hosting at all. Start here if any repo you watch is private.
- **Public, on GitHub Pages** — a scheduled workflow deploys it automatically.
  Great for an open-source project's status page.

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
| [`.github/workflows/update-dashboard.yml`](.github/workflows/update-dashboard.yml) | Cron, build, deploy to Pages |

`status.json` is generated at run time and git-ignored — nothing to commit, no
status noise in your history.

## Private mode — run it on your machine

The whole dashboard, none of it published:

```bash
./dev.sh
```

That's it. It borrows the token from your `gh` CLI login, writes `status.json`,
serves <http://localhost:8000>, and refreshes every 5 minutes until you Ctrl-C.

```bash
GH_TOKEN=github_pat_xxx ./dev.sh   # explicit token instead of the gh CLI's
PORT=9000 INTERVAL=60 ./dev.sh     # different port, faster refresh
```

Requirements: `node` 18+ and `python3` — both already on most dev machines.

**Keep your repo list out of git** with `config.local.json`, which is git-ignored
and takes precedence over `config.json`:

```bash
gh repo list <your-user> --limit 50 --json nameWithOwner --jq '{repos: [.[].nameWithOwner]}' > config.local.json
```

Now your private repo names, your dashboard, your machine — nothing leaves it
except the API calls.

## Public mode — deploy to GitHub Pages

**1. Fork this repo** (or use it as a template).

**2. Enable Pages:** repo **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

**3. Pick your repositories and branches** — edit [`config.json`](config.json) and
commit. See [Configuration](#configuration) below.

**4. Add a token if you want private repos** (skip for public-only dashboards).
Create a **fine-grained personal access token** — GitHub → Settings → Developer
settings → Personal access tokens → Fine-grained:

- **Repository access:** only the repos on your dashboard
- **Permissions:** `Actions: Read-only` and `Metadata: Read-only` — nothing else

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

## Configuration

```json
{
  "branches": ["main", "master"],
  "repos": [
    "your-org/api",
    "https://github.com/your-org/web",
    { "repo": "your-org/platform", "branches": ["main", "develop"] }
  ]
}
```

- **`branches`** — the branches you care about. Applies to every repo; a repo can
  override it with its own list. Runs on any other branch (feature branches, PRs,
  forks) are ignored, which is usually what you want on a dashboard.
- **Omit `branches`, or use `[]`** — every branch counts, and a workflow will show
  whichever branch ran it most recently.
- **`repos`** — `"owner/repo"` strings, full GitHub URLs, or objects with a branch
  override. Duplicates and malformed entries are dropped.

Only the **newest run per workflow** is shown; previous runs are never rendered.
They still feed the 24h / 7d failure counts.

Locally, put your list in **`config.local.json`** — it's git-ignored and takes
precedence, so your private repo names never reach the public repo.

## Read this before putting private repos on a public page

**A GitHub Pages site is always publicly accessible.** Restricting a Pages site to
people with repo access is a **GitHub Enterprise Cloud** feature; on Free and Pro
there is no way to do it. Making the repo private does not help — on Free, Pages
from a private repo isn't available at all, and on Pro the site builds but the URL
stays public.

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

| | Meaning |
| --- | --- |
| 🟢 | Latest run of every workflow succeeded |
| 🔴 | At least one workflow failed, timed out, or failed at startup |
| 🟡 | A run is in progress or queued |
| ⚪️ | No conclusion to trust — cancelled, skipped, awaiting approval, no runs, or an API error |

Each card shows the **newest run per workflow** — never a history of previous runs.
Repos sort worst-first, with a *Recent failures* roll-up above the grid.

**The stats strip** across the top of every card:

```
┌──────────────┬──────────────┬────────────────┐
│ 24H          │ 7D           │ NOW            │
│ 🔴 1         │ 🔴 2         │ 🔴 failing     │
│ of 15 runs   │ of 25 runs   │ main, master   │
└──────────────┴──────────────┴────────────────┘
```

Failed runs in the last day and the last week — across every workflow on your
branches — then the current state and which branches are being watched. A repo that
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

## Tuning

- **Refresh interval** — the `cron` in
  [`update-dashboard.yml`](.github/workflows/update-dashboard.yml). Five minutes is
  GitHub's shortest supported schedule, and scheduled runs are best-effort: under
  load GitHub may skip or delay them.
- **Note:** GitHub disables scheduled workflows after **60 days** without repo
  activity. It emails you first; a manual run re-enables them.
- **Browser re-read interval** — `RELOAD_MS` in [`app.js`](app.js).
- **API budget** — one request per repo per watched branch, plus one per workflow
  shown (to read its jobs, which are the dots). Roughly `repos × (branches + workflows)`.
  With a token you get 5,000 requests/hour, so ~20 repos on one branch refreshing
  every 5 minutes sits around 1,500/hour. Trim branches or slow the cron if you
  outgrow it.
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

Issues and pull requests welcome. Two house rules: **no dependencies** and **no
build step**. The whole point is that this stays a page you can read in one sitting.

Obvious next steps if you want them: aggregating Dependabot alerts, CodeQL, open
PRs and deployments into the same health view, or a webhook-driven variant for
real-time updates instead of a 5-minute cron.

## License

[MIT](LICENSE) — do what you like with it.
