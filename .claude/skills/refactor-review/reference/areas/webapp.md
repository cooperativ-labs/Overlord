# Area Playbook — `webapp`

## Roots

```
webapp/web/pages/       # route-level screens (board, mission, calendar, my-missions, …)
webapp/web/components/  # feature components + components/ui (shadcn primitives)
webapp/web/lib/         # api client, react-query hooks, realtime, domain helpers
webapp/web/lib/hooks/   # shared React hooks
webapp/web/hooks/       # legacy hook location — consolidation candidate
webapp/shared/          # code shared with other webapp entry points
```

Excluded from review: `webapp/dist/`, `webapp/node_modules/`, `webapp/web/components/ui/*`
(vendored shadcn primitives — do not propose restructuring these; propose upgrading or replacing
them only if the user asks).

## Read first

- `CONTRACT.md` → the *Desktop Shell → REST (Renderer Surface)* interaction surface (the SPA is
  the renderer in Local edition) and the REST API layer it consumes.
- `webapp/AGENTS.md`, `webapp/README.md`.
- `.claude/skills/zod-v4-patterns/SKILL.md` before proposing anything about form validation.

Two hard rules bound findings here: the SPA talks to the backend only through the REST surface
(never to the database), and it must behave identically in the browser and inside the Electron
renderer.

## Known hot spots (baseline, contract v35)

| File | Lines | Why it is a standing candidate |
|---|---:|---|
| `webapp/web/lib/queries.ts` | ~1860 | Every query and mutation hook in one module |
| `webapp/web/components/projects/project-settings/ResourcesPage.tsx` | ~1500 | Screen holding form state, mutations, and layout |
| `webapp/web/components/MissionBranchControl.tsx` | ~995 | Branch UI plus branch decision logic |
| `webapp/web/components/settings/WebhooksPage.tsx` | ~790 | CRUD screen with inline forms |
| `webapp/web/components/MentionableTextarea.tsx` | ~775 | Editor behavior, mention parsing, keyboard handling |
| `webapp/web/pages/MyMissionsPage.tsx` | ~735 | Page-level state, filtering, drag-and-drop wiring |

## Area-specific checks

### `queries.ts` decomposition
One module holds all `useQuery`/`useMutation` hooks. Split candidates follow resource families
(missions, projects, resources, organizations, targets, webhooks, integrations). Two things make
this cheap and must be preserved exactly:

1. **Query-key shape.** `query-invalidation.ts` and `realtime-invalidation.ts` match on key
   tuples (`['project', id, 'everhour-link']`). Any move must keep keys byte-identical, and the
   valuable finding is often to extract a query-key factory *first* so keys stop being written as
   literals at both the producer and the invalidator.
2. **Invalidation coupling.** Before proposing a split, list which mutations invalidate which
   keys, and check the realtime path invalidates the same set. A mismatch found here is a
   high-value finding in its own right.

```bash
grep -c "useQuery(\|useMutation(" webapp/web/lib/queries.ts
grep -ohE "queryKey: \[[^]]+\]" webapp/web/lib/queries.ts | sort | uniq -c | sort -rn | head -20
```

### Container / presentation split
The recurring shape problem is a screen component that owns data fetching, form state, mutation
side effects, and layout. Propose the split by naming the extracted pieces: a hook for state and
mutations, presentational children for layout. Do not propose "break this up" without those
names. `MissionCard*` in `webapp/web/pages/` is the local example of the target shape — cite it.

### Hook location and duplication
`webapp/web/hooks/` and `webapp/web/lib/hooks/` both exist. Recommend one home and list the
moves. Then look for hook logic inlined in components that already exists as a shared hook
(clipboard copy, admin status, mobile breakpoint):

```bash
grep -rln "useState\|useEffect" webapp/web/components --include='*.tsx' | wc -l
grep -rn "navigator.clipboard" webapp/web --include='*.tsx' | grep -v use-copy-to-clipboard
```

### API access boundary
`lib/api.ts` + `lib/api-transport.ts` + `lib/api-base.ts` own request building, auth, and error
mapping. Flag `fetch` outside them, and any component that constructs a URL path by
concatenation instead of using the typed client:

```bash
grep -rn "fetch(" webapp/web --include='*.ts' --include='*.tsx' \
  | grep -v "api-transport\|fetch-sse\|api-base"
```

### Types from `@overlord/contract`
Request and response types come from `@overlord/contract`. Flag locally re-declared DTO shapes
and status/phase string unions that duplicate a closed contract enum — these are the drift that
breaks the SPA silently when the backend changes.

### Realtime + invalidation correctness
`realtime.tsx`, `realtime-invalidation.ts`, and `query-invalidation.ts` decide what refetches on
a change event. Predicate-based invalidation is fragile under renaming, so any structural change
to keys must be accompanied by the existing `realtime-invalidation.test.ts` and
`query-invalidation` coverage. If that coverage does not reach the keys being moved, adding it is
step 1 of the finding.

### Render-cost patterns
Prefer measurable claims: a `useEffect` whose dependency list forces a refetch loop, a context
provider holding a value rebuilt every render, list rendering that recomputes a derived sort on
every keystroke. `react-hooks/exhaustive-deps` is an **error** here, so a proposal that requires
suppressing it is not acceptable — restructure the effect instead.

### Desktop parity
Some `lib` modules branch on the Electron host (`desktop-chrome.ts`,
`desktop-native-theme.ts`, `native-notification-preferences.ts`, `local-target-client.ts`).
Flag host detection inlined in components rather than confined to those modules; that leak is
what makes browser-vs-desktop behavior diverge.

## Verification for refactors in this area

```bash
yarn lint
yarn typecheck:webapp
yarn test:webapp
yarn webapp:build:prod   # catches import-cycle and bundling regressions
```

For anything touching realtime, invalidation, or the desktop-parity modules, exercise the change
in the running app (`yarn dev`) as well — those paths are thinly covered by unit tests.
