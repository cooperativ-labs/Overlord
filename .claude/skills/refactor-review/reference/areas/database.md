# Area Playbook — `database`

## Roots

```
database/src/                    # client, adapter, connection, migration ledger, local launch
backend/sqlite/migrations/       # SQLite migration SQL (Local edition)
backend/postgres/migrations/     # Postgres migration SQL (Cloud edition)
database/test/harness.ts         # shared test harness
packages/core/types/db.ts        # generated — read only
```

## Read first

- `CONTRACT.md` → **Database Layer** (§2) and the *REST API → Database* interaction surface.
- `database/AGENTS.md`, `database/docs/09-database-schema-contract.md`,
  `database/docs/10-database-table-groups.md`.
- `.claude/skills/kysely-codegen/SKILL.md` — types are generated; never hand-edit
  `packages/core/types/db.ts`.

Two properties dominate every finding here: **applied migrations are immutable**, and **the two
dialects must stay at parity**.

## Hard constraints on findings

- **Never propose editing an existing migration file.** Once shipped it has run on real
  databases. Corrections are new forward migrations. A finding that says "clean up migration X"
  is invalid unless X has demonstrably never shipped.
- **Never propose consolidating or renumbering migration history.** The `schema_migrations`
  ledger is keyed on the version prefix; renumbering re-runs or orphans migrations.
- **No destructive migration proposals as refactors.** Dropping a column or table is a data
  decision, not a restructuring.

The legitimate refactor targets are therefore: the migration *runner* and ledger code, the client
and adapter layer, dialect parity gaps, seeding and test harnesses, and forward-only cleanup of
schema that a completed migration left behind.

## Area-specific checks

### Dialect parity
Every migration must have its counterpart. Diff the two directories every run:

```bash
diff <(ls backend/sqlite/migrations) <(ls backend/postgres/migrations)
```

Differences are not automatically findings — some features are edition-specific (Postgres
`LISTEN/NOTIFY` queue support has no SQLite analogue). The finding is a difference that is
*unintentional*, i.e. a table or column one edition has and the other silently lacks. Rank these
`High` value: they surface as runtime failures only in the other edition.

### Duplicated dialect logic
`migration-ledger.ts` implements the same operation twice — once per dialect
(`pruneObsoleteMigrationLedgerPostgres` / `…Sqlite`) with different execution mechanics
(`DatabaseClient` vs. raw better-sqlite3). Judge each such pair on whether the *rule* is
duplicated or only the *mechanics*: identical rules with divergent implementations are the
high-value finding, because the rule drifts silently. Look for the same pattern in
`ext-everhour-migration-runtime.ts` and
`project-resources-resource-key-migration-runtime.ts`.

### Adapter boundary
`client.ts` / `adapter.ts` / `connection.ts` are the only place dialect differences should be
expressible. Flag dialect sniffing outside them:

```bash
grep -rn "sqlite\|postgres" packages/core/service backend --include='*.ts' \
  | grep -iv "migration\|test\|conformance\|import" | head -30
```

Every genuine hit is either a boundary leak or an intentional edge that should be named and
commented.

### Runtime migration modules
`*-migration-runtime.ts` modules run data transformations at boot. Each is by nature temporary:
once every deployment has passed it, it is vestigial. For each one, state whether it is still
required, and if it is not, propose a dated removal step. This is one of the few reliable sources
of `High`/`S` findings in this area — but require evidence (the migration's version and the fact
the ledger records it) before recommending removal.

### Loader and native binding handling
`better-sqlite3-loader.ts` isolates the native module. Flag direct `better-sqlite3` imports
elsewhere:

```bash
grep -rn "better-sqlite3" --include='*.ts' . | grep -v node_modules | grep -v better-sqlite3-loader
```

The native binding is environment-sensitive (a host-built binary fails inside a Linux pod), which
is exactly why the loader boundary exists — keeping it intact is worth reporting when breached.

### Test harness reuse
`database/test/harness.ts` plus the `*.postgres-conformance.test.ts` suites are the shared
scaffolding. Flag tests that build their own temp database or migration run instead of using the
harness, and conformance assertions duplicated across suites.

### Seeding
`storage-seed.ts` and `database/docs/13-database-seeding-framework.md` define seed data. Flag seed
values duplicated in tests instead of derived from the framework — this is what makes schema
changes expensive to land.

## Verification for refactors in this area

```bash
yarn lint
yarn db:build:prod
yarn test:database
yarn db:reset            # proves the full SQLite migration chain applies from empty
yarn db:codegen          # regenerate types if schema changed; commit the result
```

Postgres parity needs `yarn db:migrate:postgres` against a scratch database plus the
`*.postgres-conformance.test.ts` suites. In an agent pod where the native SQLite binding or
`psql` is unavailable, note it in the report and say which checks were not run rather than
claiming a pass.
