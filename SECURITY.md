# Security policy

## Supported versions

Security fixes are applied to the latest code on `main` and the latest published
release.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability or exposed credential.
Use [GitHub private vulnerability reporting](https://github.com/d2k-klin/gh-pipeline-viewer/security/advisories/new)
and include:

- the affected file or feature;
- reproduction steps;
- the potential impact;
- any suggested mitigation.

Never include real GitHub tokens or private repository data in a report.

## Security model

The browser reads only the generated `status.json`; it never receives the GitHub
token. Tokens are used by the local fetcher or GitHub Actions workflow and should
have the minimum documented read-only permissions.

Remember that a public GitHub Pages deployment also makes `status.json` public.
