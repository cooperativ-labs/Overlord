# Keeping the Cooperativ plugin marketplace in sync

> **Status (2026-09-27): Overlord retired from the marketplace.** The marketplace
> Overlord plugin needs the `ovld` CLI on `PATH`, so it only duplicated
> `ovld agent-setup codex` (minus the Codex rules and permission profile), and a
> Git marketplace plugin cannot reach the ChatGPT mobile or web apps. The
> Overlord package, its catalog entry, and `.github/workflows/publish-marketplace-plugin.yml`
> were removed; the `MARKETPLACE_APP_*` secrets and GitHub App are no longer
> needed by Overlord. The marketplace remains for Scribe. The analysis below is
> kept for the Scribe sync design.

Mission: coo:1080 (objective coo:1080.r2zx)
Marketplace repo: https://github.com/cooperativ-labs/overlord-marketplace (public)
Catalog: `.agents/plugins/marketplace.json` (OpenAI ChatGPT/Codex repo format)

## Question

The plugins in the marketplace change often in their origin repos (Overlord, Scribe).
There are two ways to keep the marketplace current:

1. **Point**: the catalog entry references the plugin in its own repo.
2. **Push**: a GitHub Action in each origin repo copies plugin updates into the
   marketplace repo.

## What the format supports

Pointing is possible. OpenAI's marketplace catalog accepts these `source` types:

| `source`     | Shape                                                        |
| ------------ | ------------------------------------------------------------ |
| `local`      | `{ "path": "./plugins/x" }`, relative to the marketplace repo |
| `url`        | a Git repo whose root is the plugin                          |
| `git-subdir` | `{ "url": "...git", "path": "./plugins/x", "ref": "main" }` (or `"sha"`) |
| `npm`        | `{ "package": "@scope/x", "version": "^1.2.0", "registry": "..." }` |

The docs also say: *"If Codex can't resolve a marketplace entry's source, it skips
that plugin entry instead of failing the whole marketplace."* A broken remote source
fails silently for users, and the plugin just disappears from the directory.

## Why pointing does not work today

The origin repos don't contain an install-ready plugin directory:

- **Overlord**: `connectors/adapters/codex/` is not the installable package.
  `ovld agent-setup codex` builds it (`cli/src/connectors.ts`) by merging the core
  `overlord-mission` skill with the Codex adapter notes, adding the skill's
  `reference/` docs, and adding shared scripts (`overlord-mcp.mjs`,
  `post-tool-use-hook.sh`). It also leaves out adapter-only files (`codec/`,
  `fixtures/`, `conformance-manifest.yaml`). A `git-subdir` pointing at the adapter
  would install an incomplete plugin.
- **Scribe**: `Integrations/scribe/` holds the source and a `.claude-plugin`
  manifest. The shipped package needs a built `dist/cli.mjs`, which is not
  committed, plus a `.codex-plugin/plugin.json`. That manifest currently exists
  only in the marketplace repo.

To point at the origin repos, each one would first have to commit a built plugin
directory, or publish it to a dedicated branch. That means you would need a build
step and a GitHub Action in each origin repo either way.

## Recommendation: push built packages into the marketplace with a PR

Keep `local` sources in the catalog. Add a release workflow to each origin repo
that builds the plugin package and opens a pull request against
`overlord-marketplace`, replacing `plugins/<name>/`.

Why push is the better choice here:

1. **You need a build step anyway.** Neither origin repo holds the installable
   artifact, and the push workflow is where that build runs.
2. **Nothing fails silently.** With `local` sources the files a user installs are
   visible and reviewable in the marketplace repo. They are also known to
   resolve, which avoids the skipped-entry behavior of remote sources.
3. **Releases, not every commit.** Pointing at `ref: main` would ship every merge,
   including broken ones, to every user on their next marketplace refresh.
   Pinning a `sha` avoids that, but then someone has to update the catalog on
   every release, which is the same automation as the push.
4. **One place to validate.** The marketplace repo can run one CI check on every
   PR: the catalog parses, each `path` exists, each manifest's `name` matches its
   catalog entry, and no package contains secrets or `.env` files.
5. **Portable.** The ChatGPT desktop "Add from a repository" flow is only
   documented and verified with repo-local sources. Remote-source support across
   every ChatGPT/Codex surface is less certain.

Opening a PR instead of pushing straight to `main` gives a review and CI gate. You
can let low-risk updates merge themselves by enabling auto-merge on those PRs.

### When to switch to pointing

Switch if a plugin gets its own repo whose root, or a committed subdirectory, is
the finished package, for example a future standalone `scribe-plugin` repo with
committed build output. In that case use
`{"source": "git-subdir", ..., "sha": "<release sha>"}` and let the same release
workflow bump the `sha` in the catalog. The automation shrinks to a one-line
catalog change per release.

## Proposed implementation

### Origin repo: Overlord (`.github/workflows/publish-marketplace-plugin.yml`)

- Trigger: push of a connector release tag (for example `connectors-v*`, matching
  the `connectors/VERSION` bumps from the `connector-versions` skill), plus
  `workflow_dispatch`.
- Steps:
  1. Check out Overlord, install the CLI dependencies, build `cli`.
  2. Build the Codex package into a temporary directory using the same code path
     as `ovld agent-setup codex`. This needs an export-only mode, for example
     `ovld agent-setup codex --export <dir>`, which writes the package without
     editing `~/.codex`. Add that flag first, so the marketplace package and the
     locally installed plugin come from the same code.
  3. Check out `cooperativ-labs/overlord-marketplace` using a GitHub App token
     (`actions/create-github-app-token`) that has `contents:write` and
     `pull_requests:write` on that repo only.
  4. `rsync -a --delete <dir>/ plugins/overlord/`, then open or update a PR on a
     stable branch (`sync/overlord`) with `peter-evans/create-pull-request`.

### Origin repo: Scribe (`.github/workflows/publish-marketplace-plugin.yml`)

- Move the Codex manifest into the Scribe repo, at
  `Integrations/scribe/.codex-plugin/plugin.json`, so the origin repo owns it.
- Trigger: a Scribe plugin release tag, plus `workflow_dispatch`.
- Build `Integrations/scribe` (`npm ci && npm run build`), stage the files that
  are currently in `plugins/scribe/` (`.codex-plugin`, `.mcp.json`, `dist/`,
  `skills/`, `ui/`, `README.md`, `THIRD-PARTY-NOTICES.txt`), then sync them and
  open a PR the same way (`sync/scribe`).

### Marketplace repo

- `.github/workflows/validate.yml` on every PR checks that:
  - the catalog is valid JSON and every `local` path exists;
  - `plugins/<name>/.codex-plugin/plugin.json` exists and its `name` matches the
    catalog entry;
  - every file referenced by a manifest (skills, hooks, `mcpServers`, icons)
    exists;
  - the manifest version is higher than on `main` (a package change without a
    version bump fails);
  - a simple secret scan and a denylist (`.env*`, `*.pem`, owner keys) pass.
- Branch protection on `main` requires `validate`. Auto-merge is optional.

### One-time setup (human)

- Create a GitHub App (or a fine-grained PAT limited to `overlord-marketplace`)
  with Contents and Pull requests write access. Install it on
  `overlord-marketplace`, and store its ID and private key as secrets in the
  Overlord and Scribe repos.

## Open decisions

- **Tag scheme decided:** `connectors-v<VERSION>`, where `<VERSION>` must match
  `connectors/VERSION`. The Overlord workflow also supports manual dispatch.
- **Auto-merge:** left disabled; sync PRs require normal repository review and
  branch protection can require the marketplace validation workflow.
- **Package export:** implemented as `ovld agent-setup codex --export <dir>` so
  both local installation and marketplace publishing use the same renderer.

## Implementation status (coo:1080.rrjh)

- Overlord now exports the Codex package without writing to the user's Codex
  home and opens/updates `sync/overlord` with a marketplace-scoped GitHub App
  token.
- The marketplace checkout now contains a validation workflow and script for
  catalog sources, manifest references and names, version increases, forbidden
  secret files, and common credential patterns.
- The Scribe origin workflow still needs to be added in the Scribe repository,
  including moving its Codex manifest into `Integrations/scribe`. That sibling
  checkout is outside this implementation workspace.
- Operations still need to create/install the GitHub App and set
  `MARKETPLACE_APP_ID` and `MARKETPLACE_APP_PRIVATE_KEY` in the Overlord
  repository. Marketplace branch protection should require `Validate
  marketplace` before merges.
