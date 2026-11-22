# Running the release as a manually started GitHub Actions workflow

Mission coo:1361, objective coo:1361.6r0r. Evaluation only; nothing here is implemented.

Contract impact of this document: none. Contract impact of the proposed implementation: **patch**.
Releases stay deliberate and human-started; CI only runs the existing gated steps on GitHub's
machines instead of the owner's Mac. CONTRACT.md section 5 and ADR 0052 need clarifying wording,
not a new obligation. No module interface changes.

## Decisions taken (2026-11-22)

- **Releasing is a separate workflow that you start by hand** (`workflow_dispatch` on
  `.github/workflows/release.yml`). Pushes to `main` only run the existing checks
  (`contract.yml`) and never publish.
- **The workflow detects the contract impact itself.** You don't type it. If the detected
  impact is `major`, the run stops unless you ticked `allow_major` when starting it.
- **The workflow bumps the app version** (`yarn version:update:minor`), commits the bump to `main`
  and releases that commit. You no longer make the bump commit yourself.

Starting a release: Actions → Release → Run workflow (branch `main`). The run has two optional
inputs: `allow_major` (default off) and `dry_run` (default off).

## 1. The release flow today

The owner runs every release by hand on their own Mac (contract/releases/README.md, ADR 0052).
Three releases went out on 2026-11-21 alone.

| Step | Command | What it does | Credentials it uses |
| --- | --- | --- | --- |
| 1 | `yarn version:update:minor` | Rewrites the datetime segment of the root, cli, desktop and webapp `package.json` versions | none |
| 2 | `yarn desktop:package:prod` (`scripts/build-desktop.ts`) | Builds every workspace, rebuilds `better-sqlite3` for the Electron ABI, runs `electron-builder --mac --arm64`, signs and notarizes | Developer ID Application identity from the login keychain (found automatically); `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` from `.env.prod` |
| 3 | `git commit`, `git push origin main` | The commit includes the version bump and the rebuilt `backend/dist-server/` | git |
| 4 | `yarn release:preflight <impact>` | Clean tree; `contract:check`, `api:generate:check`, `check:conformance-versions`; range check from the `production` tag; writes `.release/preflight.json` | read access to `origin` |
| 5a | `yarn cli:publish` | `npm publish` of `overlord-cli` | an interactive npm login with 2FA OTP (the package is set to "Require two-factor authentication and disallow tokens") |
| 5b | `yarn desktop:publish` | `gh release create v<version>` with the dmg, zip, blockmaps and `latest-mac.yml`. The desktop app's auto-update feed is `releases/latest/download/`, so this ships the update to every installed app. | `gh` login |
| 5c | `yarn server:deploy` | `railway up` to `overlord-backend` | a logged-in, linked Railway CLI |
| 6 | `yarn release:finish` | Atomically pushes `HEAD` to `prod` and moves the `production` tag. Vercel deploys the web app to production from `prod`. | git push |

Already in place for CI:

- `scripts/publish-cli.ts` has a CI path. When `GITHUB_ACTIONS=true` it uses npm trusted
  publishing (OIDC) and removes `NPM_TOKEN`, `NODE_AUTH_TOKEN` and `YARN_NPM_AUTH_TOKEN` from the
  environment.
- `electron-builder` 26 can import a `.p12` from `CSC_LINK` into a temporary keychain. It can
  notarize with either an Apple ID or an App Store Connect API key.
- The release gate (`scripts/release-gate.mjs`) has no interactive steps apart from the impact
  argument, and the range check already computes the impact itself (see section 4A).
- The repository is public, so standard GitHub-hosted runners, macOS included, are free with no
  minute limit, and npm attaches provenance automatically. Larger runners would be billed; the plan
  doesn't need them.
- `main` and `prod` have no branch protection, so a `GITHUB_TOKEN` with `contents: write` can push
  the version bump and run `release:finish`.
- The desktop's packaged runtime env (`PACKAGED_RUNTIME_ENV_KEYS`) comes from loopback defaults
  that `.env.prod.example` already holds. A CI build does not need `.env.prod`.

## 2. Challenge 1: Apple signing and notarization

The build has to run on a macOS arm64 runner (`macos-15`). The package is Apple Silicon only.

**Signing identity.** Export the Developer ID Application certificate together with its private
key as a `.p12` from the Mac that holds it. Store it base64-encoded as the `CSC_LINK` secret and
its password as `CSC_KEY_PASSWORD`. `electron-builder` creates and removes a temporary keychain on
the runner. If the private key can't be exported, the Apple Developer account holder issues a
second Developer ID Application certificate for CI. Apple limits how many a team can hold, so
existing installs are not affected.

**Notarization credentials.** I recommend switching from the personal Apple ID and app-specific
password to an **App Store Connect API key**: a team key with the Developer role. Secrets:
`APPLE_API_KEY` (the `.p8` contents, written to a file on the runner), `APPLE_API_KEY_ID` and
`APPLE_API_ISSUER`. The key isn't tied to one person's account, isn't revoked when that person
changes their Apple ID password, and can be revoked on its own. The current Apple ID trio also
works if those three values are stored as secrets.

**Code changes needed:**

- `scripts/build-desktop.ts` `--notarize` accepts only `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD`
  / `APPLE_TEAM_ID`. It must also accept the API-key trio.
- `desktop/electron-builder.yml` sets `mac.notarize: true`, but its comment and the build script
  say notarization is off unless you pass `--notarize`. Today any build that finds the Apple env
  notarizes. Make it `false` and let CI pass `--notarize` explicitly. Then fail the build if
  `xcrun stapler validate` does not pass.
- `configureNodeGypPython()` fails when the default Python has no `distutils`. That is the case
  on current macOS runners (Python 3.12 and later). The workflow needs `actions/setup-python`
  with 3.11, or `pip install setuptools`.

**Operational notes.** Notarization usually takes minutes, but Apple sometimes takes much longer.
Give the job a timeout of about 60 minutes. Keep all Apple secrets in a GitHub **Environment**
(`release`) that only `main` can use, so pull requests and other branches can't read them.

## 3. Challenge 2: publishing to npm

This is mostly setup on npmjs.com. The script is already written for it.

1. On npmjs.com, add a trusted publisher to `overlord-cli`: GitHub Actions,
   `cooperativ-labs/Overlord`, workflow file `release.yml`, environment `release`. Keep "Require
   two-factor authentication and disallow tokens". Trusted publishing works with that setting, and
   it keeps leaked tokens useless.
2. The publish job needs `permissions: id-token: write` and npm 11.5.1 or later. Check
   `npm --version` on Node 26, or run `npm i -g npm@latest`. Don't set `NPM_TOKEN` in the workflow.
3. Make the publish safe to rerun. If `npm view overlord-cli@<version>` already resolves, skip the
   publish. Without this, rerunning after a later step failed (desktop, Railway) stops at npm
   with "cannot publish over existing version".

The `NPM_TOKEN` in `.env.prod` is no longer needed once this is in place.

## 4. Other changes the workflow needs

**A. Detecting the contract impact.** The range check already works the impact out:
`contractRangeViolations()` in `scripts/contract-impact.mjs` calls `impactBetween()` on
`contract/VERSION` at the range start (the `production` tag) and at `HEAD`. Today it only uses
the result to reject a declaration that doesn't match. Proposed change:

- `yarn release:preflight auto` (keeping the explicit `<none|patch|minor|major>` form for local
  releases) resolves the range start as it does now, computes the impact with `impactBetween()`,
  and runs the same checks with that impact. The stamp records the impact and that it was
  detected (`impactSource: "detected"`).
- When the detected impact is `major`, preflight refuses unless `--allow-major` is passed. The
  workflow passes it only when the `allow_major` input is ticked. A major release breaks
  compatibility and needs the owner's approval under CONTRACT.md section 5, so the one click goes
  where a slip would hurt most.
- The workflow writes the detected impact and the `contract/VERSION` change (`A -> B`) at the top
  of the run summary.

What auto-detection gives up is only the human cross-check that the range is the size you
expected. Every other preflight rule still applies: a range that changes `contract/` must bump
`VERSION`, a bump needs a changelog heading, a change that needs a decision record must add an
ADR, and an OpenAPI change must bump `info.version`. The bump itself is still made deliberately,
because every contract change goes through `yarn version:contract`.

Tests go in `scripts/release-gate.test.mjs`: auto mode for each level, refusal on `major` without
`--allow-major`, and the explicit form unchanged.

**B. Clean tree after building.** `backend/dist-server/` is listed in `.gitignore` but was added
to git anyway, and `desktop:package:prod` rebuilds it. In CI that leaves the tree dirty, so every
gated publish refuses to run. Both Dockerfiles build the bundle in their builder stage, so
removing it from git (`git rm --cached`) fixes this. `cli/src/serve.ts` falls back to this bundle
in source checkouts, so that path would need a build first. Every other staged output is already
ignored.

**C. The contract text.** CONTRACT.md section 5 says "Releases are manual", and ADR 0052 says the
owner wants releases to stay manual. A release you start by hand still matches that intent. What
changes is that the steps can run in CI and the impact can be detected instead of declared. That
needs a new ADR amending 0052, updated wording in section 5 and in `contract/releases/README.md`
(how to start a CI release and when to use `allow_major`), and `yarn version:contract patch`.
The gate's guarantees stay the same: a committed SHA, a clean tree, the range check, and an
atomic `prod`/`production` push.

**D. Railway.** The CI equivalent of `server:deploy` is the Railway CLI with a `RAILWAY_TOKEN`
project token scoped to production, running `yarn server:deploy -- --service overlord-backend --ci`.
An open item from the first-release procedure still applies: `overlord-backend` takes its source
from `github('cooperativ-labs/Overlord')`. If it deploys automatically on pushes to `main`, it
already skips the gate. A simpler option: point that service at the `prod` branch and drop
`railway up`. The backend would then ship when `release:finish` pushes `prod`, the same way the
web app does.

**E. Checkout and concurrency.** Preflight needs full history and tags (`fetch-depth: 0`). Use the
concurrency group `release` with `cancel-in-progress: false`. `release:finish` already refuses if
the `production` tag moved, so two overlapping runs can't both finish.

**F. The version-bump commit.** The workflow commits the bump with the workflow token. That push
doesn't start other workflows, so `contract.yml` won't run on it; the release workflow runs the
same validation itself first. If someone pushes to `main` between checkout and the bump push, the
push is rejected as a non-fast-forward and the run fails before anything is published. Start it
again.

## 5. Proposed workflow (`.github/workflows/release.yml`)

```yaml
on:
  workflow_dispatch:
    inputs:
      allow_major: { type: boolean, default: false, description: Allow a major contract release }
      dry_run: { type: boolean, default: false, description: Run every step with --dry-run }
concurrency: { group: release, cancel-in-progress: false }
permissions: { contents: read }

jobs:
  validate:   # reuse contract.yml via workflow_call (checks + backend tests)
  prepare:    # needs validate; ubuntu; fetch-depth 0; refuses unless run on main
              # yarn version:update:minor; commit and push to main (contents: write)
              # yarn release:preflight auto [--allow-major]; write detected impact to the summary
              # outputs: release SHA, version, impact; upload .release/preflight.json
  cli:        # needs prepare; checks out the release SHA; environment: release
              # permissions id-token: write; yarn cli:publish (skip if version already on npm)
  desktop:    # needs prepare; macos-15; environment: release; setup-python 3.11
              # yarn desktop:package:prod --notarize; stapler validate
              # yarn desktop:publish (contents: write)
  server:     # needs prepare; environment: release; RAILWAY_TOKEN; yarn server:deploy -- --ci
              # (or nothing, if Railway tracks `prod`)
  finish:     # needs [cli, desktop, server]; contents: write; yarn release:finish
```

Each publish job checks out the release SHA from `prepare` (not the branch head) and either
downloads the stamp or runs preflight again. The gate only needs the stamp's SHA to equal `HEAD`
and the tree to be clean. With `dry_run`, `prepare` doesn't push the bump, and every step runs
with `--dry-run`.

## 6. Work breakdown and estimate

Engineering: about 1.5 to 2 days.

1. ADR amending 0052, plus CONTRACT.md section 5 and the releases README
   (`version:contract patch`).
2. `release:preflight auto` with `--allow-major`, and tests in `scripts/release-gate.test.mjs`.
3. Remove `backend/dist-server/` from git and check the `ovld serve` source-checkout fallback.
4. `build-desktop.ts`: accept the API-key notarization variables and make notarization explicit.
   `electron-builder.yml`: `notarize: false`.
5. `publish-cli.ts`: skip when the version is already on npm.
6. `.github/workflows/release.yml` as above, plus a `workflow_call` trigger on `contract.yml`.
7. A `dry_run` release, then the first real CI release.

Human setup: about 1 to 2 hours, all outside the repository.

- Export the Developer ID `.p12`, or have the account holder issue a CI certificate.
- Create the App Store Connect API key.
- Create the `release` Environment, limited to `main`, with secrets `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and `RAILWAY_TOKEN`.
  Anyone with write access can start the workflow; add a required reviewer to the Environment if
  that is broader than you want.
- Configure the npm trusted publisher for `overlord-cli`.
- Decide between Railway tracking `prod` and `railway up`, and confirm whether `main` deploys
  automatically today.
