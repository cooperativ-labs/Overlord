# Web App Module — Agent Extension Guide

This file tells agents how to extend the **web SPA** in `webapp/web/`. The REST API Layer (`rest`) that backs it lives in [`backend/`](../backend/AGENTS.md) — do not add Express routes, realtime emitters, or `/ext/` modules under `webapp/`.

Read [`CONTRACT.md`](../CONTRACT.md) and the [component-contract skill](../.claude/skills/component-contract/SKILL.md) before making any cross-module change.

---

## What "extending the web app" means

| Extension type | Example user request | Where it lives |
| --- | --- | --- |
| SPA UI / client behavior | "Add a Shared State footer on the mission page" | `webapp/web/` |
| Shared DTO import for the SPA | "Consume a new field on `MissionDto`" | `@overlord/contract` via `webapp/shared/contract.ts` |
| New REST endpoint / realtime event / `/ext/` module | "Add `GET /api/missions/:id/artifacts`" | **[`backend/AGENTS.md`](../backend/AGENTS.md)** |

If the change touches URL paths, HTTP methods, DTO response shapes, SSE events, or auth at the API boundary, stop here and follow the backend guide instead.

---

## Before You Start

1. Read `CONTRACT.md` — REST API Layer section only when the SPA must match a new or changed API contract; otherwise stay within existing client types.
2. Read [`webapp/docs/web-app.md`](docs/web-app.md) for deferred UI requirements.
3. Prefer existing `webapp/web/lib/` helpers over inlining host/bridge/clipboard detection in components.
4. Shared hooks belong in `webapp/web/lib/hooks/` (not a top-level `webapp/web/hooks/` directory).

---

## SPA conventions

1. **Consume the REST surface only** — call `webapp/web/lib/` query/mutation hooks (or `api` helpers) that hit `/api` and `/realtime`. Do not open the database from the SPA.
2. **DTO types** — import from `@overlord/contract` or the shim `webapp/shared/contract.ts` (`export * from '@overlord/contract'`). Do not redefine response shapes locally.
3. **Cache keys** — use the shared `keys` factory in `webapp/web/lib/query-keys.ts` for TanStack Query keys that participate in realtime invalidation.
4. **Desktop parity** — confine `window.overlord` / Electron bridge detection to `webapp/web/lib/desktop-chrome.ts` (and callers of its helpers), not inline in components.

---

## File Placement Convention

```
webapp/
  docs/                   ← spec docs (web-app.md, ui/, implementation-plan.md)
  shared/
    contract.ts           ← re-exports @overlord/contract for SPA imports
  web/                    ← the React SPA (pure consumer of the rest surface)
    main.tsx router.tsx lib/ components/ pages/
    lib/hooks/            ← shared React hooks
    lib/query-keys.ts     ← TanStack Query key factory
    lib/desktop-chrome.ts ← desktop/Electron bridge helpers
  AGENTS.md               ← this file
  README.md               ← architectural overview

backend/                  ← REST + realtime server — see backend/AGENTS.md
packages/contract/        ← canonical typed DTOs (@overlord/contract)
```

---

## Cross-Module Checklist

- [ ] REST / realtime / `/ext/` work → follow [`backend/AGENTS.md`](../backend/AGENTS.md), not this file
- [ ] SPA changes stay in `webapp/web/` (plus `shared/contract.ts` re-export only)
- [ ] New DTO fields come from `@overlord/contract`, not hand-rolled local types
- [ ] Query keys used for invalidation come from `webapp/web/lib/query-keys.ts`
- [ ] Desktop bridge detection goes through `webapp/web/lib/desktop-chrome.ts`
