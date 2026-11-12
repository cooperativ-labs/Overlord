# Releasing Overlord

Overlord is released by hand. The release gate
([CONTRACT.md](../CONTRACT.md) section 5, [ADR 0052](../decisions/0052-manual-release-gate.md))
adds one command before the publish steps and one after them. This directory
holds this procedure, the first release's range start
([baseline.json](baseline.json)) and one record per baseline
([169.2.1/](169.2.1/README.md)). Release records are evidence, not contract
text: changing only files here is a `none` change.

## What the gate checks

| Command | Refuses unless |
| --- | --- |
| `yarn release:preflight <none\|patch\|minor\|major>` | `HEAD` is a commit and the tree is clean (no modified, staged or untracked files); `yarn contract:check`, `yarn api:generate:check` and `yarn check:conformance-versions` pass; and `scripts/contract-impact.mjs` accepts the range from the `production` tag on `origin` (before it exists: the SHA in [baseline.json](baseline.json)) to `HEAD` with the declared impact. On success it writes `.release/preflight.json` (untracked): SHA, impact, contract version, OpenAPI `info.version`, range start and its source, timestamp. `--dry-run` runs every check and writes nothing. |
| `yarn cli:publish`, `yarn desktop:publish`, `yarn server:deploy` | The tree is clean and the stamp's SHA equals `HEAD`. With `--dry-run` they report a refusal and carry on with their own dry run. |
| `yarn release:finish` | The tree is clean, the stamp's SHA equals `HEAD`, the `production` tag on `origin` is still where preflight found it, and `prod` (on `origin` and locally) is an ancestor of `HEAD`. It then pushes `HEAD` to `prod` and moves `production` to `HEAD` in one atomic push (the tag only from the value it read; `prod` only as a fast-forward), and updates the local `production` tag and `prod` branch. `--dry-run` prints the commands without running them. |

`yarn server:deploy` runs `railway up` from the repository root and passes it
every argument except its own (`--dry-run`, `--skip-release-gate`, `--help`);
arguments after `--` are passed verbatim. It needs the Railway CLI on `PATH`,
logged in and linked to the `overlord-backend` service (`railway link`). The
`railway` npm devDependency is the TypeScript SDK behind
[.railway/railway.ts](../../.railway/railway.ts), not the CLI.
`OVERLORD_RAILWAY_BIN` overrides the executable.

## Every release

Run from a clone of `main` with `origin` reachable.

```sh
# 1. Build what you will publish, and bump the app version if you want to.
yarn version:update:minor          # optional: root, cli, desktop, webapp package.json
yarn desktop:package:prod          # desktop artifacts into desktop/release; rebuilds backend/dist-server

# 2. Commit everything, including files the build changed (backend/dist-server is tracked).
git status                         # must end up empty, untracked files included
git add -A && git commit -m "Release <version>"
git push origin main

# 3. Check the range since the last release and stamp HEAD.
yarn release:preflight <none|patch|minor|major>

# 4. Publish, in this order. Each refuses unless the stamp names HEAD.
yarn cli:publish                   # builds the CLI, then npm publish (add --otp <code>)
yarn desktop:publish               # GitHub release from desktop/release
yarn server:deploy                 # railway up

# 5. Record the release and ship the web app: moves `production`, fast-forwards `prod`.
yarn release:finish --dry-run      # optional: see the exact git commands first
yarn release:finish
```

The declared impact is the impact of the whole range since the last release,
not of the last commit: compare `contract/VERSION` at the `production` tag with
`HEAD` (`git show production:contract/VERSION`). A range in which nothing under
`contract/` changed (release records aside) is `none`.

Vercel deploys the web app to production from `prod`, so step 5 is what ships
it. Pushing `main` produces only preview deployments.

Do not commit between steps 3 and 5. Any new commit invalidates the stamp; run
preflight again for the new `HEAD`.

## The first release

The first release is the baseline, `169.2.1`
([169.2.1/README.md](169.2.1/README.md)). No `production` tag exists yet, so
preflight starts the range at the candidate SHA recorded in
[baseline.json](baseline.json), `9a71cf44214ab0ea85d655df5139221e91ca2c4b`
(contract `169.2.0`), and the range is `patch`.

1. Merge the phase 5 work into `main` without squashing or rebasing (a fast-forward
   or a merge commit), so the candidate SHA stays an ancestor of `main`;
   preflight refuses otherwise.
2. Sign the approvals in [169.2.1/README.md](169.2.1/README.md) and commit.
3. One-time Vercel change: in the web app's Vercel project settings, set the
   Production environment's branch (branch tracking; "Production Branch" under
   Git in older dashboards) from `main` to `prod`. From then on `main` produces
   preview deployments only, and production waits for step 5. Until the first
   `yarn release:finish` creates `prod`, production stays on its current
   deployment.
4. One-time Railway check: confirm whether the `overlord-backend` service also
   deploys automatically from a GitHub branch (its source is the GitHub
   repository in [.railway/railway.ts](../../.railway/railway.ts)). If it deploys
   on pushes to `main`, those deployments bypass the gate; turn automatic
   deployment off or point it at `prod`.
5. Then run "Every release" from step 1 with `yarn release:preflight patch`.
   `yarn release:finish` creates the `production` tag and the `prod` branch on the
   baseline commit.
6. Record the baseline SHA (`git rev-parse production`) and the preflight output
   in [169.2.1/README.md](169.2.1/README.md) under "Recorded after the first
   release", commit and push to `main`. That commit changes only a release
   record, so the next release can still be `none`.

From the second release on, [baseline.json](baseline.json) is ignored: the range
starts at the `production` tag.

## When preflight fails

Preflight writes no stamp when anything fails, so nothing can be published by
the gated commands. Fix the cause, commit, and run it again.

| Message | What to do |
| --- | --- |
| `The working tree is not clean` | Commit or remove the listed paths. Build outputs that are tracked (for example `backend/dist-server/`) must be committed. |
| `HEAD is not a commit` | Commit the release first. |
| `yarn <check> failed` | Run that command alone and fix what it reports; the checks are the same ones CI runs on every push. |
| `Declared contract impact X does not match the VERSION delta A -> B, which is Y` | Declare `Y` if the range really is that size. If the range contains a contract change that was never versioned, run `yarn version:contract <level>`, complete the changelog entry and commit. Never edit `contract/VERSION` by hand. |
| `A range whose contract version is unchanged cannot change contract/` | Something under `contract/` changed without a version increment: run `yarn version:contract <level>` with the right level, or revert the edit. |
| `contract/CHANGELOG.md at head has no current heading` | Complete the changelog entry for the current version. |
| `The range changes ... but adds no decision record` | A topic document or migration changed without an ADR; add one under `contract/decisions/` and list it in its index. |
| `contract/api/openapi.yaml changed in the range but info.version is still ...` | Move OpenAPI `info.version` and run `yarn api:generate`. |
| `The local production tag ... differs from origin's` | `git fetch origin +refs/tags/production:refs/tags/production` |
| `A local production tag ... exists but origin has none` | `git tag -d production`; only `yarn release:finish` places the tag. |
| `The range start ... is not in this clone` | `git fetch origin --tags` |
| `The range start ... is not an ancestor of HEAD` | Release from a descendant of the last release. Before the first release this means the phase 5 work was squashed or rebased; restore it as a merge. |
| `Could not read refs/tags/production from origin` | Preflight needs `origin`; check the network and your credentials. |

`yarn release:finish` refusals: a stamp mismatch means run preflight again for
`HEAD`; a moved `production` tag means someone released in between, so pull,
and run preflight again; a non-fast-forward of `prod` means `HEAD` does not
contain the current `prod`: merge `prod` into your branch (never force `prod`).

## Emergencies: the escape hatch

When a release must go out and the gate cannot pass (for example a broken
check during an outage), the publish steps accept an explicit bypass:

```sh
yarn cli:publish --skip-release-gate
yarn desktop:publish --skip-release-gate
yarn server:deploy --skip-release-gate
# or, for all three:
OVERLORD_SKIP_RELEASE_GATE=1 yarn server:deploy
```

Each prints a `RELEASE GATE SKIPPED` warning. Preflight and `yarn release:finish`
have no bypass, so the `production` tag never moves to an unchecked commit: after
the emergency, fix the cause, commit, and run the normal procedure so the next
range is checked. Record why the gate was skipped (for example in the commit
message of the fix).
