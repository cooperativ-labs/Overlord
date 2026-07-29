# Area Playbook — `backend`

## Roots

```
backend/                 # Express app, repository layer, workers, extensions
backend/http/            # transport edges: bearer session, CORS/origins, SPA serving, meta
backend/execution/       # launch, runner, execution-target migration
backend/branching/       # branch planning, activity, resource observations
backend/automation/      # title + commit-message automation adapters
backend/ext/{github,everhour}/   # extension routers and services
backend/{sqlite,postgres}/migrations/   # dialect-specific migration SQL
```

Excluded from review: `backend/dist-server/`, `backend/node_modules/`.

## Read first

- `CONTRACT.md` → **REST API Layer** (§6), **Runner Layer** (§5), **Extension System** (§9),
  plus the *REST API → Database*, *Runner → REST*, and *Mobile → REST* interaction surfaces.
- `backend/AGENTS.md`, `backend/README.md` if present.
- `scripts/check-workspace-scoping.mjs` — its allowlist is the authoritative record of which
  ambient-workspace reads are intentional. Read it before claiming a scoping leak.

## Known hot spots (baseline, contract v35)

| File | Lines | Why it is a standing candidate |
|---|---:|---|
| `backend/repository.ts` | ~7200 | Single module for nearly all persistence across every entity |
| `backend/index.ts` | ~1900 | App assembly, route table, auth wiring, OAuth endpoints, MCP mount |
| `backend/workspaces.ts` | ~1470 | Workspace + membership + settings resolution in one unit |
| `backend/execution/launch.ts` | ~1200 | Launch config resolution, target selection, command assembly |
| `backend/ext/everhour/service.ts` | ~1140 | Extension service with its own client, mapping, and persistence |
| `backend/storage.ts` | ~860 | Storage abstraction spanning local and S3-compatible backends |

Re-measure each run; treat the table as the previous-run column, not as gospel.

## Area-specific checks

### Transport / service / persistence separation
The sanctioned direction is route handler → service (`packages/core/service/*`) →
repository → `DatabaseClient`. Flag:
- SQL or Kysely query building inside a route handler in `index.ts` or an `ext/*/routes.ts`
- `req` / `res` objects reaching functions in `repository.ts` or `packages/core/service/`
- business rules implemented in the route layer that a second surface (CLI, MCP) would need to
  re-implement — those belong in the service layer, and their absence there is what causes
  surface drift

### `repository.ts` decomposition
The recurring finding for this file is *not* "split it up". Do the work to name real seams:
group exported functions by entity and by read-vs-write, count fan-in per group, and propose
the one extraction with the best size-to-call-site ratio. A good extraction moves a coherent
entity's persistence into `backend/<entity>-repository.ts` (or an existing owner module) with
no behavior change and no new import cycles. Check for cycles before proposing:

```bash
grep -n "^import .*from '\./" backend/repository.ts | head -40
grep -rn "from '.*repository" backend/*.ts | wc -l
```

### Workspace / organization scoping
Multi-tenancy is enforced structurally: queries filter by workspace or organization rather
than trusting ambient state. Any refactor that moves a query must carry its scoping predicate.
Flag helpers that take no workspace parameter but read one from module scope — and check the
`check-workspace-scoping.mjs` allowlist before reporting, since the sanctioned edges are listed
there.

### RBAC annotation integrity
Routes in `index.ts` declare the permission they need via the `requires` annotation, enforced
centrally (`backend/rbac.ts`). When proposing route reorganization, every moved route must keep
its `requires` declaration. A refactor that silently drops one is a privilege escalation, so
treat "route reorganization" findings as at least `M` effort with an explicit check step.

### Dialect parity
Anything touching SQL must work on both SQLite and Postgres. Flag dialect-specific SQL that has
leaked out of the `sqlite/` + `postgres/` boundary into shared code, and any query construction
that only the Postgres conformance tests would catch. Refactors here always list
`yarn test:backend` plus the Postgres conformance suites as verification.

### Worker and dispatcher shape
`delivery-compose-worker.ts`, `webhook-dispatcher.ts`, `push-notification-dispatcher.ts`, and
`live-activity-dispatcher.ts` are variations on one pattern: claim job → do work → record
outcome → back off. Compare them side by side. Divergence in retry, backoff, or failure
recording is a high-value duplication finding; identical boilerplate is a medium-value one.

### Extension isolation
`backend/ext/*` may only reach core through sanctioned extension points. Flag an extension
importing `repository.ts` internals or a core module importing from `ext/`. The latter is the
serious direction — core must not know its extensions.

### Test placement
Backend tests sit next to their subject (`*.test.ts`) and share fixtures such as
`backend/secondary-workspace-fixture.ts`. Flag setup blocks duplicated across three or more test
files, and note when a hot-spot module's tests are too thin to make its refactor safe.

## Verification for refactors in this area

```bash
yarn lint
yarn check:workspace-scoping
yarn typecheck:backend
yarn test:backend
```

Add `yarn test:core` when the refactor moves anything into or out of `packages/core/service/`.
