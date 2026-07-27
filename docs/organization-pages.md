# Host PipelineHive with GitHub organization Pages

PipelineHive can be owned and published by a GitHub organization without changing
the application. Choose the URL shape first.

| Option | Repository | Default URL | Use when |
| --- | --- | --- | --- |
| Project site | `<org>/pipelinehive` | `https://<org>.github.io/pipelinehive/` | The organization already has a website, or this is one tool among many |
| Organization root site | `<org>/<org>.github.io` | `https://<org>.github.io/` | PipelineHive should be the organization's main Pages site |

GitHub permits one root Pages site per organization. A project site is therefore
the safer default. See GitHub's documentation on
[organization and project Pages sites](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#types-of-github-pages-sites).

## 1. Create the repository

Use **Use this template** on the PipelineHive repository and select the organization
as the owner. Name it `pipelinehive` for a project site, or use the exact
`<org>.github.io` name for the organization root site.

If the organization already has an `<org>.github.io` repository, do not replace it.
Use a project site instead.

## 2. Configure the repositories to monitor

Edit `config.json`:

```json
{
  "branches": ["main"],
  "workflows": [],
  "repos": [
    "your-org/api",
    "your-org/web",
    {
      "repo": "your-org/platform",
      "branches": ["main", "release"],
      "workflows": ["CI", "Deploy"]
    }
  ]
}
```

An empty workflow list means all workflows. Repository objects can override the
shared branch and workflow choices.

## 3. Create the read-only token

Create a fine-grained personal access token with:

- **Resource owner:** the organization
- **Repository access:** only the repositories shown on the dashboard
- **Repository permissions:** `Actions: Read-only`, `Contents: Read-only`, and
  `Metadata: Read-only`

`Contents: Read-only` is used to read the latest published release. Organizations
can require owner approval for fine-grained tokens; if so, wait for approval before
running the workflow. Organization owners can review these requests under their
[personal access token policy](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization).

Add the token to the dashboard repository:

1. Open **Settings → Secrets and variables → Actions**.
2. Select **New repository secret**.
3. Name it `PIPELINEHIVE_GITHUB_TOKEN`.
4. Paste the token.

The token is used only by the scheduled workflow. It is never included in the
published site.

## 4. Enable organization Pages

An organization owner may first need to allow Pages publication under
**Organization Settings → Member privileges → Pages creation**. See
[GitHub's organization Pages policy](https://docs.github.com/en/organizations/managing-organization-settings/managing-the-publication-of-github-pages-sites-for-your-organization).

Then, in the dashboard repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions**, select **Update dashboard**, and choose **Enable workflow** if
   it is disabled.
4. Run the workflow manually once, or push to `main`.

The included workflow refreshes the dashboard every five minutes.

## 5. Confirm the published URL

- Project site: `https://<org>.github.io/<repository>/`
- Organization root site: `https://<org>.github.io/`

The application uses relative paths, so no base-path configuration is required.

## Private repositories and site visibility

The token can read private repositories, but the generated `status.json` contains
repository names, branches, commit SHAs, authors, workflow results, and release
metadata. A public Pages site exposes that information.

Organization ownership does **not** make a Pages site private. Private Pages
requires all of the following:

- The organization uses GitHub Enterprise Cloud.
- PipelineHive is a **project site** in an organization-owned private or internal
  repository. Access control is not available for the organization root
  `<org>.github.io` site.
- **Settings → Pages → Visibility** is explicitly set to **Private**.

A privately published site is available to people with read access to its
repository, not automatically to every organization member. Grant repository read
access to the intended organization users or team. Otherwise use local private
mode (`./dev.sh`) or place the static site behind an authentication layer.
