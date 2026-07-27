# Contributing to PipelineHive

Thanks for improving PipelineHive.

## Before you start

- Search existing issues before opening a new one.
- Keep changes focused on GitHub Actions monitoring and static deployment.
- Preserve the zero-dependency, no-build design.
- Never commit `config.local.json`, `status.json`, tokens, or private repository data.

For a substantial change, start a Discussion or open a feature request first so the
approach can be agreed before implementation.

## Local development

Requirements: Node.js 18+ and Python 3.

```bash
node test.mjs
./dev.sh
```

`node test.mjs` runs the complete self-check. `./dev.sh` fetches configured data and
starts the local dashboard; it needs a GitHub CLI login or `GH_TOKEN`.

## Pull requests

1. Fork the repository and create a focused branch.
2. Make the smallest change that solves the issue.
3. Add or update a self-check for non-trivial logic.
4. Run `node test.mjs`.
5. Update documentation when behavior or configuration changes.

Pull requests should explain the user-visible outcome and any privacy or API-rate
impact.
