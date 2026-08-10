# Agent-Created Mission & Objective Indicators (coo:669)

**Status:** proposed — design only, no code changes in this objective
**Contract impact:** version bump required (new DB columns, new DTO fields, new/changed protocol flags)
**Modules touched:** `database`, `core` (mission service + protocol service), `rest`, `webapp`, `mcp`, `connectors` (docs), and the separately shipped mobile client
**Desktop:** no shell work; it renders the webapp

---

## 1. The ask, restated

Agents create missions and objectives themselves. Today nothing on the row says so, so an
agent-authored ask is indistinguishable from one the user typed. Two things are wanted:

1. **A provenance indicator** — subtle but unmistakable at a glance on Mission cards and on
   the objective bubbles in mobile chat.
2. **Assignment on behalf of** — when the agent acts for a known human, the mission should
   land on that human's plate rather than nowhere.

## 2. Recommendation in one paragraph

Record provenance as **three explicit columns on both `missions` and `objectives`**
(`created_by_kind`, `created_by_agent`, `created_by_session_id`), stamped automatically from
a new `ServiceContext.origin` so no creation call site has to remember to pass it. Expose
`createdByKind` / `createdByAgent` / `createdByWorkspaceUserId` on `MissionDto` and
`ObjectiveDto`, and richer `createdFrom` provenance on `MissionDetailDto` only. Render it as
**one generic origin glyph** (a 12px muted `Sparkles`) placed next to the assignee cluster on
every card surface, with the specific agent named in the tooltip and spelled out in full on
the mission detail header. **Do not** put it in `MISSION_STATUS_INDICATORS` and do not give it
a corner dot — corner dots are the codebase's reserved alert channel for seen-tracked,
attention-demanding statuses, and provenance is permanent and non-urgent. For assignment,
implement the already-documented-but-missing `--assigned-to` flag and give agent surfaces a
default assignee chain: explicit flag → parent mission's assignee → the workspace user behind
the authenticating token.

---

## 3. What exists today (verified)

### 3.1 One creation funnel, four sources

Every surface creates missions through
`packages/core/service/missions.ts::createMissionWithObjectives` (`missions.ts:535`), which
inserts the `missions` row and then calls `insertObjective` (`missions.ts:329`) per objective.
`backend/repository.ts::createMissionTx` (`repository.ts:4740`) is the REST wrapper;
`packages/core/service/protocol.ts::protocolCreate` (`protocol.ts:2191`), `protocolPrompt`
(`:2218`) and `recordWork` (`:2265`) are the agent wrappers. This single funnel is why the
whole feature is cheap: two INSERT statements to change, not eight.

### 3.2 The discriminator already exists — it is just not persisted

`ServiceContext.source: 'cli' | 'protocol' | 'webapp' | 'runner'`
(`packages/core/service/context.ts:18`) is set per entry point:

| Entry point                             | `source`     | Meaning                        |
| --------------------------------------- | ------------ | ------------------------------ |
| REST (`backend/db.ts:442`, `:727`)      | `webapp`     | webapp + mobile + desktop      |
| Protocol (`backend/protocol.ts:83,179`) | `protocol`   | CLI-forwarded, agents, MCP     |
| Agent session routes (`:130`)           | `protocol`   | connector harness              |
| Runner                                  | `runner`     | queue-driven launches          |

It is already written to `entity_changes.source` on every insert
(`packages/core/service/change-feed.ts:107`) — so historical provenance is recoverable for
backfill — but nothing lands on the `missions` / `objectives` row itself, which is what a card
read has to see.

### 3.3 The row has a creator, the DTO does not

`missions.created_by_workspace_user_id` and `objectives.created_by_workspace_user_id` exist
(`database/postgres/migrations/002_initial_core.sql:375`, `:443`) and are populated from
`ctx.actorWorkspaceUserId`. For an agent creation that is *already* the human behind the
authenticating token — i.e. the "on behalf of whom" answer is stored today, just never
surfaced. `MissionDto` (`packages/contract/src/index.ts:514`) and `ObjectiveDto` (`:593`)
expose neither the creator nor any provenance.

### 3.4 Agent-created missions land unassigned

`createMissionTx` comments it explicitly (`repository.ts:4788`): *"Unlike the agent surfaces, a
REST-created mission defaults to being owned by whoever created it."* The agent wrappers pass
no `assignedWorkspaceUserId`, so `createMissionWithObjectives` writes `null` (`missions.ts:613`).
Consequence: an agent-created mission never appears on anyone's **My Missions** board.

### 3.5 Documented flags that do not exist

`connectors/core/overlord-mission/SKILL.md:296` documents `--assigned-to <member>` on
`create` / `prompt` / `create-mission` / `record-work`, accepting "a username, an email, a
user-id UUID, or the `orgid:username` member ID". `connectors/.../reference/devices.md:15`
documents `--for-human agent|human`. Neither is read anywhere in `backend/protocol.ts`, and
the only assignee resolver (`repository.ts:5148`) accepts a bare `workspace_users.id` and
nothing else. `create` also ignores `--agent`, and `--session-key` on `create` is used only to
resolve which workspace to write into (`protocol.ts:104`) — the "follow-up draft" linkage the
skill describes is not persisted. **This drift is in scope for this work**: the assignment half
of the objective is largely "make the documented flag real".

### 3.6 The card surfaces

- Board card body: `webapp/web/pages/MissionCardBody.tsx` — bottom-right cluster is
  `MissionDueDateBadge` → objective-count pill → `MissionAssigneeSummary` (`:67-94`).
- List row: `webapp/web/pages/MissionListCard.tsx:108-128` — same cluster, flatter.
- Calendar card: `webapp/web/pages/MissionCalendarCard.tsx` — no assignee cluster today.
- Corner dots: `webapp/web/pages/MissionCardStateOverlay.tsx`, driven by
  `missionCardState.ts::getMissionCardState` and the declarative
  `webapp/web/lib/mission-status-catalog.ts`. That catalog's own doc comment scopes it to
  *"corner indicators / notifiable mission statuses"* that are **seen-tracked** — they show
  until the mission is opened and then clear.
- Objective rows: `webapp/web/components/objectives/ObjectiveCollapsibleItem.tsx:118-134`
  already renders a **brand** agent icon (`AgentIcon` + `getAgentIcon`) meaning *which agent
  will run this objective*.
- Agent brand icons: `webapp/web/lib/helpers/agent-icons.ts` maps catalog keys
  (`claude`, `codex`, `cursor`, `opencode`, `antigravity`, `pi`, `gemini`) to assets.

### 3.7 Mobile chat treats every objective as something the user said

`OverlordMobile/Overlord/Lib/MissionChatFeed.swift` — *"An objective the operator asked for,
read back as a message they sent"*. `MissionChatBubble.swift:10-13` states the design rule
outright: *"Everything in the chat came from the user, so every bubble is trailing and tinted
alike; there is no leading variant yet because agent replies are deliberately out of scope."*
An agent-authored objective rendered there is currently a **factual misattribution**, not just
a missing badge. Mobile mirrors the contract in `OverlordCore/Contract.swift:563`, so new
optional DTO fields are additive and safe.

---

## 4. Provenance model — three facts, not one boolean

A single `isAgentCreated` boolean would immediately be insufficient. Record:

| Fact                                  | Column                              | Why                                                                     |
| ------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| **What kind of actor authored it**    | `created_by_kind`                   | Drives the indicator. Closed vocabulary.                                 |
| **Which agent**                       | `created_by_agent`                  | Tooltip / detail copy ("Created by Claude Code"). Open vocabulary.        |
| **From which agent session**          | `created_by_session_id`             | Yields "created while working on coo:668" for free via the session's mission. |
| **On behalf of which human** (exists) | `created_by_workspace_user_id`      | Already stored; just needs exposing.                                     |

`created_by_kind` vocabulary: **`human` | `agent` | `automation`**.

- `human` — REST/webapp/mobile/desktop, and the default for every pre-existing row.
- `agent` — the protocol surface (CLI-forwarded agent commands, connector harness, MCP).
- `automation` — Overlord itself created the row with no actor in the loop: scheduled-mission
  regeneration (`repository.ts::createScheduledDuplicateIfNeeded`) and any future
  webhook/rule-driven creation.

Include `automation` in the CHECK constraint **now** even though only scheduled duplicates use
it, because `created_by_kind` is a closed vocabulary and adding a value later costs another
contract version bump. It costs one extra token in a CHECK today.

### Why explicit columns rather than the alternatives

- **Derive from `entity_changes`** (source is already recorded there): correct but wrong shape
  — the board query would need a correlated subquery over the change feed per mission, and the
  feed is an append-only realtime log, not a read model.
- **Stuff it in `missions.metadata_json`**: untyped, unqueryable without JSON extraction on two
  dialects, and invisible to the schema contract. Provenance is a first-class permanent
  attribute of the row.
- **Mission-level only, derive objective-level from the first objective**: wrong. A human
  mission gets agent objectives via `add-objectives`, and an agent mission gets human
  objectives typed into the panel. Both levels need their own answer — and mobile chat renders
  *objectives*, so the objective-level column is the one that feature actually needs.

---

## 5. Data model

Paired SQLite + Postgres migrations, e.g. `2026xxxx_creation_provenance.sql`:

```sql
ALTER TABLE missions ADD COLUMN created_by_kind text NOT NULL DEFAULT 'human'
  CHECK (created_by_kind IN ('human', 'agent', 'automation'));
ALTER TABLE missions ADD COLUMN created_by_agent text;
ALTER TABLE missions ADD COLUMN created_by_session_id text;   -- soft ref to agent_sessions.id

ALTER TABLE objectives ADD COLUMN created_by_kind text NOT NULL DEFAULT 'human'
  CHECK (created_by_kind IN ('human', 'agent', 'automation'));
ALTER TABLE objectives ADD COLUMN created_by_agent text;
ALTER TABLE objectives ADD COLUMN created_by_session_id text;
```

`created_by_session_id` is deliberately **not** a hard FK: `agent_sessions` rows are
mission-scoped and `ON DELETE RESTRICT` elsewhere in the schema, and a dangling provenance
pointer must never block a delete. Resolve it with a `LEFT JOIN` and tolerate a miss. (Same
pattern as `missions.schedule_id`, which is FK'd only on the composite Postgres path.)

No new index. Provenance is read as a column on rows already being selected, never filtered on.
If a "show me what agents filed" board filter is ever added, add a partial index
`(project_id, created_by_kind) WHERE created_by_kind <> 'human'` then, not now.

### Backfill

The migration should best-effort backfill from the change feed, which already carries the
answer and (as far as I can find) is never pruned:

```sql
UPDATE missions SET created_by_kind = 'agent'
 WHERE id IN (SELECT entity_id FROM entity_changes
               WHERE entity_type = 'mission' AND operation = 'insert' AND source = 'protocol');
```

…and the same for `objectives`. Rows whose insert event has aged out stay `human`. State that
plainly in the migration comment: historical labelling is best-effort and biased toward
"human", which is the safe direction — a wrongly-unmarked mission looks like today's behavior,
a wrongly-marked one is a visible lie.

---

## 6. Write path

### 6.1 Put origin on the context, not in every signature

Add to `ServiceContext` (`packages/core/service/context.ts`), mirroring how `source` and
`actorTokenId` already ride along:

```ts
export type CreationOrigin = {
  kind: 'human' | 'agent' | 'automation';
  /** Connector/agent identifier as supplied, e.g. `claude-code`, `hosted-mcp`. */
  agent?: string | null;
  /** `agent_sessions.id` when the creating call ran inside a live session. */
  sessionId?: string | null;
};

export type ServiceContext = {
  // …
  /** Who authored rows written through this context. Defaults from `source`. */
  origin?: CreationOrigin;
};
```

with one resolver used by both INSERTs:

```ts
export function resolveOrigin(ctx: ServiceContext): Required<CreationOrigin> {
  if (ctx.origin) return { agent: null, sessionId: null, ...ctx.origin };
  return {
    kind: ctx.source === 'protocol' ? 'agent' : ctx.source === 'runner' ? 'automation' : 'human',
    agent: null,
    sessionId: null
  };
}
```

`createMissionWithObjectives` (`missions.ts:594`) and `insertObjective` (`missions.ts:397`)
each add three bind values. **No call-site signature changes anywhere.** That is the whole
argument for this shape: with ~40 call sites across REST, protocol, MCP, tests and fixtures,
a new required parameter would be a large diff with a high miss rate, and a *missed* call site
silently mislabels a row.

### 6.2 Protocol handlers enrich the origin

In `backend/protocol.ts`, the create-ish commands (`create`, `prompt`, `add-objectives`,
`record-work`) build their context with:

```ts
origin: {
  kind: 'agent',
  agent: strFlag(body, '--agent') ?? null,
  sessionId: await resolveSessionId(body)   // from --session-key, already hashed at :104
}
```

`resolveSessionId` is a two-line reuse of the existing `session_key_hash` lookup. This also
retroactively makes the SKILL's "creates a follow-up draft" claim true in the data.

### 6.3 The `source === 'protocol'` edge case

A human who types `ovld protocol create` by hand is recorded as `agent`, because the published
CLI is a thin client that forwards to `POST /api/protocol/create`. This is acceptable and
should be documented rather than engineered around: the protocol surface *is* the agent
surface, and the overwhelming majority of its traffic is agents. If it ever matters, the escape
hatch is an explicit `--created-by human` flag; do not build it speculatively.

### 6.4 Automation

`createScheduledDuplicateIfNeeded` (`repository.ts:5938`) should pass
`origin: { kind: 'automation' }`. One line, and it stops scheduled regenerations from
masquerading as things the original creator typed again this morning.

---

## 7. Assignment on behalf of the user

### 7.1 Default chain for agent surfaces

`createMissionWithObjectives` gains no new logic; the *agent wrappers* resolve an assignee and
pass it, exactly as `createMissionTx` already does for REST:

1. **Explicit `--assigned-to <member>`** — highest precedence.
2. **Parent mission's assignee** — when the call carries a `--session-key`, inherit
   `missions.assigned_workspace_user_id` of the session's mission. This is the truest reading
   of "on behalf of whom": the agent is working *someone's* mission and filing follow-up work
   for that same someone.
3. **Parent mission's creator** — when the parent is unassigned.
4. **`ctx.actorWorkspaceUserId`** — the human behind the authenticating token. For hosted MCP
   and chat-driven creation this is precisely the user the agent is acting for.
5. `null` only when no workspace user resolves at all (which also implies no project, i.e. the
   inbox-item path).

Steps 2–4 make agent-created missions visible on someone's **My Missions** for the first time.
Call that out at rollout: it is the intended behavior change, and it is the reason this half of
the objective matters more than the badge does.

### 7.2 Make `--assigned-to` real

Add a member resolver in the service layer accepting, in order: `workspace_users.id`, profile
UUID, `orgid:username`, `username`, and email — matching what
`connectors/core/overlord-mission/SKILL.md:296` already promises. Wire it into `create`,
`prompt`, `record-work` in `backend/protocol.ts`, and add `assignedTo` to
`overlord_create_mission` in `mcp/tool-catalog.ts:103` + `mcp/server.ts:127`. Unknown members
should 400 with the same "Assignee is not a member of this workspace" message REST uses, never
silently fall through to unassigned — a silent fallback here is how work goes missing.

`--for-human` (`devices.md:15`) is a *different* axis — who should do the work, not who filed
it — and is also unimplemented. It is **out of scope here**; note it as separate drift so the
two do not get conflated during implementation.

---

## 8. Read path (DTOs)

```ts
// MissionDto and ObjectiveDto (packages/contract/src/index.ts)
/** Actor class that authored this row. Pre-provenance rows report 'human'. */
createdByKind: 'human' | 'agent' | 'automation';
/** Agent identifier that authored it (`claude-code`, `hosted-mcp`), else null. */
createdByAgent: string | null;
/** Workspace member the authoring actor acted as / on behalf of. */
createdByWorkspaceUserId: string | null;
```

```ts
// MissionDetailDto only — one extra LEFT JOIN, paid once per mission page
createdFrom: {
  sessionId: string;
  missionId: string;
  missionDisplayId: string;
  agentIdentifier: string;
} | null;
```

Mapping goes in `backend/repository.ts::toMissionDto` (`:806`) and the objective mapper; the
board/list queries (`:3611`, `:3717`, `:3748`, `:3819`) just select three more columns from a
table they already scan. `MissionDto.createdByKind` must be **non-optional with a `'human'`
fallback in the mapper** so no client has to write a null branch.

Mobile mirrors these in `OverlordCore/Contract.swift` as optionals with a `human` default,
per the existing additive-decode convention there.

---

## 9. Visual design

### 9.1 The governing decision: one generic glyph, not a brand icon

`ObjectiveCollapsibleItem` already uses **brand agent icons to mean "this agent will run this
objective"**. Reusing the same brand mark to also mean "this agent wrote it" would put two
different claims behind one visual, in the same row, sometimes naming two different agents.

So:

- **Brand icon (`AgentIcon`)** = *who runs it*. Unchanged.
- **Origin glyph** = *an agent authored it*. One mark, everywhere: `Sparkles` from lucide,
  12px, `text-muted-foreground`, ~70% opacity. The specific agent is named in the tooltip and
  written out in full only on the mission detail header, where there is room for words.

`Sparkles` over `Bot` because it is the established "machine-authored" idiom and reads as
metadata rather than as a status; `Bot` reads as an actor and competes with the assignee avatar
right beside it.

### 9.2 Why not a corner dot

`webapp/web/lib/mission-status-catalog.ts` is explicitly scoped to seen-tracked, notifiable
statuses — things that demand attention and *clear when you open the mission*. Provenance is
permanent and demands nothing. Putting it in that catalog would (a) require faking
`seenTracked: false` in a structure whose whole purpose is seen-tracking, (b) permanently
occupy a corner slot that stacks against the orange blocking-question dot, and (c) devalue the
alert channel by making a dot mean "look now" in one case and "FYI forever" in another.
**Do not extend `MISSION_STATUS_INDICATORS`.**

### 9.3 Webapp — board card

Add `MissionOriginMark` to `webapp/web/pages/MissionCardPrimitives.tsx` and render it inside the
existing bottom-right cluster, immediately **left of** `MissionAssigneeSummary`
(`MissionCardBody.tsx:93`):

```
[ 15th ]  [ 3 ]   ✦ (Ⓙ)
                  └─ agent authored this, assigned to Jake
```

```tsx
export function MissionOriginMark({
  createdByKind, createdByAgent
}: { createdByKind: MissionDto['createdByKind']; createdByAgent: string | null }) {
  if (createdByKind === 'human') return null;
  const label =
    createdByKind === 'automation'
      ? 'Created automatically by Overlord'
      : `Created by ${agentDisplayName(createdByAgent) ?? 'an agent'}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0" aria-label={label}>
            <Sparkles className="h-3 w-3 text-muted-foreground/70" aria-hidden />
          </span>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
```

Adjacency to the avatar is what makes it read as one sentence — *"a machine made this, for
this person"* — which is exactly the pairing the objective asks for. It costs 12px in a row
that already holds up to three items, and it is invisible on the ~all-human boards that exist
today.

`agentDisplayName` is a small alias map next to `agent-icons.ts` (`claude-code` → `Claude
Code`, `hosted-mcp` → `Overlord MCP`, unknown → the raw identifier). Add it as
`normalizeAgentKey()` + `agentDisplayName()` exported from
`webapp/web/lib/helpers/agent-icons.ts`, since that file already owns the identifier→brand
mapping and today has no answer for `claude-code` (only `claude`).

### 9.4 Webapp — list row, calendar card

`MissionListCard.tsx:127` takes the same `<MissionOriginMark />` immediately before
`MissionAssigneeAvatar`. The calendar card is dense enough that the mark should be the only
provenance affordance and can be omitted in the smallest cell size; do not add a tooltip there.

Keeping one shared component across all three surfaces is the same discipline
`MissionCardStateOverlay` already enforces for card state — it is why board, list, and drag
overlay never drift.

### 9.5 Webapp — mission detail (the "clear" half)

`MissionPanelHeader.tsx` gets a single muted metadata line under the title:

> ✦ Created by **Claude Code** · while working on [coo:668] · for **Jake**

with `coo:668` linking to the originating mission (from `MissionDetailDto.createdFrom`) and the
"for" clause showing `createdByWorkspaceUserId`'s member name. The card is glanceable; the
detail page is where the full provenance sentence belongs.

### 9.6 Webapp — objective rows

`ObjectiveCollapsibleItem.tsx` gets the same `✦` immediately **after** the objective title
(never in the leading icon slot, which belongs to the run agent), tooltip *"Added by Claude
Code"*. This is what distinguishes "I queued these three steps" from "the agent decomposed my
mission into three steps" inside one mission panel.

### 9.7 Mobile chat — the important one

The bubble currently asserts the operator said this. Recommendation:

1. **Keep the bubble trailing.** Do not flip agent-authored objectives to a leading bubble.
   Leading alignment is the strongest signal the transcript has and it should be reserved for
   genuinely *inbound* traffic (deliveries, questions, agent replies) when that lands — which
   `MissionChatBubble.swift:10-13` already anticipates. An agent-filed objective is still work
   in the operator's own queue, still tappable to the same mission, and still ordered as one of
   their asks; flipping it would imply a two-party conversation the feed does not yet model.
2. **Change the fill.** Agent-authored bubbles render with the outlined/untinted variant
   (border only, `colors.border`, transparent fill) instead of the tinted user fill. This is
   the class distinction, readable at scroll speed without reading a word.
3. **Add an attribution line inside the bubble**, above the objective text: SF Symbol
   `sparkles` at 11pt + the agent's display name in `mutedForeground` 11pt. One line, only on
   agent-authored bubbles.
4. **Extend the accessibility label.** `bubbleAccessibilityLabel` (`:161`) must lead with
   *"Created by Claude Code."* — a VoiceOver user gets no fill or glyph, and misattribution is
   worse for them, not better.

Data comes from the new `ObjectiveDto.createdByKind` / `createdByAgent`, carried into
`MissionChatMessage` as `createdByAgent: String?` in `MissionChatFeed.swift`, set in
`messages(mission:...)` (`:145`). Inbox captures and optimistic pending rows are always
operator-authored, so they pass `nil` unchanged.

### 9.8 What NOT to build

- No new notification type. Nobody needs a push saying an agent filed a draft; the mission is
  already going to notify on its real events.
- No board filter / saved view for agent-created work. Add it if someone asks, with the partial
  index from §5.
- No per-agent brand icon on cards (§9.1).
- No `agent_created` entry in the mission status catalog (§9.2).
- No settings toggle to hide the mark. It is 12px of muted glyph; a preference costs more than
  the pixels.

---

## 10. Contract impact

Per `CONTRACT.md` §"Contract Maintenance Rules", this requires a **version bump** (currently
`66`) and must land *before* the implementation:

| Change                                                       | Contract action                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 6 new columns on `missions` / `objectives`                    | `database/docs/09-database-schema-contract.md` — table field tables at `:822` and the objectives section |
| `created_by_kind` closed vocabulary                           | `CONTRACT.md` §Controlled Vocabularies → **Closed**; version bump             |
| `created_by_agent` values                                     | Covered by the existing open "Connector/agent identifiers" entry — no change  |
| `--agent`, `--assigned-to` read by `create`/`prompt`/`record-work` | `contract/protocol-commands.yaml` (`create:` at `:229`, `prompt:` at `:237`) — add to `optionalFlags` |
| New `MissionDto` / `ObjectiveDto` / `MissionDetailDto` fields | REST API Layer section; mobile REST consumer section (`CONTRACT.md` §11)      |
| `assignedTo` on `overlord_create_mission`                     | MCP Server section (`CONTRACT.md` §12) + `mcp/conformance-manifest.yaml`      |
| Changelog                                                     | `CONTRACT.md` changelog entry                                                 |

Then run `ovld contract check` for `rest`, `mcp`, and the mobile `rest-consumer` manifest.

---

## 11. Phasing

**Phase 1 — record it (backend only, invisible).** Migrations + backfill, `ServiceContext.origin`
+ `resolveOrigin`, stamping in `createMissionWithObjectives` / `insertObjective`, protocol
handlers passing `--agent` and the resolved session id, `createScheduledDuplicateIfNeeded`
passing `automation`. Ships dark; nothing renders. *~½ day.*

**Phase 2 — assign it (behavior change).** `--assigned-to` resolver + wiring across
`create`/`prompt`/`record-work`/MCP, and the default assignee chain from §7.1. Highest user
value of the three phases and independently shippable. *~½ day.*

**Phase 3 — show it.** DTO fields + `toMissionDto` mapping, `MissionOriginMark`, the three card
surfaces, the detail header line, the objective row mark, then mobile (`Contract.swift`,
`MissionChatFeed`, `MissionChatBubble`). *~1 day, mobile is roughly half of it.*

Phases 2 and 3 are independent given Phase 1 and can be parallelized across two agents.

---

## 12. Test plan

- **Service:** `packages/core/service/missions.create.test.ts` — a `protocol`-source context
  stamps `agent`; `webapp` stamps `human`; explicit `ctx.origin` wins over the `source` default;
  objectives inherit the creating context's kind independently of their mission's.
- **Protocol:** `backend/mission-creation.test.ts` — `create --agent claude-code --session-key …`
  stamps agent + session id and inherits the parent mission's assignee; `--assigned-to` by
  username/email/id resolves; an unknown member 400s rather than silently unassigning.
- **Migration:** `backend/postgres` conformance — backfill marks a mission whose insert row in
  `entity_changes` has `source = 'protocol'`, leaves others `human`, and the CHECK rejects a
  fourth kind.
- **Webapp:** `missionCardState.test.ts` stays untouched (deliberately — provenance is not card
  *state*); a new render test asserts the mark is absent for `human` and labelled for `agent`.
- **Mobile:** `OverlordTests/MissionChatFeedTests.swift` — `createdByAgent` propagates from
  `ObjectiveDto` into `MissionChatMessage`, is `nil` for inbox and pending rows, and the
  accessibility label leads with the attribution.

---

## 13. Open questions for the PM

1. **Assignee default (§7.1)** — inheriting the parent mission's assignee will start putting
   agent-filed follow-ups on people's My Missions boards. Intended, or should agent-created
   missions stay unassigned until triaged, with the mark alone as the signal?
2. **Mobile alignment (§9.7)** — I recommend keeping agent bubbles trailing and reserving
   leading alignment for genuinely inbound agent messages. If inbound agent traffic is not on
   the roadmap, flipping agent-authored objectives to leading is the single clearest signal
   available and is worth reconsidering.
3. **`--for-human` (§7.2)** — separate documented-but-unimplemented flag. Fold into this work,
   or track separately?
