# ADR 0052: A release gate around the manual release checks the contract range

- Date: 2026-11-12
- Status: accepted
- Contract version: 169.2.1
- Supersedes: none

## Context

Overlord releases by hand: the owner publishes the CLI to npm (`yarn cli:publish`),
publishes the desktop app to GitHub (`yarn desktop:publish`), deploys the backend with
`railway up`, then pushes, and Vercel deploys the web app from `main`. Nothing ties
these steps to a commit: production could run code that was never committed, so there
was no SHA to check a contract range against, and the web app shipped on every push to
`main` whether or not the backend had been released. [CONTRACT.md](../CONTRACT.md)
section 5 described the range check (ADR 0001) as the intended gate, not yet enforced.
Clear Comply enforces the same range check in a CI promotion workflow; Overlord has no
staging environment and the owner wants releases to stay manual.

## Decision

The release stays manual and gains one command before and one after
(`scripts/release-gate.mjs`; the procedure is [releases/README.md](../releases/README.md)):

- `yarn release:preflight <none|patch|minor|major>` requires a committed `HEAD` and a
  clean tree (untracked files included), runs `contract:check`, `api:generate:check`,
  `check:conformance-versions` and the range check from the `production` tag on `origin`
  to `HEAD` with the declared impact, and on success writes the untracked stamp
  `.release/preflight.json` (SHA, impact, contract version, OpenAPI `info.version`, range
  start and its source, timestamp).
- Before the first `production` tag exists, the range starts at the SHA recorded in
  [releases/baseline.json](../releases/baseline.json): the last commit before the
  baseline work, as Clear Comply's first staging promotion starts at its recorded
  baseline candidate. Once the tag exists the file is ignored.
- `yarn cli:publish`, `yarn desktop:publish` and the new `yarn server:deploy` (a thin
  wrapper that passes its arguments to `railway up`) refuse unless the tree is clean
  and the stamp names `HEAD`. Their dry runs report a refusal without failing.
- `--skip-release-gate` or `OVERLORD_SKIP_RELEASE_GATE=1` bypasses that check for an
  emergency, with a loud warning. Preflight and finish have no bypass.
- `yarn release:finish` re-reads the remote tag, refuses if it moved since preflight or
  if `prod` (remote or local) is not an ancestor of `HEAD`, then pushes `HEAD` to `prod`
  and the `production` tag in one atomic push (the tag only from the value it read),
  and updates the local refs. `--dry-run` prints the commands.
- Vercel's production branch becomes `prod`, so the web app ships with the release.
- Release records under `contract/releases/` are evidence, not contract text: the
  range check does not count them as a contract change under `none`.

## Consequences

- Every release names a commit, and its contract range is checked mechanically before
  anything is published; the `production` tag records what was released last.
- The owner commits before publishing. A build that changes tracked files (the backend
  bundle under `backend/dist-server/`) must be committed before preflight.
- A bare `railway up` or `npm publish` still bypasses the gate; the yarn commands are the
  supported path.
- The first release's range begins before the baseline work, so it is declared `patch`
  (169.2.0 to 169.2.1); later ranges begin at the `production` tag.
- Squash-merging or rebasing the baseline work onto `main` would make the recorded range
  start a non-ancestor of `HEAD`, and preflight refuses; it must be merged without
  rewriting.

## Alternatives considered

- A CI promotion workflow as in Clear Comply: rejected because the owner releases by
  hand and there is no staging environment.
- Running the range check on every push: rejected for the reason recorded in
  [CONTRACT.md](../CONTRACT.md) section 5; pushes run only mechanical checks.
- No escape hatch: rejected because an outage fix must be able to ship when a check is
  broken; the bypass is explicit and loud instead.
- Recording the range start in the stamp only: rejected because the first release would
  then have no agreed starting point.
