# Overlord plugin marketplace: implementation plan

Mission: coo:1232 (initial plan coo:1232.ef5r; review coo:1232.xv6n).
Originating recommendation: per:214.nqdz.
Prior work: coo:1080 ([marketplace-plugin-sync.md](marketplace-plugin-sync.md)).
Status: plan only, reviewed 2026-10-27. The local repo exists. The user has created the
public remote at https://github.com/cooperativ-labs/overlord-marketplace.git; a current
read-only `git ls-remote` returned no refs. No marketplace content or workflows have been
published by this objective, and no user plugins have been migrated.

## Decisions

| Decision | Value |
| --- | --- |
| Marketplace name (both hosts) | `Overlord`. It is case-sensitive in both CLIs; `@overlord` fails. |
| Plugin ids | `knowledgebase@Overlord` in Codex and in Claude Code |
| Repo | Dedicated. Local `/Users/jake/Development/Cooperativ/overlord-marketplace` (Overlord project resource `marketplace`, read/write). Public remote `https://github.com/cooperativ-labs/overlord-marketplace.git` created by the user; content publication remains pending. |
| Hosts | Codex (CLI and desktop) and Claude Code. Claude Desktop chat (`.mcpb`) and claude.ai org catalogs are out of scope. |
| v1 catalog scope | Knowledgebase only. Overlord's own plugin and Scribe come in later phases (see Phase 9). |
| Ingest model | Pull. The marketplace repo fetches each plugin's public release artifacts, validates them, and opens a PR. Merging to `main` is the release. |
| Update model | This workflow uses explicit updates. Codex: `codex plugin marketplace upgrade Overlord`. Claude: `claude plugin marketplace update Overlord`, then `claude plugin update knowledgebase@Overlord`. Claude supports optional marketplace auto-update; do not promise it is impossible or rely on it. |
| Migration | Done by hand by the user after launch. No tooling migrates or reinstalls plugins. |

## Verified behavior

The initial objective recorded the following tests on 2026-10-27 with Codex CLI 0.164.0
and Claude Code 2.1.311. Each test used an
isolated `HOME`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR`, and a disposable bare Git remote reached
through a `url.<file>.insteadOf` rewrite of the GitHub URL.

This review rechecked CLI versions/help, the Knowledgebase renderer and templates, and
official documentation. It did not rerun the install/upgrade experiments below. Those are
prior evidence, not completion of Phases 2–4. CLI verification does not sign off the desktop
app or authenticated skill/MCP behavior.

### Review findings and incorporated recommendations

| Priority | Gap in the original plan | Required correction |
| --- | --- | --- |
| High | Per-directory renames followed by validation could leave one host, catalogs and lockfile on different releases. | Stage and validate the whole candidate first; publish under one writer lock with rollback and interruption recovery. Test failure at each replacement. |
| High | ZIP listing and compressed-size checks did not bound extracted data or safely describe unusual names. | Inspect ZIP metadata and stream extraction with explicit limits, path collision checks and regular-file-only rules. |
| High | Version equality detects some deploy races but does not prove artifact provenance. Portable MCP settings could also escape a legacy-only validator. | Bind the lock to its reviewed source; check both MCP formats, exact server identity/endpoint and all executable surfaces; describe hashes as integrity evidence. |
| High | Bare-cloning an uncommitted candidate loses the candidate. The proposed upgrade could start with B already visible. Version substitution alone cannot change skill text. | Snapshot the candidate into a disposable Git repo; expose A before install, then B; deliberately change fixture skill content. |
| High | `origin/main` is not a stable PR baseline; initial additions and docs-only changes cannot require an A→B upgrade. | Use the PR base SHA, fetch history, distinguish additions/updates/unchanged plugins, and always run a synthetic two-version test. |
| High | Ingest inputs, branch updates and App credentials lacked a concrete trust/permission boundary. | Validate plugin ids as source keys, serialize catalog writes, use a trusted default-branch checkout, short-lived scoped tokens and reviewed PRs. No v1 auto-merge. |
| High | A public service's ZIP availability did not establish the package's distribution terms. | Preserve upstream notices and record the owner's redistribution authorization before publication; templates currently declare `UNLICENSED`. |
| Medium | MCP listing/cache presence was treated as runtime success; desktop and fresh-session gates were conflated. | Separate static/cache checks, authenticated skill invocation and desktop acceptance; report each gate independently. |
| Medium | Migration assumed one old id/scope, and preservation only covered Codex. Cleanup could remove unrelated Scribe work. | Inventory actual ids/scopes and duplicate endpoint registrations in both hosts; retain unrelated entries and defer legacy cleanup until scoped ownership is established. |
| Medium | GitHub-token behavior, deployment URL changes, drift-job permissions and publication readiness were underspecified. | Correct the token guidance, require a new upstream version for a rehost, define workflow permissions and separate repo existence from installable/live availability. |

### Review sources and contract impact

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins): the
  portable root manifest discovers `skills/` and `mcp.json` by convention. A missing
  legacy `skills` pointer alone is not a defect. Current CLI help supplies the command
  flags; earlier isolated tests supply the recorded upgrade/cache behavior.
- [Claude marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces) and
  [plugin management](https://code.claude.com/docs/en/discover-plugins): install ids,
  scopes, component inventory, optional auto-update and marketplace-removal effects.
- [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow): token-created PR checks can require
  manual approval; an App token supports unattended checks.
- Knowledgebase `packages/server/src/plugins.ts` and `packages/plugins/{chatgpt,claude-code}`:
  actual artifact layouts, version substitution, fixed skill list, cache headers and MCP
  configuration. `cli/src/connectors.ts` confirms Overlord's Codex-only export and local
  marketplace installs.

Contract baseline: **168**. This objective edits only this implementation document and
changes no component interface. Knowledgebase-only distribution uses external host plugin
interfaces; no Overlord contract bump is required for Phases 1–8 as scoped here. Phase 9
changes CLI/connector setup and doctor behavior: update `CONTRACT.md`, the relevant
`contract/*.yaml`, connector documentation and conformance/version metadata before code.
Impact then is CLI and Codex/Claude connectors plus their setup consumers; backend, core,
database, REST, web/mobile, runner and auth interfaces remain unchanged unless that later
design extends them.

**Codex**

- `codex plugin marketplace add <https/ssh URL | owner/repo[@ref]>` makes a full,
  non-shallow clone into `$CODEX_HOME/.tmp/marketplaces/<name>` and records
  `[marketplaces.<name>] source_type = "git"`. The name comes from the catalog's `name`.
  `file://` URLs are rejected. `--sparse` uses a `blob:none` partial clone. `--ref` pins a ref.
- `codex plugin add knowledgebase@Overlord` installs into
  `$CODEX_HOME/plugins/cache/Overlord/knowledgebase/<version>/`.
- `codex plugin marketplace upgrade Overlord` refreshed the catalog and also re-materialized
  the installed plugin at the new version (0.1.0 → 0.2.0 → 0.3.0). It kept the plugin
  enabled and removed the old cache directory. Nothing updated without the command.
- When a repo contains both `.agents/plugins/marketplace.json` and
  `.claude-plugin/marketplace.json`, Codex uses `.agents`.
- The **current** Knowledgebase render loads: the agent-plugins.org root `plugin.json` with
  `extensions.com.openai`, a root `mcp.json`, and `skills/`. Codex installed it as 0.1.1, and
  `codex mcp list` shows `knowledgebase → https://knowledge.chaselubitz.com/mcp`. Whether
  skills are discovered from this layout in a running session is **not yet verified**
  (Phase 4).
- `knowledgebase@overlord-local` and `knowledgebase@<other>` can both be enabled at once,
  which registers two MCP servers. `codex plugin remove knowledgebase@overlord-local`
  removes the install and its `config.toml` table, including per-tool approvals. It leaves
  `~/.agents/plugins/marketplace.json` untouched.
- A Git catalog that reuses the personal catalog's name (`overlord-local`) is shadowed: the
  plugin installs from the personal entry. This is why the name `Overlord` is distinct.

**Claude Code**

- `claude plugin marketplace add <git URL>` registers `Overlord` with `source: git` in
  `known_marketplaces.json`. `claude plugin install knowledgebase@Overlord` installs at user
  scope.
- `claude plugin marketplace update Overlord` refreshes **only the catalog**; the installed
  plugin stayed on the old version. `claude plugin update knowledgebase@Overlord` moved it
  0.2.0 → 0.3.0 and printed "Restart to apply changes". Both version directories remained in
  `~/.claude/plugins/cache/Overlord/knowledgebase/`.
- `claude plugin validate` passes for the dual-catalog repo and for the current Knowledgebase
  Claude Code render. Neither CLI needs authentication for marketplace add, install, list or
  validate, so CI smoke tests need no credentials.
- Claude documents an optional auto-update setting per marketplace (off by default for
  third parties). It was not tested, and the instructions do not rely on it.

**Knowledgebase deployment (live)**

`https://knowledge.chaselubitz.com/plugins/index.json` reports `version: "0.1.1"`.
`/plugins/knowledgebase-chatgpt.zip` returns 200. The source repo `jchaselubitz/knowledgebase`
is private. The rendering lives in `packages/server/src/plugins.ts`: it substitutes
`{{KB_URL}}` and `{{VERSION}}` (from `serverInfo().version`) in `packages/plugins`, and the
same three skills (`knowledgebase`, `feature-ranking`, `feature-handoff`) go into both ZIPs.

| Artifact | ZIP layout |
| --- | --- |
| Codex (`codex.plugin_package`) | `knowledgebase/{plugin.json, mcp.json, skills/*/SKILL.md, assets/icon.png, assets/icon-128.png}` |
| Claude Code (`claude.claude_code.plugin_package`) | `{.claude-plugin/plugin.json, .mcp.json, skills/*/SKILL.md}` at the root |

The deployment already serves its own Claude marketplace (`knowledgebase@knowledgebase`,
which uses an `archive` source). The user currently has Knowledgebase installed in Claude
from it.

## Repository layout

```text
overlord-marketplace/
  .agents/plugins/marketplace.json          # Codex catalog, name "Overlord"
  .claude-plugin/marketplace.json           # Claude Code catalog, name "Overlord"
  plugins/
    codex/knowledgebase/                    # = knowledgebase/ in the Codex ZIP, byte for byte
    claude-code/knowledgebase/              # = root of the Claude Code ZIP, byte for byte
  sources/
    knowledgebase.json                      # where to fetch; reviewed by hand
    knowledgebase.lock.json                 # what was fetched; written only by ingest
  scripts/
    ingest.mjs                              # fetch → verify → unpack → replace → lock
    validate.mjs                            # catalog, package, provenance and hygiene checks
    smoke.sh                                # install/upgrade in throwaway Codex and Claude homes
    lib/{zip.py, catalog.mjs, digest.mjs, semver.mjs}
  test/                                     # node:test suites + synthetic ZIP fixtures
  .github/workflows/{validate.yml, ingest.yml, cli-drift.yml}
  package.json                              # Node >=22; Python 3 ZIP helper; no npm runtime deps
  README.md                                 # user instructions
  RELEASING.md                              # maintainer workflow
  AGENTS.md, CLAUDE.md, .gitignore          # AGENTS.md/CLAUDE.md/.gitignore written by `ovld add-cwd`; extend, don't replace
```

**Each host gets its own copy.** Each directory is the unmodified upstream render for that
host. Merging the two into one directory would save one duplicated `skills/` tree, but each
directory would then match neither ZIP, provenance hashing would get harder, and each host
might pick up the other's manifest. The duplicate is generated, never edited, and checked
against the lockfile, so it cannot drift from the source.

### Codex catalog (`.agents/plugins/marketplace.json`)

```json
{
  "name": "Overlord",
  "interface": { "displayName": "Overlord" },
  "plugins": [
    {
      "name": "knowledgebase",
      "source": { "source": "local", "path": "./plugins/codex/knowledgebase" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

### Claude Code catalog (`.claude-plugin/marketplace.json`)

```json
{
  "name": "Overlord",
  "description": "Agent plugins maintained by the Overlord project.",
  "owner": { "name": "Cooperativ", "url": "https://www.ovld.ai" },
  "plugins": [
    {
      "name": "knowledgebase",
      "source": "./plugins/claude-code/knowledgebase",
      "description": "Search, read, and write your Knowledgebase knowledge graph.",
      "category": "productivity"
    }
  ]
}
```

Catalog entries leave out `version`. Each host reads the version from the plugin's own
manifest, so there is only one place to bump it.

### Source pointer (`sources/knowledgebase.json`)

```json
{
  "plugin": "knowledgebase",
  "deploymentUrl": "https://knowledge.chaselubitz.com",
  "index": "/plugins/index.json",
  "hosts": {
    "codex": {
      "indexField": "codex.plugin_package",
      "zipRoot": "knowledgebase/",
      "target": "plugins/codex/knowledgebase",
      "manifest": "plugin.json"
    },
    "claude-code": {
      "indexField": "claude.claude_code.plugin_package",
      "zipRoot": "",
      "target": "plugins/claude-code/knowledgebase",
      "manifest": ".claude-plugin/plugin.json"
    }
  },
  "allowedMcpOrigins": ["https://knowledge.chaselubitz.com"],
  "allowedMcpUrls": ["https://knowledge.chaselubitz.com/mcp"],
  "expectedMcpServers": ["knowledgebase"],
  "maxArtifactBytes": 5000000,
  "maxExpandedBytes": 20000000,
  "maxFileBytes": 2000000,
  "maxEntries": 500
}
```

A deployment URL change is a reviewed edit to this file **and a higher upstream release
version**. Ingest copies already-rendered bytes; it does not render or rewrite endpoints.
Changing the source URL alone at the same version must fail the immutability check.
Validate exact `https://knowledge.chaselubitz.com/mcp` endpoint and server name
`knowledgebase`, in addition to its origin; add explicit `allowedMcpUrls` and
`expectedMcpServers` fields to the source schema for these values.

### Lockfile (`sources/knowledgebase.lock.json`, generated)

```json
{
  "plugin": "knowledgebase",
  "version": "0.1.1",
  "sourceSha256": "…",
  "indexSha256": "…",
  "fetchedAt": "2026-…Z",
  "hosts": {
    "codex": { "url": "https://…/knowledgebase-chatgpt.zip", "zipSha256": "…", "treeSha256": "…" },
    "claude-code": { "url": "https://…/knowledgebase-claude-code.zip", "zipSha256": "…", "treeSha256": "…" }
  }
}
```

`treeSha256` is SHA-256 over UTF-8 `path\0sha256\n` lines for every regular file, using
plugin-relative POSIX paths sorted by UTF-8 bytes and lowercase file SHA-256 hex values.
Reject control characters in names, and normalize admitted file modes (directories 0755,
files 0644 in v1) before hashing. ZIP timestamps, entry order and `fetchedAt` are excluded.
`sourceSha256` hashes the exact source-pointer bytes; `indexSha256` hashes the fetched index.
Validation recomputes tree/source digests. These hashes detect drift, not source authenticity:
a reviewed lockfile and package can be changed together. HTTPS trust, PR review and optional
upstream checksums/release identifiers are separate evidence. A no-op ingest preserves the
existing lockfile, including `fetchedAt`, even if ZIP container bytes changed without a tree
change. Record a changed ZIP hash in diagnostics rather than creating release churn.

## Phases

### Phase 0: prerequisites

- [x] Name decided: `Overlord`.
- [x] Local folder created with `git init -b main` and linked as project resource
      `marketplace` (`read_write`) via `ovld add-cwd`.
- [x] User created the public GitHub repo
      `https://github.com/cooperativ-labs/overlord-marketplace.git` (2026-10-27).
      Recheck refs before implementation; preserve any remote history and existing entries.
      A cached web page describes an older `cooperativ` catalog, but the current read-only
      Git ref query returned no refs; do not seed or delete entries from that stale page.
- [ ] Record redistribution authorization for the published plugin files and assets and
      preserve upstream license/notices. Current templates say `UNLICENSED`; do not silently
      relabel the generated packages. This is a publication prerequisite, not a blocker to
      local validation or this plan review.
- [ ] Human: create a GitHub App, e.g. "Overlord Marketplace Bot", with Contents and Pull
      requests read/write, installed on this repo only. Store `MARKETPLACE_APP_ID` and
      `MARKETPLACE_APP_PRIVATE_KEY` as repo secrets. **Why an App:** a PR opened with the
      default `GITHUB_TOKEN` can leave PR-triggered workflows awaiting manual approval
      (other token-triggered events are generally suppressed). An App token allows checks
      to run unattended. App setup and remote CI activation are deferred to Phase 6;
      neither blocks local implementation.

### Phase 1: scaffold the repo (local)

1. `package.json`: `"type": "module"`, `engines.node >= 22`, and scripts `ingest`,
   `validate`, `smoke`, `test` (`node --test`). No npm runtime dependencies. Require Python 3
   explicitly for `lib/zip.py` (`zipfile` standard library), both for metadata inspection
   and bounded streamed extraction; do not parse human-readable `unzip` listings. Check
   Node/Python/Git/host CLI prerequisites and explain missing dependencies before mutation.
2. Both catalogs with `"plugins": []`, so validation can run before the first ingest.
3. `sources/knowledgebase.json` as above.
4. `README.md` (user instructions, below) and `RELEASING.md` (maintainer flow, below).
5. Extend the generated `AGENTS.md`/`CLAUDE.md`:
   - never hand-edit `plugins/**` or `*.lock.json`;
   - use `npm run ingest`;
   - never commit credentials;
   - `.overlord/` is managed by Overlord.
6. `.gitignore`: add `node_modules/`, `.tmp/`, `.smoke/`; retain Overlord-managed exclusions.
7. Before any push, compare the actual remote refs/catalog with this local scaffold. If a
   remote history exists, base the implementation on it; never force-push a newly initialized
   history over it or replace unrelated entries. v1's Knowledgebase-only scope describes new
   supported releases, not permission to delete pre-existing third-party entries.

**Done when** `npm test` and `npm run validate` pass on the empty catalog.

### Phase 2: ingest and validation tooling

**`scripts/ingest.mjs --plugin knowledgebase [--dry-run]`**

Production accepts only plugin ids matching a discovered `sources/<id>.json` key (bounded
kebab-case); reject path separators, unknown ids and unknown flags. Keep file/HTTP fixture
transports in test-only dependency injection, not a production `--index-url` escape hatch.
`--dry-run` downloads and validates the same candidate but changes no catalog/package/lock.

1. Acquire a single repo writer lock; recover any interrupted transaction before continuing.
   Load and validate `sources/<plugin>.json` (targets must be distinct, repo-confined and
   under their fixed host prefixes). Fetch `deploymentUrl + index`:
   - HTTPS only, 15 s total request deadline, bounded index body (256 KB);
   - validate every redirect hop, maximum three, same HTTPS origin, no URL userinfo;
   - successful HTTP status and JSON media type/schema; no credentials or secret query values.
2. Read `index.version` and require it to be strict semver. Resolve each host's artifact URL
   from `indexField`. Each must share an origin with `deploymentUrl`.
3. For each host:
   1. Download to a temp dir; apply the same status/redirect/deadline rules and cap actual
      streamed bytes at `maxArtifactBytes`, even without `Content-Length`.
   2. Record `zipSha256`.
   3. Inspect metadata and reject absolute/drive/UNC paths, backslashes, `..` or `.` path
      segments, control/NUL characters, symlinks and other special files, encryption,
      unsupported compression, entries outside `zipRoot`, duplicate normalized paths,
      file/directory collisions and case-folded/Unicode-normalized collisions. Permit only
      the necessary directory entries; strip `zipRoot` exactly once.
   4. Stream regular files into a new empty staging directory; enforce `maxEntries`,
      `maxExpandedBytes` and `maxFileBytes` against metadata **and actual output**, check CRCs,
      and confine every created path to that directory. No archive-supplied executables or
      permissions are preserved. Reject malformed/truncated archives and clean up staging.
4. **Race guard:** every host manifest's `version` must equal `index.version`. Refetch the
   index after both downloads and compare release fields. On a mismatch, fail without
   writes and retry later. Knowledgebase caches these responses for 300 s and may have
   mixed deployment replicas; version equality does not prove immutable release bytes.
   Verify upstream artifact checksums when supplied; retain this limitation in evidence.
5. Compare with the current lockfile:
   - Same version and identical host tree/source digests: report "up to date" and exit 0
     without changes, after checking the existing catalogs/packages are consistent.
   - Same version but different content: fail with "artifact changed without a version
     bump". Releases must bump `serverInfo().version`.
   - Lower version: fail under this release policy. Compare full SemVer precedence,
     including prereleases; build metadata alone does not qualify as an increase.
   - Higher version: continue.
6. Build a complete candidate containing both target trees, the lockfile and both catalogs.
   Merge only the selected plugin entry, preserving unrelated entries, fields and order.
   The source supplies validation policy; it must never rewrite the rendered MCP URL.
   Run the whole validator and secret scan against this candidate **before** touching live
   repo paths. A malformed host B must leave host A and all live metadata unchanged.
7. Apply the validated candidate under the writer lock, keeping backups and a transaction
   journal until all replacements and post-write validation succeed. Roll back every path
   on error; the next invocation recovers an interruption before accepting another release.
   Multiple directory/file renames are not one atomic filesystem operation. The publication
   boundary for users is the reviewed Git commit containing the complete release.
8. Print a structured PR summary: version old → new, source/artifact/tree digests, file
   counts and changed paths per host. Include no tokens or private source data. On any
   failure, return nonzero, retain the last good release and report the failing stage.

**`scripts/validate.mjs [--base <git-ref>]`** fails on any of these:

- **Catalogs**
  - either file is not JSON;
  - `name !== "Overlord"`;
  - duplicate plugin names;
  - the new v1 entries differ between hosts (exactly Knowledgebase on an empty baseline);
    retain any legacy unrelated entries and validate them under their recorded policy;
  - a Codex entry is missing `policy.installation`, `policy.authentication` or `category`;
  - a `path`/`source` does not start with `./`, escapes the root, or does not exist;
  - the new Knowledgebase source is not its fixed repo-local host directory, or an existing
    unrelated catalog entry was removed/rewritten without a separately scoped change.
- **Manifests**
  - the Codex manifest is not at `plugin.json` or `.codex-plugin/plugin.json`;
  - the Claude manifest is not at `.claude-plugin/plugin.json`;
  - the manifest `name` differs from the catalog entry name;
  - the version is not semver;
  - the two hosts have different versions;
  - the version differs from the lockfile;
  - a referenced local file is missing or escapes the plugin root (`skills`, `mcpServers`,
    icons, `logo`, `composerIcon`, screenshots), including nested
    `extensions.com.openai` fields; portable fixed `skills/` and `mcp.json` are checked
    even when there is no legacy path field. Validate each admitted format against its
    checked-in/versioned schema or explicit supported subset, not just field existence.
- **Skills**
  - a `SKILL.md` lacks `name`/`description` frontmatter;
  - the two hosts ship different skill sets or different `SKILL.md` bytes (the upstream
    renders are identical; a difference means a broken render).
- **MCP**
  - the union of portable `mcp.json`, legacy `.mcp.json`, manifest inline/path servers and
    OpenAI overrides does not resolve to exactly the expected server names and HTTPS URLs;
  - any URL has userinfo, an unapproved origin/path/query, or credentials in headers/fields;
  - portable transport is not `streamable-http`, or Claude transport is not `http`;
  - any executable surface appears in v1 Knowledgebase: stdio/`command`, hooks, scripts,
    `headersHelper`, installer commands, LSP servers, remote package sources or registered
    app mappings. These need a future explicit policy change, never silent acceptance.
- **Hygiene**
  - a `{{…}}` placeholder remains;
  - a denylisted file exists: `.env*`, `*.pem`, `*.key`, `id_*`, `*.p12`, `.npmrc`,
    `.netrc`, `auth.json`, `credentials*`;
  - a file matches the secret patterns: PEM blocks, `sk-`/`ghp_`/`github_pat_`/`xox[bp]-`/AWS
    key ids, or long base64 values in keys named `token|secret|password|apiKey`;
  - a file is over 2 MB.
- **Integrity:** a recomputed tree/source digest differs from the lockfile, or a generated
  target is unowned by a source/lock. Refetching is not required in offline validation.
- **PR mode (`--base <immutable-sha>`):** an existing plugin's rendered bytes changed but
  its version did not increase, or a plugin was removed without a scoped deprecation plan.
  Check additions as first installs, existing releases as upgrades, and docs/tooling-only
  changes without inventing a version bump. Changing only a timestamp/digest must not
  conceal a tree change; compare actual baseline files too. No prerelease fixture is
  admitted into the production catalog.

**`scripts/smoke.sh <repo-dir> [--upgrade-from <ref>]`**

1. Preflight and record the host versions. Make a temp `HOME` with empty `.codex` and
   `.claude`; export `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, XDG paths and a private Git config.
   Launch the CLIs from a scratch working directory outside the checkout/parents. Remove
   inherited credential/provider/session/plugin env vars, disable Git system config and
   credential helpers, and copy no auth, Keychain or real client state. Permit only the
   temp file-transport Git remote. Use traps to clean up only this test's directories.
2. Snapshot the candidate's explicit distribution file allowlist (including uncommitted
   authored changes) into a disposable Git repo and commit there only. Exclude `.overlord`,
   `.git`, secrets and test homes. A bare clone of the real repo alone is insufficient:
   it omits uncommitted files. Create a bare remote from this disposable repo and add
   `url."file://<bare>".insteadOf https://github.com/cooperativ-labs/overlord-marketplace.git`
   and `protocol.file.allow=always` only to the private Git config. For upgrade mode set
   remote `main`/HEAD to A **before either host registers the marketplace**; keep B hidden
   until both hosts have installed and verified A.
3. Seed unrelated state in the temp home:
   - a personal `~/.agents/plugins/marketplace.json` named `overlord-local` with
     `overlord`/`scribe` entries;
   - a `[mcp_servers.unrelated]` table in `config.toml`.

   - a second installed fixture plugin with its own harmless local fixture MCP endpoint,
     in both hosts, plus unrelated Claude marketplace/settings/MCP entries.

   Snapshot personal catalog bytes, parsed unrelated TOML tables, and unrelated Claude
   JSON/settings/installed-plugin records. TOML/JSON may be reserialized by the CLIs:
   compare unrelated values and enabled state semantically, rather than entire config
   bytes. The personal catalog itself must remain byte-identical.
4. Codex:
   1. Run `marketplace add`, then `plugin add knowledgebase@Overlord`.
   2. Check that `plugin list --json` shows `version` equal to the lockfile and
      `enabled: true`.
   3. Check that `codex mcp list --json` contains the expected Knowledgebase endpoint and
      enabled registration. Count by endpoint/plugin ownership, not an unanchored name grep.
      No login or live MCP request is required for this inventory test.
   4. Check that the cache directory contains every `skills/*/SKILL.md` from the repo,
      byte for byte.
5. Claude:
   1. Run `marketplace add`, then `install knowledgebase@Overlord`.
   2. Check that `plugin list` shows the version.
   3. Run `claude plugin validate` on the cached copy and the catalog;
      `claude plugin details knowledgebase` must inventory all three skills and its MCP
      server. Inspect all enabled scopes/installed records to count the effective plugin
      server; `claude mcp list` alone may not include every plugin-supplied registration.
6. With `--upgrade-from <ref>`:
   1. A was installed in steps 2–5. Confirm both hosts still report A and its skill digest.
   2. Fast-forward the bare remote's `main` from A to B. Before refresh, assert the installed
      copies are still A (no command-triggered refresh has happened).
   3. Run `codex plugin marketplace upgrade Overlord`, `claude plugin marketplace update
      Overlord` and `claude plugin update knowledgebase@Overlord`.
   4. Assert B's installed/enabled version, endpoint and package/skill digests in both hosts,
      preserving the parsed JSON output used for these checks. Derive installed cache paths
      from host records instead of assuming the candidate catalog alone proves installation.
   5. Record cache cleanup behavior separately: Codex previously removed A, Claude retained
      A and B. Old directories alone do not imply two active registrations. Gate on the
      active record/content; only enforce cleanup as a pinned-CLI regression observation.
7. Assert preservation against step 3, including unrelated installed/enabled fixture
   plugins in both hosts. Only the intended marketplace/plugin keys may change.
8. Assert exactly one effective Knowledgebase endpoint registration in each host and run a
   repeat upgrade: no version/content/config changes and no additional active server.
9. For a base lacking Knowledgebase, perform a first-install test rather than attempting
   to install nonexistent A. For unchanged versions test refresh/idempotency. Independently
   run the synthetic A→B test on every CI run, including initial and docs-only PRs.

**Tests (`test/`)** build synthetic ZIPs in memory and cover:

- happy path;
- zip-slip;
- symlink entry;
- compressed, per-file and expanded oversize (including misleading metadata), excessive
  entries, CRC errors, normalization collisions and truncated/encrypted ZIPs;
- index/manifest version race;
- same version with changed content;
- downgrade;
- foreign MCP origin;
- leftover placeholder;
- denylisted file;
- planted fake secret;
- hand-edited plugin file (tree digest);
- catalog mismatch between hosts;
- idempotent re-ingest (no diff).
- failed second-host validation and failure/interruption at each publication step (all
  original paths recovered), concurrent writers, HTTP errors/timeouts/redirect escape;
- portable/legacy/inline MCP overrides, unsafe references and executable-surface rejection;
- SemVer prerelease/build-metadata precedence; first-addition and docs-only base comparison;
- an existing unrelated catalog entry and plugin remains intact through ingest and upgrade;
- source URL change at the same version fails; dry-run changes no files.

**Done when** all tests pass, and `smoke.sh` passes locally against a fixture catalog.

### Phase 3: first ingest (local, reviewable)

1. Fetch the live index again and record its actual version (0.1.1 was the earlier snapshot).
   Run `npm run ingest -- --plugin knowledgebase` against that deployment.
2. Review the diff: two plugin directories, both catalogs, and the lockfile.
3. Run `npm run validate` and `scripts/smoke.sh .`.
4. Leave the real repo result uncommitted, or commit locally only when asked. Smoke creates
   disposable fixture commits itself. Nothing is pushed to GitHub.

### Phase 4: local end-to-end validation (two versions)

1. **Upgrade path.** Build public, self-contained synthetic fixture ZIPs in this repo with
   the same supported manifest layouts. A and B have increasing fixture versions and an
   intentionally changed marker in the same skill in both host renders. Test-only injected
   transports supply fixture index/ZIP bytes through the production validation pipeline.
   CI must not read a private Knowledgebase checkout or accept arbitrary production URLs.
   Then:
   1. Create A and B commits in a scratch repo; run `scripts/smoke.sh <fixture-repo>
      --upgrade-from <A-sha>` with B as candidate.
   2. Confirm the script really installs A before publishing B to its disposable remote,
      then changes installed version **and skill content** in both hosts.
   3. Separately test the unchanged live release through first ingest/install. If local
      Knowledgebase rendering is also exercised, call its authoritative renderer/test seam
      there; template substitution alone is not an independent implementation here.
2. **Preservation.** Covered by `smoke.sh` steps 3 and 7: personal catalog entries and
   unrelated config survive install and upgrade.
3. **Duplicate check.** In the temp home:
   1. Add a Knowledgebase entry to a **separate migration fixture** personal catalog (the
      normal preservation fixture has only `overlord`/`scribe`). Install
      `knowledgebase@overlord-local`, then install
      `knowledgebase@Overlord`. Record that both are enabled and there are two MCP
      registrations.
   2. Run the documented migration (`codex plugin remove knowledgebase@overlord-local`).
   3. Assert there is exactly one registration left.

   Do the same for Claude with a seeded legacy `knowledgebase` marketplace served by a
   local fixture. Also seed a standalone server pointing to the same endpoint; test the
   documented user-owned removal in the actual scope while preserving other servers.
4. **Fresh-session skill loading (authenticated acceptance, separate from credential-free CI).**
   1. Start a new `codex` session against a scratch `CODEX_HOME` that has only the
      marketplace configured. Signing in copies no files from `~/.codex`.
   2. Confirm host inventory exposes `knowledgebase:knowledgebase`,
      `knowledgebase:feature-ranking` and `knowledgebase:feature-handoff`. Invoke a harmless
      fixture skill and verify its version marker/resource, rather than relying only on a
      model's claim to list skills. For the real package, exercise an authorized read-only
      Knowledgebase request and its OAuth flow; do not write user data for a smoke check.
   3. Repeat with `claude` using a scratch `CLAUDE_CONFIG_DIR`; record any use of OS credential
      storage, since isolated config alone does not prove Keychain isolation.
   4. Record versions, fixture/release hashes, skill inventory and outcome. Mark auth/tool
      checks blocked if unavailable; static installation is not runtime acceptance.

   If the agent-plugins.org layout is not picked up for skills, this is the gate. Fix it
   upstream in Knowledgebase (per:214) after identifying the actual incompatibility.
   Portable root `skills/` discovery is documented; do not add a legacy pointer merely
   because it is absent. Do not patch generated artifacts in the catalog.
5. **Credential audit.**
   1. Run a pinned Gitleaks binary in directory/no-Git mode on the full distribution
      candidate, including sources, catalogs, docs and packages. Acknowledge intentional
      fake-secret fixtures only with narrow, reviewed exclusions.
   2. Search for the user's email, home paths and `~/.codex`/`~/.claude` paths.
   3. Check executable/MCP URLs against policy. Schema URLs, ordinary documentation links
      in skills, and homepage/author links are valid; do not reject all non-MCP origins.
6. **Desktop acceptance.** In a disposable desktop profile, register/install from the same
   Git source, restart and verify available skills and a read-only request. Record app and
   CLI versions separately. If an isolated desktop profile is unavailable, leave desktop
   support explicitly unsigned-off; CLI success cannot establish it.

**Done when** results are written to `RELEASING.md` § "Last verified", separately listing
automated install/upgrade, authenticated CLI skills/MCP, and desktop acceptance with versions,
date and hashes. Do not mark an unavailable gate passed or publish the corresponding host
support claim before it passes. Credentials and authenticated transcripts stay out of Git.

### Phase 5: GitHub workflows (authored locally, activated in Phase 6)

**`validate.yml`**

- Triggers: `pull_request` and `push` to `main`.
- Permissions: `contents: read`.
- Steps:
  1. Check out the candidate with full needed history (`fetch-depth: 0`,
     `persist-credentials: false`). Resolve and fetch the immutable PR base SHA from the
     event; pass it as an argument, never interpolate event text into shell code. On PRs run
     `node scripts/validate.mjs --base <base-sha>`; on `main` validate the candidate alone.
     Bootstrap with no base is an explicit first-install path, not a missing-ref success.
  2. Set up Node 22 and Python 3, run `npm test`, then the pinned Gitleaks directory scanner.
     Ordinary public PR validation receives no App secrets and needs no provider login.
  3. Install the pinned CLIs: `npm i -g @openai/codex@0.164.0
     @anthropic-ai/claude-code@2.1.311`.
  4. Run the synthetic A→B smoke on every run. For actual plugins compare the immutable
     base/candidate: run first-install for additions, A→B for increased versions, and
     refresh/idempotency for unchanged versions. Run fresh install on `main`. Validate the
     Claude marketplace and every Claude package explicitly. Do not require a nonexistent
     baseline release on the initial ingest PR.
  5. Run the pinned baseline on Linux and macOS (private homes, portable shell/temp handling),
     retaining redacted test results and hashes. Name one stable aggregate required job
     `validate`; it must depend on all checks and fail on any failure or unexpected skip.

Use `pull_request`, never `pull_request_target` with candidate code and secrets. Approval
requirements for fork PRs remain GitHub policy. Separate jobs must not accidentally inherit
an App token. Gitleaks patterns complement the structural package policy, not replace it.

**`ingest.yml`**

- Triggers:
  - `schedule` every 6 h;
  - `workflow_dispatch` with a `plugin` input (default: all sources);
  - `repository_dispatch` of type `plugin-release` with `client_payload.plugin`.
- Permissions: default `contents: read`; short-lived App installation token has Contents
  and Pull requests write on this repo only. Checkout trusted default-branch code with
  persisted credentials disabled; do not execute source/plugin code or PR branch scripts
  while holding the App token.
- Use one shared writer concurrency group for **all** ingest triggers/plugins (catalogs
  are shared), with in-flight jobs allowed to finish. Resolve `all` to a sorted source-key
  list and process serially. Treat dispatch payloads as untrusted data; validate against
  source keys and pass quoted arguments, never inline event expressions in a shell command.
- Steps:
  1. Fetch current `main`, run ingest/validation with no write token and produce the bounded
     summary. If no generated paths changed, exit with no commit or PR.
  2. Mint the scoped App token only for the publication steps. Stage only the selected
     generated host directories, source lockfile and two catalogs; reject any other path.
     Never stage the entire worktree, the source pointer, workflows or helper code as an
     automated ingest side effect.
  3. Rebuild bot-owned `sync/<plugin>` from current `main` and the validated candidate.
     Update with `--force-with-lease` only if existing branch/PR provenance proves bot
     ownership; stop if a human changed it. A newer upstream version updates that same PR.
  4. Open or update the PR using the exact structured summary written to a body file and
     `gh pr create`/`gh pr edit --body-file`. Detect an existing PR explicitly. Reruns after
     merge or partial API failure must be idempotent.
  5. Require normal `validate` checks and human review. **No v1 auto-merge.** Rebase/revalidate
     a stale release PR before merge; merged `main` is the release boundary.
- Report download/race/validation failures in the workflow summary. Preserve the last good
  catalog and open PR rather than generating an empty/broken release.

**`cli-drift.yml`**

- Triggers: weekly, plus manual dispatch.
- Permissions: test job `contents: read`; a separate reporting job `issues: write` only.
  No App credentials. Deduplicate failures into one open drift issue and update/close it
  after recovery. This scheduled issue creation is part of the Phase 6 CI authorization.
- Runs `smoke.sh` with the **latest** `@openai/codex` and `@anthropic-ai/claude-code`.
- On failure it opens an issue, so CLI behavior changes surface before users report them.
  The pins in `validate.yml` move forward only after this job passes.

Each workflow pins third-party actions by SHA and records scanner/CLI versions. The drift
job intentionally resolves latest CLI versions and records the exact resolved versions;
baseline validation keeps explicit pins. Scheduled execution is best effort: the 6-hour
poll is a target interval, not a delivery SLA.

### Phase 6: publication (requires authorization)

The human performs these, or authorizes an agent to perform them:

1. Repo creation is complete. Recheck remote refs, distribution authorization/notices and
   Phase 4 results. Before requesting publication authorization, prepare the exact candidate
   and report its file/release scope and any unavailable runtime gates. The user's note
   that the repo exists does not authorize a push, plugin migration or CI activation.
2. After authorization, publish the reviewed content while preserving any remote history.
   Register the existing URL as local `origin` if needed; do not overwrite Overlord-managed
   project metadata. Authorize enabling the schedule/App/issue-writing jobs explicitly with
   this publication, since pushing workflow files can activate them.
3. Install the GitHub App and add its two secrets; confirm repository settings permit the
   intended Actions/PR behavior. Never store the private key or token in Git or test output.
4. Run the initial validation and configure branch protection/rulesets to require the exact
   stable aggregate `validate` job, human PR review, linear history and no bot bypass.
5. Run `ingest.yml` via dispatch once. Expect "up to date".
6. Live verification in **disposable client profiles**, leaving the maintainer's installed
   plugins untouched:
   - `codex plugin marketplace add cooperativ-labs/overlord-marketplace`, then
     `codex plugin list --available --json` shows the catalog entry (this flag is needed for
     uninstalled entries); install it and verify installed/enabled version, tree and endpoint.
   - Do the same with `claude plugin marketplace add cooperativ-labs/overlord-marketplace`
     and `claude plugin install knowledgebase@Overlord --scope user`.

   Installable public availability is claimed only after this succeeds against GitHub.
   An existing public repository alone is not a working marketplace release.
7. Live **update** success is claimed only after the first real Knowledgebase release:
   1. The ingest PR is merged.
   2. `codex plugin marketplace upgrade Overlord` and
      `claude plugin marketplace update Overlord && claude plugin update knowledgebase@Overlord`
      report the new version.
   3. A fresh session loads it.

### Phase 7: Knowledgebase coordination (per:214, Knowledgebase repo)

These changes belong to the Knowledgebase repo and are tracked against per:214, not made
from here.

1. **After Phase 6 public first-install verification**, change
   `packages/server/src/plugins.ts` `pluginIndex`:
   - Replace the Codex `install_prompt` (manual ZIP extraction plus editing the personal
     catalog) with the marketplace commands.
   - Point `claude.claude_code.marketplace` at the Git repository and `install` at
     `knowledgebase@Overlord`; marketplace add takes a source, not the name `Overlord`.
   - Keep the ZIP URLs, because they are the ingest source and a manual fallback.
2. Optionally add versioned artifact URLs, `sha256` per artifact and a release/source id to
   `index.json`. Ingest verifies advertised checksums and records the identifier. This
   narrows replica/cache races; a checksum served by the same endpoint is integrity evidence,
   not an independent signature. Until then record the mutable-endpoint limitation.
3. Optionally send `repository_dispatch` (`plugin-release`, `{plugin: "knowledgebase"}`)
   after a deploy. This needs a fine-grained token stored in Knowledgebase's deploy
   environment. Until then, the 6-hourly schedule picks up releases.
4. Decide what happens to `/plugins/claude-code/marketplace.json`. **Recommended:** keep
   serving it for existing installs but stop advertising it. Otherwise two Claude routes
   exist for the same plugin, and a user who follows both gets duplicate MCP servers.
5. Keep MCP-only usage first-class:
   - per:214.e47z serves the skills over MCP;
   - per:214.dsba adds the tools-only fallback;
   - the plugin stays optional.

### Phase 8: Overlord repo cleanup

1. Inventory references to the legacy `marketplace/` tree and its owning work before
   proposing any removal. It includes Scribe, which v1 does not replace. Preserve it and
   any staged/concurrent changes until each affected plugin has a separately agreed
   retirement/replacement; do not equate the new Knowledgebase catalog with Scribe migration.
2. Update the status note at the top of `planning/feature-plans/marketplace-plugin-sync.md`
   to point here.
3. Add a short "Plugin marketplace" section to `connectors/README.md`. It says the Overlord
   plugin itself is still installed with `ovld agent-setup`, and links to the marketplace
   README for ecosystem plugins.

These bounded documentation changes do not alter a stable interface in contract 168. If
cleanup would change setup behavior, connector files or user plugins, split that into a
scoped implementation with contract/connector-version checks before editing.

### Phase 9: later catalog additions (out of v1)

**Overlord's own plugin**

- *Packaging.* It renders today via `ovld agent-setup codex --export`. Claude needs an
  equivalent `--export`.
- *Release artifacts.* Publish both renders as assets on the `connectors-v<VERSION>` GitHub
  release, so ingest stays pull-based.
- *Blockers.* `ovld agent-setup` must install `overlord@Overlord` from the Git catalog
  instead of writing `overlord@overlord-local`. It must detect an existing install of either
  id to avoid double MCP and hook registration, which would post every follow-up twice. It
  still writes the Codex rules and permission profile itself.
- *Contract impact.* This changes documented `ovld agent-setup` behavior, so it needs a
  contract bump. `ovld doctor` must check that the plugin and the CLI versions are
  compatible, because a catalog upgrade can move the plugin ahead of the installed `ovld`.

**Scribe**

- Needs a published, rendered artifact and a version index, the same as Knowledgebase.
- Then add its source/lock and per-host entries, distribution policy and smoke fixtures.
  Scribe's local command server needs its own allowed executable/runtime policy; v1's
  remote-HTTP-only Knowledgebase validator cannot admit it by adding a source file alone.

## User instructions (README content)

These instructions are for the published release after Phase 6, not a claim that packages
are already available. Existing users follow the migration below before installing again.

```sh
# Register once
codex plugin marketplace add cooperativ-labs/overlord-marketplace
claude plugin marketplace add cooperativ-labs/overlord-marketplace

# Install
codex plugin add knowledgebase@Overlord
claude plugin install knowledgebase@Overlord --scope user

# Explicit update
codex plugin marketplace upgrade Overlord
claude plugin marketplace update Overlord
claude plugin update knowledgebase@Overlord --scope user

# Verify
codex plugin list --marketplace Overlord --json  # installed, enabled, expected version
codex mcp list --json                           # expected endpoint; one effective server
ls "${CODEX_HOME:-$HOME/.codex}/plugins/cache/Overlord/knowledgebase/"
claude plugin list                             # knowledgebase@Overlord, enabled, version
claude plugin details knowledgebase             # three skills and MCP component
```

- For browsing before installation, use `codex plugin list --available --json`; an available
  catalog entry does not mean an installed copy is active.
- Start a new Codex session, or restart the desktop app, after installing or upgrading.
  Restart Claude Code after `plugin update`. Running sessions keep the previous skills and
  MCP configuration.
- The `@Overlord` suffix is case-sensitive.
- The workflow relies on explicit refresh. Claude's optional per-marketplace auto-update
  can be enabled by the user; leave it disabled when reproducing these checks. Do not
  promise Codex background updates based on these tests.
- Complete Knowledgebase sign-in/consent in the host's normal OAuth flow when making the
  first real request. Installation and an MCP list entry do not prove authentication.
- Do not also add a standalone Knowledgebase MCP server (`[mcp_servers.knowledgebase]` or
  `claude mcp add knowledgebase …`) when the plugin is installed. The plugin already
  registers it.

**Moving from an earlier install (user-run only).** First register the new marketplace and
verify Knowledgebase is available. Inventory installed ids, enabled scopes and standalone
servers in both hosts; save the old version/source so a failed install is recoverable.
Use the **actual** old plugin id; the following are the observed examples, not every user's
configuration. Remove the old active copy before enabling the new one:

```sh
# Codex (personal catalog / ZIP install)
codex plugin remove knowledgebase@overlord-local
codex plugin add knowledgebase@Overlord

# Claude Code (Knowledgebase's own marketplace)
claude plugin uninstall knowledgebase@knowledgebase --scope user
claude plugin install knowledgebase@Overlord --scope user
```

- If a standalone Knowledgebase MCP connection exists, remove/disable **that exact entry**
  in its real scope using native host management. Check user/project/local/managed config
  and MCP-only setups; names may differ even when endpoints are the same. Preserve every
  unrelated server. If managed policy controls it, resolve that policy before enabling a
  duplicate. A user who wants MCP-only usage keeps that path and need not install the plugin.
- Do not remove the old marketplace wholesale: Claude marketplace removal uninstalls its
  other plugins. It is optional only after confirming nothing else uses it.
- Reauthenticate or reapprove tools if the host requests it; old-id per-tool approvals are
  not guaranteed to transfer. Do not claim every old OAuth session is necessarily lost.
- Other entries in `~/.agents/plugins/marketplace.json` (`overlord`, `scribe`) are not
  affected. Its unused Knowledgebase entry can remain; hand-editing it is not required.
- Verify exactly one effective Knowledgebase endpoint in each host, then start a fresh
  session. If installation fails after removal, keep the new copy disabled and reinstall
  the recorded old source; do not leave both routes enabled during recovery.

## Maintainer workflow (RELEASING.md content)

1. **Release upstream.** Bump `serverInfo().version` in Knowledgebase and deploy.
2. **Ingest.** The next scheduled poll (target: every 6 h), or *Actions → ingest → Run
   workflow*, attempts a PR `knowledgebase <old> → <new>`. Failed or delayed polls leave the
   prior release active and report an error; this is not a guaranteed delivery time.
3. **Review.** CI runs `validate` and `smoke`, including an upgrade from `main`. Read the
   changed-skills diff in the PR.
4. **Merge.** Merging releases the update. Users receive it the next time they run the
   update commands.
5. **Recover a bad release.** Halt ingest if needed; publish a higher upstream version
   containing the last good content, validate and merge its PR, then explicitly refresh.
   A Git revert alone is not a tested client rollback; do not assert hosts can never
   downgrade. Emergency removal/reinstall of a pinned known-good source is a separate
   user-owned recovery with fresh-session verification.
6. **Change the deployment URL.** Deploy a **higher** plugin version at the new host; edit
   the reviewed source pointer (`deploymentUrl`, origins and exact endpoint allowlists),
   then ingest both hosts/lock/catalogs in the same reviewed release PR. Complete the
   expected new-origin OAuth/consent checks before advertising the endpoint. Do not
   hand-replace URLs or allow mutable same-version packages.

## Acceptance criteria

- Both catalogs add exactly the supported v1 scope (Knowledgebase); existing unrelated
  entries are preserved. `claude plugin validate .` and each Claude package validation pass.
- Ingest from the live deployment produces packages whose tree digests match the lockfile.
  Validation rejects every negative fixture.
- Isolated install of the freshly recorded live release succeeds in both CLIs. Synthetic
  A→B upgrade changes active installed version and skill marker/digest via native commands;
  the remote only exposes B after both hosts install A. A repeated refresh is idempotent.
- The personal catalog is byte-identical; unrelated settings, servers, enabled plugins and
  marketplaces are semantically unchanged in both hosts. The migration fixture leaves
  exactly one effective Knowledgebase endpoint, including standalone/plugin sources.
- Failed ingestion, including interruption and host-B failure, restores the entire old
  release. Negative fixtures cover resource limits, portable/legacy MCP and all stated gates.
- Authenticated fresh-session inventory/invocation passes for each advertised CLI host;
  desktop acceptance has its own recorded pass or explicit unsupported/unverified status.
- No credentials or personal paths appear in distributable files, the full-tree secret
  scan is clean, and required upstream notices/distribution authorization are recorded.
- Initial-addition, docs-only and normal upgrade CI paths pass with an immutable baseline;
  bot PRs receive the required aggregate check and review before merging.
- "Public" and "live update" are claimed only after the Phase 6 steps 6 and 7 checks pass
  against GitHub.

## Risks

| Risk | Mitigation |
| --- | --- |
| Codex may not discover skills from the agent-plugins.org layout. MCP registration is confirmed; skills are not. | Phase 4 fresh-session gate. If it fails, the fix goes upstream in Knowledgebase. |
| A CLI update changes marketplace semantics. | Pinned CLIs in `validate.yml`, plus the weekly `cli-drift.yml` against the latest versions. |
| A deploy changes ZIP content without a version bump. | Ingest refuses it with a loud failure. Versioning is enforced at the source. |
| Two Claude routes (`@knowledgebase` and `@Overlord`) lead to duplicate MCP servers. | Phase 7 step 4. The README migration removes the old route first. |
| GitHub-token PRs require manual approval or suppress downstream runs. | Use a scoped GitHub App token for unattended ingest PR checks. |
| Revert-only rollback is not a verified client recovery. | Publish a higher known-good release and explicitly refresh. |
| The case-sensitive name gets typed as `@overlord`. | Every documented command uses `@Overlord`; the README says so. |
| Mutable deployment endpoints or replicas serve mismatched packages. | Version/index recheck, hashes and upstream checksums when available; immutable release URLs remain an upstream improvement. |
| CLI-only results are mistaken for desktop/authenticated acceptance. | Record static, authenticated and desktop gates separately. |
| Existing Scribe/Overlord entries get removed while adding Knowledgebase. | Preserve unrelated entries and defer ownership-scoped legacy cleanup. |

## Handoff from this review

This objective revises the plan only. Next implementation starts with Phase 1 in resource
`marketplace`; Phase 0's local folder/link and public repo creation are complete. Finish
local tooling, ingest and the validation matrix before requesting the exact remaining
publication actions: publish the reviewed candidate, enable the scoped App/workflows and
configure required checks. No push, CI activation, real plugin migration or package release
is authorized or performed by this review. Knowledgebase onboarding switches only after
the published Git source passes first-install verification.
