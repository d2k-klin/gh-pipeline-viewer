# PipelineHive 🐝

One page that tells you whether all your GitHub Actions are green. Hosted free on
GitHub Pages, works with private repositories, and every red workflow is a link
straight to the **job that failed** — not the repo, not the run list, the failing
job's log.

```
PipelineHive 🐝     3 / 5 healthy   🟢 3  🔴 1  🟡 1        data from 2m ago

┌─ 🔴 Recent failures ──────────────────────────────────────────────────────┐
│ 🔴 your-org/api — CI            main · 83ab921 · you · 7m ago             │
└───────────────────────────────────────────────────────────────────────────┘

┌─ 🔴 your-org/api ─────────────┐  ┌─ 🟢 your-org/web ─────────────┐
│ 🔴 CI          main · 7m ago  │  │ 🟢 CI          main · 1h ago   │
│ 🟢 Security    main · 7m ago  │  │ 🟢 Deploy      main · 1h ago   │
│ 🟢 Docker      main · 7m ago  │  │ 🟢 CodeQL      main · 6h ago   │
└───────────────────────────────┘  └────────────────────────────────┘
```

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
| [`scripts/fetch-status.js`](scripts/fetch-status.js) | Runs in Actions, writes `status.json` |
| [`index.html`](index.html) + [`app.js`](app.js) | Renders `status.json` |
| [`.github/workflows/update-dashboard.yml`](.github/workflows/update-dashboard.yml) | Cron, build, deploy |

`status.json` is generated during deploy and git-ignored — nothing to commit, no
status noise in your history.

## Setup

**1. Fork this repo** (or use it as a template).

**2. Enable Pages:** repo **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

**3. Pick your repositories** — edit [`config.json`](config.json) and commit:

```json
{ "repos": ["your-org/api", "your-org/web", "you/side-project"] }
```

Full GitHub URLs work too; duplicates and malformed entries are dropped.

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

## Public or private dashboard

The page is as public as the repo hosting it. Decide before you add private repos:

**Public dashboard** (public fork + Pages). Anyone with the URL sees it. The token
is never exposed — it stays in Actions secrets and only ever runs server-side —
but `status.json` is served publicly, so **the names, branches, commit SHAs,
authors and pass/fail state of your private repos become public**. Fine for
open-source projects; not fine for a private company dashboard.

**Private dashboard**, two ways:

- *Private repo + Pages access control* — supported on **GitHub Enterprise
  Cloud**: make the fork private, enable Pages, then set **Settings → Pages →
  Visibility → Private**. Only people with repo access can load the page.
- *Don't publish it at all* — works on every plan. Keep the fork private, delete
  the `deploy-pages` steps if you like, and run it locally:

  ```bash
  GH_TOKEN=github_pat_xxx node scripts/fetch-status.js && python3 -m http.server 8000
  ```

  Then open <http://localhost:8000>. Nothing leaves your machine except the API
  calls.

If you're on a free or Pro plan and any watched repo is private, use the local
option — or accept that its build status is public.

## Reading the dashboard

| | Meaning |
| --- | --- |
| 🟢 | Latest run of every workflow succeeded |
| 🔴 | At least one workflow failed, timed out, or failed at startup |
| 🟡 | A run is in progress or queued |
| ⚪️ | No conclusion to trust — cancelled, skipped, awaiting approval, no runs, or an API error |

Each card shows the **newest run per workflow**, so a repo with 40 workflows still
gets 40 lines, not 400. Clicking a row opens the run on GitHub; clicking a **red**
row opens the failed job's log directly. The repo name links to its Actions tab.

Repos sort worst-first — whatever is broken is at the top, with a *Recent
failures* summary above the grid.

## Tuning

- **Refresh interval** — the `cron` in
  [`update-dashboard.yml`](.github/workflows/update-dashboard.yml). Five minutes is
  GitHub's shortest supported schedule, and scheduled runs are best-effort: under
  load GitHub may skip or delay them.
- **Note:** GitHub disables scheduled workflows after **60 days** without repo
  activity. It emails you first; a manual run re-enables them.
- **Browser re-read interval** — `RELOAD_MS` in [`app.js`](app.js).
- **API budget** — one request per repo, plus one per *failing* workflow to locate
  the failed job. With a token you have 5,000 requests/hour, so ~50 repos every 5
  minutes is comfortable.

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
