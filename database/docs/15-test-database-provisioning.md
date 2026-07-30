# 15 — Test Database Provisioning

**Status:** Recommendation + implemented (decision record)
**Question:** "`TEST_DATABASE_URL` is set but there is no test database. Do we add one to
the Railway project? How do we minimize cost? What do we run in CI, and is there a
_very_ lightweight way to run it locally?"

## TL;DR

**Do not provision a second, always-on Railway Postgres service for tests.** Nothing in
the test suite needs a database that outlives the run:

- Postgres coverage is entirely opt-in — every battery falls back to SQLite and prints a
  loud `SKIP` when `TEST_DATABASE_URL` is unset.
- Each battery creates a random `ovld_test_<uuid>` schema, migrates into it, and
  `DROP SCHEMA … CASCADE`s it on teardown. No fixture data survives a run, so there is
  nothing to host.

Instead, the repo now boots a **throwaway Postgres that lives exactly as long as the
test process**:

```bash
yarn test:conformance     # ephemeral Postgres + the five Postgres-sensitive batteries
yarn test:with-pg         # ephemeral Postgres + the entire root suite
```

Cost: **$0**, locally and in CI. Production Postgres on Railway is never touched, and
there is no second service to forget about and pay for.

## What runs the database

[`scripts/test-db.mjs`](../../scripts/test-db.mjs) provisions the instance and
[`scripts/with-test-db.mjs`](../../scripts/with-test-db.mjs) wraps a command with
`TEST_DATABASE_URL` pointing at it. Backend selection is automatic (override with
`OVERLORD_TEST_DB_BACKEND=local|docker`):

| Backend  | When it is chosen                         | How it works                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `local`  | `initdb`/`pg_ctl` are available           | A fresh cluster in an OS temp directory: `--auth=trust`, `--no-locale`, `--no-sync`, and `fsync`/`full_page_writes`/`synchronous_commit` all off. No daemon, no image pull, no container; starts in about a second and the directory is deleted on teardown. |
| `docker` | no local binaries (the typical CI runner) | `postgres:17-alpine` with `/var/lib/postgresql/data` on a **tmpfs**, published on a free loopback port, started with the same durability settings off. Nothing is written to the host disk.                                                                  |

Binaries for the `local` backend are discovered in this order: `OVERLORD_TEST_PG_BIN`,
`PATH`, `postgresql@*` from Homebrew (newest major first), Postgres.app,
`/usr/lib/postgresql/*/bin`, then `node_modules/@embedded-postgres/<platform>-<arch>`.
That last entry means a machine with no system Postgres can get the fast no-daemon path
with `yarn add -D embedded-postgres` — a self-contained copy of real Postgres, not an
emulation.

An already-exported `TEST_DATABASE_URL` always wins: `with-test-db.mjs` uses it verbatim
and starts/stops nothing. That is how a Neon branch or a CI service container plugs in
without changing any command.

### Commands

| Command                                    | Effect                                                                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn test:conformance`                    | Builds the workspace packages, boots an ephemeral Postgres, runs the five Postgres-sensitive batteries, tears the database down. The fast local/CI feedback loop. |
| `yarn test:with-pg`                        | The full `yarn test` suite with `TEST_DATABASE_URL` injected, so every battery's Postgres half runs too.                                                          |
| `yarn db:test:up`                          | Start (or reuse) a long-lived instance and print its URL — useful for `psql` poking or repeated runs.                                                             |
| `yarn db:test:url` / `yarn db:test:status` | Print the URL / the JSON state of the running instance.                                                                                                           |
| `yarn db:test:down`                        | Stop it and delete the data directory or container.                                                                                                               |

`test:conformance` runs the batteries with `--test-concurrency=1`. The five files share
one throwaway `OVLD_HOME` (via `scripts/with-ovld-home.mjs`), and running them in
parallel makes them contend on the same SQLite file — the sequential run is deterministic.

State lives in the gitignored `.overlord/tmp/test-db.json`. `with-test-db.mjs` only tears
down an instance it started itself, so a `yarn db:test:up` instance survives test runs.

If no backend is available at all, `with-test-db.mjs` warns and runs the command anyway —
the suite degrades to the existing SQLite-plus-`SKIP` behavior instead of failing.

## CI recommendation

Run the same command CI-side that developers run locally:

```yaml
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: yarn
      - run: yarn install --immutable
      - run: yarn test:conformance
```

Nothing else is required: GitHub-hosted Ubuntu runners ship Postgres server binaries
under `/usr/lib/postgresql/*/bin` (the `local` backend) and Docker (the fallback), so the
script provisions the database itself. No `services:` block, no secret, no cloud
database, and the job cannot leak a live Postgres between runs.

If you prefer CI to own the database explicitly, the service-container form works
unchanged because an inherited URL takes precedence — add these two keys to the job
above:

```yaml
jobs:
  conformance:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env: { POSTGRES_PASSWORD: postgres }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s --health-timeout 5s
          --health-retries 5
    env:
      TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres
    steps: [...]
```

## Alternatives considered

| Option                                        | Monthly cost                                                                | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ephemeral local/CI Postgres** (implemented) | $0                                                                          | **Chosen.** Real Postgres, same major version as production, no standing resource, works offline.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Second Railway Postgres service               | Always-on service + volume, billed continuously; usage-based even when idle | Rejected. Pays 24/7 for a database whose entire contents are dropped at the end of each run. Keep it only if a shared, inspectable staging database is wanted for reasons other than tests.                                                                                                                                                                                                                                                                                                                             |
| Neon test branch (scale-to-zero)              | ~$0 on the free plan; a few cents of compute if it wakes often              | Reasonable second choice, and the recommended option when a **hosted** URL is genuinely needed (e.g. sharing a failing state, or exercising the Neon pooler specifically). Slower per run (network round trips, cold-start wake) and it can be reached from anywhere, so it needs a strictly non-production project.                                                                                                                                                                                                    |
| Reuse the production Railway database         | $0 extra                                                                    | Rejected outright. The batteries run DDL (`CREATE`/`DROP SCHEMA`) and migrations; pointing them at production is a data-loss hazard, however well the schemas isolate.                                                                                                                                                                                                                                                                                                                                                  |
| PGlite (WASM Postgres) over `pglite-socket`   | $0                                                                          | Rejected on evidence. The wire-protocol server serves one connection at a time; the conformance factory needs an admin pool plus a search-path-pinned session pool concurrently, and the concurrency batteries need more still. A two-pool smoke test failed with `Connection terminated unexpectedly` while the same test over a single connection succeeded. Viable only if the suites were rewritten to a single connection — which would delete the concurrency coverage that is the point of the Postgres battery. |
| Testcontainers                                | $0                                                                          | Rejected as redundant. It solves the Docker-lifecycle problem the `docker` backend here already covers in ~40 lines, and it always requires a Docker daemon — the `local` backend does not.                                                                                                                                                                                                                                                                                                                             |

## Notes

- `fsync=off` and friends are deliberate: the cluster is deleted seconds later, and
  turning durability off is the single biggest win in per-run wall clock.
- Version parity matters more than hosting parity. Keep the `local`/`docker` major
  version aligned with the production Railway Postgres major
  (`OVERLORD_TEST_DB_IMAGE`, or the Homebrew formula you install) so migrations are
  exercised against the same engine that runs them in production.
- `yarn test:with-pg` inherits whatever flakiness the root suite already has when test
  files run in parallel against one shared SQLite home (`yarn test:backend` currently
  trips a `SQLITE_BUSY_SNAPSHOT` in `token-scope.test.ts` for that reason). That is a
  pre-existing suite issue, unrelated to how the Postgres URL is provisioned.
- The `postgres` maintenance database is used directly; per-test isolation comes from the
  random schema each battery creates, exactly as it does against a shared cloud database.
