# Area Playbook — `platform-services`

## Roots

```
auth/src/auth/     # config, session, token issuance/verification, auth database bridge
auth/src/rbac/     # permissions, roles, scopes, authorizer
automations/src/   # registry + automations: compose-delivery, objective-manager,
                   # scheduling-engine, title-summarizer
scripts/           # repo maintenance and release scripts
overlord.rbac.toml # declared role/permission configuration
```

These three are grouped because each is small, each is a leaf dependency of the rest of the
system, and each is reviewed with a different mindset. Review all three in one pass, and keep
their findings in separate sections of the report.

## Read first

- `CONTRACT.md` → **Auth Layer** (§7), **Automations Layer** (§8), and the *Auth → Database
  (Identity Bridge)*, *Service → Automations (Automation Surface)*, and *MCP Server → Auth*
  interaction surfaces.
- `auth/AGENTS.md`, `auth/docs/07-user-token-authentication.md`,
  `auth/docs/08-role-based-access-control.md`.
- `automations/AGENTS.md`, `automations/docs/01-automations-overview.md`, and the co-located
  design notes (`objective-lifecycle.md`, `schedulingEngine.md`).

---

## `auth` — bias strongly toward "leave it alone"

Auth is the area where a tidier structure is least worth a behavior risk. Only report a finding
here if it makes the security properties *easier to verify*, and say so explicitly in the finding.
Decline the rest under *Explicitly not recommended*.

### Checks

- **Single verification path.** Token hashing, prefix handling, and TTL live in
  `auth/src/auth/token.ts`. Flag any hashing, comparison, or expiry check implemented elsewhere:

  ```bash
  grep -rn "createHash\|timingSafeEqual\|USER_TOKEN_PREFIX" --include='*.ts' \
    backend packages cli auth | grep -v node_modules | grep -v 'auth/src/auth/token.ts'
  ```

  Every hit outside the owner is either a leak worth consolidating or an intentional consumer of
  the exported helper — distinguish the two before reporting.

- **Permission declaration vs. enforcement.** `auth/src/rbac/permissions.ts` and
  `overlord.rbac.toml` declare permissions; `authorizer.ts` enforces them; backend routes name
  them via `requires`. Flag a permission declared and never enforced, or a route naming a
  permission that does not exist:

  ```bash
  grep -ohE "'[a-z_]+:[a-z_]+'" auth/src/rbac/permissions.ts | sort -u
  grep -rohE "requires: '[a-z_:]+'" backend --include='*.ts' | sort -u
  ```

- **Scope presets.** Preset-to-scope expansion (`scopeGrantsForPreset`) must exist once. Flag any
  place that rebuilds a scope set by hand — this is the recurring source of over-granted tokens.

- **No auth logic in transport.** `backend/http/bearer-session.ts` and `backend/auth.ts` adapt
  auth to Express; the decisions belong in `auth/`. Flag decision logic that has drifted into the
  transport edge.

- **Test coverage as a precondition.** `token.test.ts`, `authorizer.test.ts`, and `scopes.test.ts`
  are the safety net. If a proposed change is not covered by them, extending them is step 1 of the
  finding, not an optional follow-up.

---

## `automations` — check the registry seam

Automations are registered capabilities invoked by the service layer through one surface.

### Checks

- **Uniform automation shape.** `registry.ts` adapts each automation via `asRegisteredAutomation`.
  Flag automations whose `run` signature or error handling deviates, forcing special-casing at the
  registry or call site.

- **Input validation at the boundary.** `run` receives `unknown` and casts to `TInput`. Every
  automation must validate its own input rather than trusting the cast. Flag any that does not:
  the cast is the whole reason this needs checking.

  ```bash
  grep -rn "as TInput\|input as " automations/src --include='*.ts'
  ```

- **Provider client isolation.** `title-summarizer/gemini-client.ts` is the model-provider edge.
  Flag provider-specific request shaping, retry, or prompt assembly outside it, and any other
  automation growing its own HTTP client instead of reusing the pattern.

- **Pure logic vs. I/O.** `scheduling-engine` and `objective-manager` hold date and lifecycle
  rules that should be pure and unit-testable, with persistence left to the caller. Flag rule
  functions that reach for a database client or clock directly — non-injected time is the specific
  smell that makes these suites flaky.

- **Duplicated date logic.** `generateDateFromSchedule` is consumed by both
  `backend/repository.ts` and `packages/core/service/mission-schedules.ts`. Verify no consumer has
  grown its own copy of recurrence arithmetic.

  ```bash
  grep -rn "generateDateFromSchedule\|periodType" backend packages --include='*.ts' | grep -v test | head
  ```

- **Fixtures.** `external-automation.fixture.ts` is the shared harness for automation tests; flag
  inline duplicates.

---

## `scripts` — judge by whether it is a product surface

`scripts/` mixes one-off maintenance with checks that gate CI (`check-workspace-scoping.mjs`,
`check-native-runtime.ts`) and release automation (`publish-cli.ts`,
`publish-desktop-release.ts`).

### Checks

- **Gating checks deserve tests.** A script that `yarn check` depends on is product
  infrastructure; if it has no test, that is a legitimate finding.
- **Env resolution consistency.** `load-repo-env.mjs`, `with-dev-env.mjs`, and `with-prod-env.mjs`
  patterns must resolve environment the same way. Divergence produces
  "works via yarn, fails directly" bugs.
- **Destructive scripts must be obvious.** `clean-local-state.ts`, `delete-user.ts`, and
  `db:reset` destroy data. Flag any that lack a confirmation or an explicit target argument.
- **Duplication with the CLI.** A script re-implementing something `ovld` already does is a
  removal candidate — check before proposing, since scripts sometimes exist precisely to avoid
  depending on a built CLI.
- **Dead scripts.** Cross-check every script against `package.json` scripts and CI config; an
  unreferenced script is a deletion candidate once verified.

  ```bash
  for f in scripts/*; do n=$(basename "$f");
    grep -q "$n" package.json || echo "unreferenced in package.json: $n"; done
  ```

## Verification for refactors in this area

```bash
yarn lint
yarn typecheck:auth && yarn test:auth
yarn typecheck:automations && yarn test:automations
yarn check:workspace-scoping        # when a scripts/ check changed
```

Auth changes additionally require `yarn test:backend` (route authorization is enforced there) and,
for token-shape changes, `yarn test:cli` — the CLI holds the other end of user-token
authentication. Release scripts have no automated coverage: say so, and require a dry run.
