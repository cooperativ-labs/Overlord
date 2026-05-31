# Feature Flag & Progressive Rollout Strategy

## Goal

Roll out features to different user groups progressively from a **single codebase and a single
running instance**, with the ability to:

- Target named audiences such as `overlord-employees`, `beta`, `stable`, and `enterprise`.
- Add new audiences over time **without code or schema migrations**.
- Optionally point each audience at a **different desktop app version** (release channel), since the
  desktop shell is the one surface we can't hot-swap server-side.

This document proposes an approach. It is a plan, not an implementation — schema and code below are
sketches meant to be reviewed and sequenced, not applied as-is.

## Current State (what we already have)

- **`app_features` table** — a flat global toggle: `key`, `name`, `description`, `is_enabled`,
  `updated_at`. RLS lets any authenticated client `SELECT`; writes are service-role/admin only.
  Seeded keys today: `ssh`, `future-objectives`, `objective-git-revert`, `slack`.
- **`lib/app-features.ts`** — server-side resolver. `getAppFeatures()` reads the table with the
  service-role client (React `cache`d), and `isAppFeatureEnabled(key)` returns the global boolean.
  Call sites: `apps/web/app/(app)/layout.tsx`, project/feed/admin pages, mobile ticket screen, etc.
- **Admin surface** — `lib/actions/admin-features.ts` + `components/features/admin/AppFeaturesPanel.tsx`,
  gated by a single hardcoded `ADMIN_EMAIL` (`lib/auth/admin.ts`). Admins can create features and flip
  the global boolean.
- **`members` table** — `(organization_id, user_id, role)` where role is
  `VIEWER | AGENT | MANAGER | ADMIN`. This is our only existing notion of "who a user is," and it is
  org-scoped. `has_org_role` / `is_org_member` RPCs already exist.
- **`profiles`** — per-user row with `email`, plus freeform `preferences` and `onboarding` JSON.
- **Desktop** — a thin Electron wrapper that `mainWindow.loadURL()`s the hosted web app
  (`apps/desktop/electron/main.ts:255`). It is **not** a separate React build, so any flag resolved
  server-side automatically reaches desktop users. The native shell updates itself via
  `electron-updater` with a **single generic feed** resolved in
  `apps/desktop/electron/services/app-updater.ts` (`resolveFeedUrl()` → `ELECTRON_UPDATE_URL` or a
  Supabase Storage path). There are **no release channels today**.

**Implication:** `app_features` is the right primitive, but it only answers "is this on for
*everyone*?" We need to evolve it from a global boolean into per-audience targeting, and add an
audience model that is data-driven rather than an enum.

## Core Idea: Three Decoupled Layers

Keep these concerns separate so each can change independently:

1. **Audiences** — *who* a user belongs to. Named, data-driven segments (employees, beta, stable,
   enterprise, …). A user can be in more than one.
2. **Targeted flags** — *which* features are on for *which* audiences, with an optional
   percentage rollout. `app_features.is_enabled` stays as the global default / kill switch.
3. **Release channels** — a mapping from audience → desktop update feed, so a group can ride a
   different desktop build. This is the only layer that touches the native shell.

A single **server-side resolver** combines layers 1 + 2 into the set of enabled flags for a request.
Layer 3 is consumed only by the Electron updater.

```
                ┌─────────────┐
   user ───────▶│  Audiences  │── memberships (explicit, org, rule-based)
                └──────┬──────┘
                       │ segments: [overlord-employees, beta]
            ┌──────────┴───────────┐
            ▼                      ▼
   ┌─────────────────┐    ┌──────────────────┐
   │  Targeted flags │    │ Release channel  │
   │ (feature × seg) │    │  (most-advanced  │
   │  + global dflt  │    │   segment wins)  │
   └────────┬────────┘    └────────┬─────────┘
            ▼                      ▼
   resolveFlags(userId)    resolveChannel(userId)
     → web/desktop/mobile     → electron-updater feed URL
```

## Layer 1 — Audiences as Data

Audiences must be addable over time without migrations, so model them as rows, not as a Postgres
enum. Membership should support three sources so we are not forced to hand-assign every user:

- **Explicit** — an admin adds a user (or org) to a segment.
- **Org-derived** — every member of an organization is in a segment (natural fit for `enterprise`).
- **Rule-based** — e.g. "email ends in `@cooperativ.io`" auto-populates `overlord-employees`,
  "org role = ADMIN" etc. Rules are evaluated at resolution time so new users match automatically.

```sql
-- A named audience. New groups are just new rows.
create table audience_segments (
  key          text primary key,             -- 'overlord-employees', 'beta', 'enterprise'
  name         text not null,
  description  text not null default '',
  -- Ordered priority used for desktop channel + precedence (higher = more advanced/bleeding edge).
  rank         integer not null default 0,    -- employees 300, beta 200, stable 100, enterprise 100
  -- Optional declarative auto-membership rule (see resolver). Null = explicit/org only.
  rule         jsonb,                          -- e.g. {"emailDomain":"cooperativ.io"}
  release_channel text,                        -- optional: 'canary' | 'beta' | 'stable' | 'enterprise'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Explicit per-user or per-org membership. Either user_id or organization_id is set.
create table audience_members (
  segment_key     text not null references audience_segments(key) on delete cascade,
  user_id         uuid references auth.users(id) on delete cascade,
  organization_id bigint references organizations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  check (user_id is not null or organization_id is not null)
);
create unique index on audience_members (segment_key, user_id) where user_id is not null;
create unique index on audience_members (segment_key, organization_id) where organization_id is not null;
```

Seed the four starting segments:

| key                  | rank | release_channel | rule                                   |
| -------------------- | ---- | --------------- | -------------------------------------- |
| `overlord-employees` | 300  | `canary`        | `{"emailDomain":"cooperativ.io"}`      |
| `beta`               | 200  | `beta`          | `null` (opt-in / explicit)             |
| `stable`             | 100  | `stable`        | default — everyone not in another      |
| `enterprise`         | 100  | `enterprise`    | org-derived (per enterprise org)       |

`stable` is the implicit fallback: a user in no segment is treated as `stable`.

## Layer 2 — Targeted Flags

Extend, don't replace, `app_features`. Keep `is_enabled` as the **global default / kill switch**, and
add a targeting table that overrides it per segment.

```sql
-- Per-segment overrides for a feature. Absence of a row = "use the global default".
create table feature_segment_targets (
  feature_key  text not null references app_features(key) on delete cascade,
  segment_key  text not null references audience_segments(key) on delete cascade,
  is_enabled   boolean not null,
  -- Optional gradual rollout *within* this segment (0-100). Null = 100%.
  rollout_percent smallint check (rollout_percent between 0 and 100),
  updated_at   timestamptz not null default now(),
  primary key (feature_key, segment_key)
);

-- Optional: explicit per-user override for QA / support ("force this flag on for this user").
create table feature_user_overrides (
  feature_key text not null references app_features(key) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  is_enabled  boolean not null,
  primary key (feature_key, user_id)
);
```

### Resolution precedence (most specific wins)

For a given `(user, feature)`:

1. **User override** (`feature_user_overrides`) — if present, return it. (QA/support escape hatch.)
2. **Segment targets** — among the user's segments that have a row in `feature_segment_targets`,
   take the one whose segment has the **highest `rank`**. If it specifies `rollout_percent`, bucket
   the user deterministically (`hash(user_id + feature_key) % 100 < percent`) so the same user stays
   stable across reloads.
3. **Global default** — fall back to `app_features.is_enabled`.

This is backward compatible: with no segment rows and no overrides, behavior is identical to today's
global boolean. The existing `isAppFeatureEnabled(key)` keeps working for global-only flags.

## Layer 3 — Desktop Release Channels

Because the desktop only `loadURL`s the web app, **feature flags need no desktop changes** — they
resolve server-side and render the same in browser and Electron. The desktop channel layer is needed
only when we want a group on a **different native build** (e.g. employees test a new agent bundle or
Electron version before everyone else).

Plan:

1. **Publish channel-specific feeds.** electron-updater's generic provider reads `latest.yml` (or
   `latest-mac.yml`, etc.) from the feed URL. Today `resolveFeedUrl()` returns one path
   (`…/app-downloads/electron`). Extend it to append a channel segment:
   `…/app-downloads/electron/<channel>/`, and have CI publish builds per channel
   (`stable`, `beta`, `canary`, `enterprise`). `stable` stays the default for backward compatibility.
2. **Tell the shell which channel to use.** The web app already knows the user's segments at login.
   Expose the resolved channel (highest-rank segment's `release_channel`) to the Electron main
   process — simplest path is an authenticated endpoint (e.g. `/api/desktop/release-channel`) the
   shell calls on startup, cached locally, with `stable` as the offline fallback. `resolveFeedUrl()`
   then composes the channel into the feed URL before `setFeedURL`.
3. **Pinning for enterprise.** Enterprise can map to a slow/pinned channel so those orgs only get
   vetted builds. `allowDowngrade` is already `true`, which helps when moving a user to a more
   conservative channel.

This keeps "one instance of the software" intact — there is still one web app; only the *native
wrapper binary* differs per channel, exactly as the ticket allows.

## Putting It Together: the Resolver

Replace scattered `isAppFeatureEnabled` calls with one cached, request-scoped resolver that takes the
current user. Sketch (`lib/feature-flags.ts`):

```ts
export type ResolvedFlags = Record<string, boolean>;

export const resolveFlagsForUser = cache(async (userId: string): Promise<ResolvedFlags> => {
  const service = createServiceRoleClient();
  // 1. user's segments = explicit memberships ∪ org-derived ∪ rule matches (evaluated here)
  const segments = await resolveUserSegments(service, userId);  // returns [{key, rank, ...}]
  // 2. load global defaults, segment targets for those segments, and user overrides
  // 3. for each feature, apply precedence: user override → highest-rank segment target
  //    (with deterministic % bucketing) → global default
  // returns { 'slack': true, 'future-objectives': false, ... }
});

// Backward-compatible helpers keep working; they just delegate to the resolver.
export async function isFlagEnabled(userId: string, key: string): Promise<boolean> {
  return (await resolveFlagsForUser(userId))[key] ?? false;
}
```

Integration notes:

- **Resolve once per request on the server** (we already have the user in `(app)/layout.tsx` and in
  server actions) and pass the `ResolvedFlags` map down via context/props. Never ship the *targeting
  rules* to the client — only the resolved booleans — so unreleased features don't leak.
- **Keep evaluation server-authoritative.** Mobile and any client that reads flags should hit a
  resolved endpoint, not read the raw targeting tables. Tighten the current
  `authenticated_select_app_features` policy accordingly (clients read resolved flags, not targets).
- **RLS:** targeting tables (`feature_segment_targets`, `audience_*`, overrides) are service-role /
  admin write, and not directly client-readable; resolution runs through the service-role resolver.

## Admin UX

Extend the existing `AppFeaturesPanel`:

- Per feature, show a matrix: **global default** + a row per segment (On / Off / % rollout), plus a
  "user overrides" list for QA.
- A separate **Audiences** admin panel to create segments, set `rank` + `release_channel`, edit the
  membership rule, and add explicit user/org members.
- Replace the single hardcoded `ADMIN_EMAIL` gate with the `overlord-employees` segment (or an
  `ADMIN` role check) so access control itself rides the new model.

## Rollout Phases

1. **Phase 0 — Audiences (no behavior change).** Add `audience_segments` + `audience_members`, seed
   the four segments and the employee/enterprise rules, build the resolver `resolveUserSegments`, and
   an admin Audiences panel. Nothing reads flags differently yet.
2. **Phase 1 — Targeted flags.** Add `feature_segment_targets` + `feature_user_overrides`, build
   `resolveFlagsForUser`, and migrate `(app)/layout.tsx` + a couple of call sites to the resolver.
   Verify identical behavior with no segment rows present.
3. **Phase 2 — Migrate all call sites** off `isAppFeatureEnabled` to the user-aware resolver; extend
   the admin Features panel to the per-segment matrix. Pilot by enabling one in-progress feature for
   `overlord-employees` only, then `beta`.
4. **Phase 3 — Desktop channels.** Add the release-channel endpoint, channel-aware `resolveFeedUrl()`,
   and per-channel CI publishing. Default everyone to `stable`; move employees to `canary`.

Phases 0–2 deliver the core "progressive rollout from one instance" goal; Phase 3 is additive and only
needed when a group must run a different native build.

## Why This Shape

- **Data-driven segments** satisfy "add more groups over time" with zero migrations — a new audience
  is one row plus optional rule.
- **Layered design** means flags, audiences, and desktop channels evolve independently and most
  features never touch the desktop layer at all.
- **Backward compatible** — `app_features.is_enabled` remains the global kill switch; existing code
  paths keep working until migrated.
- **Single instance preserved** — one web app serves all audiences; only the optional native wrapper
  binary differs per channel, which the ticket explicitly permits.
- **Server-authoritative** — resolved booleans (not targeting rules) reach clients, so unreleased
  features stay private.

## Open Questions / Decisions for the PM

1. **User vs org granularity for each group.** `enterprise` is naturally org-scoped (via `members`),
   `beta`/`stable` are user-scoped, `overlord-employees` is rule-scoped (email domain). Confirm
   whether any group needs both.
2. **Self-service opt-in for `beta`?** Should users toggle themselves into `beta` from settings, or is
   membership admin-controlled only?
3. **Percentage rollout** — do we need within-segment % rollout in v1, or is segment on/off enough to
   start? (The schema supports it; we can defer the bucketing code.)
4. **Channel count for desktop** — start with just `stable` + `canary` (employees), or stand up all
   four channels immediately? More channels = more CI build/publish matrix.
5. **Precedence when a user is in multiple segments** — proposal uses highest `rank` wins. Confirm
   that's the desired conflict rule (vs. "most permissive" or "most conservative").
