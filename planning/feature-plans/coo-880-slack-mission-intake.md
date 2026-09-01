# coo:880 — Slack mission intake

**Status:** proposed — discovery and product definition only; no Slack app or integration is being implemented yet.

> **Slack AI-agent surface evaluated and deferred.** See
> [coo-880-slack-agent-surface-evaluation.md](./coo-880-slack-agent-surface-evaluation.md).
> Slack's Agents & AI Apps container is DM-scoped and depends on the chat-capable
> MCP surface coo:781/coo:784 are still building, so it does not replace this plan.
> It becomes phase 2 on the same Slack app.

## 1. Product decision

Slack is an **intake surface** for Overlord work. It is not a notification channel.

The integration lets a person turn Slack conversation into Overlord work in two ways:

1. Turn a Slack message (optionally with its thread) into a new mission or an unallocated Inbox capture.
2. Turn a Slack message (optionally with its thread) into a new objective on an existing Overlord mission.

It also provides concise text entry points:

```text
/mission <text>
/obj <mission-id> <text>
```

The app responds only to the invoking user, with an ephemeral confirmation and a link into Overlord. It must never post delivery, status, or other Overlord notifications into a channel as part of this feature.

## 2. Goals and non-goals

### Goals

- Make it fast to capture work discussed in Slack without copying text into another tool.
- Route work to the right project automatically when the Slack context is mapped.
- Keep capture useful even when no project mapping exists by creating a private, unallocated Inbox item.
- Preserve enough source provenance to get back to the originating Slack conversation.
- Make Slack-submitted missions and objectives unmistakable everywhere Overlord presents their creation provenance.
- Let users filter search results to work submitted through Slack.
- Require an authorized Overlord identity for every write.
- Keep all Overlord mission and objective lifecycle behavior authoritative in Overlord.

### Non-goals for the first release

These are scoped to release 1. The notification non-goal in particular is
expected to be re-opened deliberately at phase 2, when coo:637 wants Slack as a
notification transport.

- Slack notifications, subscriptions, reminders, or activity feeds.
- Changing mission status, assigning agents, launching work, or approving requests from Slack.
- Bidirectional synchronization between Slack and Overlord.
- A general-purpose Slack search/indexing bot.
- A native arbitrary multi-message selector. Slack message actions operate on one message; thread capture is the useful supported “series of messages” primitive. A later global shortcut may accept several pasted Slack permalinks if that proves necessary.
- A Slack workspace connected to more than one Overlord workspace.
- A conversational agent surface (Slack's Agents & AI Apps container). Deferred
  to phase 2 on the same app; see the evaluation linked above. The app identity
  chosen at install must be able to carry both features later, so it must not be
  named for intake alone.

## 3. Concepts and data ownership

| Concept | Meaning | Owner |
| --- | --- | --- |
| Slack connection | An installed Slack workspace associated with one Overlord workspace and its installation credentials. | Slack integration |
| Workspace default project | Optional project used for captures in that Slack workspace when its channel has no mapping. | Slack integration configuration |
| Channel project mapping | Optional project for one channel in an installed Slack workspace. | Slack integration configuration |
| Slack user link | A verified association between the Slack user invoking an action and an Overlord profile. | Identity bridge |
| Slack intake source | Bounded source metadata and snapshot identifying the captured message/thread. | Slack integration |
| Submission source | The durable entry surface for a mission or objective: `overlord` or `slack`. It is distinct from who authored the row. | Core provenance projection |
| Inbox capture | An account-owned `inbox_item`, not a project mission, awaiting promotion to a project. | Existing Inbox service |
| Mission/objective | The actual planning and execution records. | Existing mission/objective services |

Overlord is the system of record for missions and objectives. Slack records neither a shadow mission nor a lifecycle state.

## 3.1 Slack visual provenance and search

Every mission and objective submitted through Slack carries a durable
`submissionSource = 'slack'` attribute. It is **not** represented by setting
`createdByKind` to `agent` or by introducing Slack as an agent identifier:
the initiating person is still a human author, while Slack is the intake
surface. Keeping those facts separate prevents a Slack-created item from being
misattributed as AI-authored and lets Overlord render both kinds of provenance
correctly if future flows require it.

The existing `createdByKind` / `createdByAgent` presentation establishes the
model to reuse: a compact, consistent origin mark rendered on the entity, with
an accessible textual label. Slack adds a parallel **Slack icon** mark, using
the existing Slack SVG asset, with these exact labels:

- Mission: **“Created from Slack”**
- Objective: **“Added from Slack”**

The icon is mandatory, not opt-in, whenever `submissionSource` is `slack`.
It appears wherever the matching agent-origin mark can appear today: mission
board, list, calendar, Inbox/search rows, mission-panel header, activity-feed
cards, and objective rows or objective result chips. It must be conveyed in
the accessible name/tooltip, not through color or a glyph alone. If an entity
ever has both Slack submission provenance and an independent agent-origin
mark, render both rather than allowing one to suppress the other.

Search gains a **Source** filter with at least **All** and **Slack** values.
The API filter is named `submissionSources` and initially accepts `overlord`
and `slack`; the response’s applied-filters projection echoes the values. In
the grouped v3 search surface, the filter applies to the searched entity type:

- With `mission` entities enabled, a mission matches only when the mission
  itself has the requested source.
- With `objective` entities enabled, a mission group is returned when one of
  its matched objectives has the requested source; that objective remains in
  `matches[]` and displays its Slack icon.
- With the default entity set, results are the union of those two rules.

This means a user can find both a mission created from Slack and a conventional
mission that later received a Slack-submitted objective, without pretending the
latter mission itself was created from Slack.

## 4. Workspace, project, and authorization mapping

### 4.1 Slack workspace to Overlord workspace

An installed Slack workspace maps to exactly one Overlord workspace:

```text
Slack workspace (team_id) ──1:1──> Overlord workspace
```

`team_id` is unique among active Slack connections. The feature does **not** support choosing an Overlord workspace per command or associating one Slack workspace with several Overlord workspaces. An Overlord workspace may support more than one connected Slack workspace later; this proposal does not require reverse uniqueness.

The installer must be authorized to administer the target Overlord workspace. Reinstalling a Slack workspace may refresh credentials for the same association; moving it to another Overlord workspace is an explicit disconnect/reconnect operation with a visible warning.

### 4.2 Optional project mappings

Each Slack connection can configure either, both, or neither of the following:

1. **Workspace default project** — one optional default project for all captures from this Slack workspace.
2. **Channel project mappings** — zero or more mappings from a Slack channel to a project in the connected Overlord workspace.

Channel mappings are intentionally narrow. A channel may map to at most one active project within its Slack connection. A project may be targeted by many channels and may also be the workspace default.

Only a user with integration-configuration authority in the Overlord workspace may create, change, or remove these mappings. The target project must be active and in that Overlord workspace.

### 4.3 Project-resolution algorithm

Mission creation and message-based capture resolve a destination in this exact order:

```text
1. Is the Slack channel mapped to an active, authorized project?
   Yes → create the mission in that project.

2. Otherwise, does the installed Slack workspace have an active default project?
   Yes → create the mission in that project.

3. Otherwise → create a private, account-owned Inbox capture.
```

The channel mapping always wins over the Slack-workspace default. A deleted, archived, inaccessible, or cross-workspace project mapping is invalid and must not be silently used; it is treated as absent and surfaced to administrators for repair.

The third result is deliberately an existing **Inbox capture** (`inbox_item`), not a mission in an invented or unassigned project. The user can later promote it into any project they are allowed to use. In Slack copy, this should read “Saved to your Overlord Inbox,” not imply that a project mission already exists.

An Inbox capture created by Slack also records `submissionSource = 'slack'`.
When it is promoted, the resulting mission and its initial objective inherit
that source so both receive the Slack icon and remain discoverable through the
Source filter.

### 4.4 Per-user authorization

A Slack workspace installation grants the integration access to its Slack workspace; it does not grant every Slack member authority to write to Overlord.

Before a write, the Slack user must be linked to an Overlord profile that is an active member of the connected Overlord workspace. First use should open an OAuth/login handoff in a Slack modal or browser and return to Slack on success. The integration must then evaluate the linked profile’s live Overlord permissions:

- Project mission creation requires permission to create a mission in the resolved project.
- Appending an objective requires permission to modify the addressed mission/objectives.
- Inbox fallback writes only to the linked profile’s own Inbox.

No user identity is inferred from display names, email-address similarity, a shared Slack workspace, or the identity of the original message author.

## 5. User experience

### 5.1 Message shortcuts

Install two message shortcuts in Slack’s **More actions** menu:

- **Create Overlord mission**
- **Add as Overlord objective**

Slack message shortcuts are invoked for one non-ephemeral message and include its channel/message context. The app must acknowledge the interaction promptly, then open an Overlord modal.

#### Create Overlord mission modal

The modal shows:

- Source channel and permalink.
- A choice between **This message** and **Include this thread**. For a threaded message, the latter captures the root plus replies in chronological order. For an unthreaded message, the choice is disabled.
- Editable title, initially derived from the message’s first meaningful line and bounded to Overlord’s title limit.
- Editable objective/instruction text, initially containing the captured content.
- A non-editable destination summary: `Project: Design` or `Destination: Your Overlord Inbox`.
- A Submit action, disabled until the user has an authenticated Overlord profile and valid text.

The project is not selectable in this first release. This preserves the promised automatic routing and makes missing mappings safely fall back to Inbox. Project selection can be added later only with an explicit authorization and UX design.

On success, send an ephemeral confirmation such as:

> Created mission `coo:880` in Design — Open in Overlord

or:

> Saved to your Overlord Inbox — Open Inbox

#### Add as Overlord objective modal

The modal reuses the source and thread controls, then offers:

- A required mission search/select constrained to missions the linked profile may modify in the connected Overlord workspace.
- A visible selected mission display ID and title.
- Editable objective text populated from the captured Slack content.
- An optional objective title, derived from the content.

On submit it appends exactly one objective to the selected mission and returns an ephemeral confirmation with the objective and mission links. It never creates an objective when the mission is absent, belongs to another workspace, is unauthorized, or has been deleted.

### 5.2 Thread and multi-message behavior

The initial “series” implementation is an entire thread, not arbitrary selection of several unrelated messages. This is both coherent for work intake and matches Slack’s message-action context model.

Thread capture should format the material as a bounded, chronological source block:

```markdown
Source: Slack thread in #product
<permalink>

Alice — 2026-08-31 10:02
We should add …

Ben — 2026-08-31 10:06
The important constraint is …
```

The modal must show a count and warn when a thread exceeds the supported capture limits. It may let the user continue with a bounded excerpt, but it must never silently discard messages. A future global shortcut can support pasting multiple Slack permalinks, resolving each only after user confirmation.

### 5.3 Slash commands

#### `/mission <text>`

Creates a new project mission using the same resolution algorithm in §4.3. If no mapping exists, it saves an Inbox capture. It accepts free text only; titles may be generated deterministically from the text and should remain editable in Overlord.

Examples:

```text
/mission Add an export button to the review screen
/mission Investigate why staging deploys are slow
```

#### `/obj <mission-id> <text>`

Appends one objective to an existing mission. The mission ID comes first so routing is never guessed:

```text
/obj coo:880 Define the data-retention policy for captured Slack threads
```

Rules:

- Require exactly a valid Overlord mission display ID followed by non-empty objective text.
- Resolve the mission in the connected Overlord workspace and verify the invoking profile can edit it.
- The command does not use channel/default-project mapping: the addressed mission supplies the project.
- Return usage, not-found, authorization, and validation failures ephemerally.
- Return only an ephemeral success confirmation. Do not write a reply into the channel.

Slack slash commands do not run in message threads, so thread context belongs to message shortcuts rather than slash commands.

## 6. Source provenance and privacy

### 6.1 What is retained

For every successful Slack intake, retain bounded source provenance associated with the created Inbox capture, mission, or objective:

- Slack workspace ID and channel ID (opaque external identifiers)
- Message timestamp and thread/root timestamp where relevant
- Source permalink
- Original message author’s Slack user ID and display label at capture time
- Capture mode: `message`, `thread`, or future `permalinks`
- Capture time and receiving integration connection ID
- The bounded source snapshot used to create the instruction

The actual work instruction remains on the Overlord mission/objective or Inbox item. Provenance supplies traceability; it is not a separate transcript mirror.

### 6.2 What is not retained or exposed

- Slack signing secrets, bot tokens, refresh tokens, OAuth authorization codes, or raw request bodies in mission content, activity, logs, or client DTOs.
- Content outside the user-selected message/thread.
- Live Slack message history merely because the app is installed.
- Channel content in any response to an Overlord user who does not have an authorized source record.
- Any automatic Slack replies beyond the requested ephemeral confirmation.

The integration retrieves message/thread content only in direct response to a user action and only from the context Slack supplies or the exact thread it references. It stores enough snapshot text for an Overlord instruction to remain intelligible if the Slack message is later edited or deleted.

### 6.3 Limits and resilience

Define explicit limits for message size, thread reply count, total capture characters, title length, search result count, and Slack API retry windows. Inputs beyond a limit must receive a clear modal error or an explicit truncate-and-confirm choice. Never retry a successful Overlord write merely because Slack’s acknowledgement or confirmation delivery was uncertain.

Every interaction carries a Slack event/interaction identifier that becomes an integration-scoped idempotency key. Retrying the same Slack interaction returns the originally created record rather than creating duplicate missions or objectives.

## 7. Technical architecture

### 7.1 Integration boundary

The Slack adapter verifies Slack requests and turns them into an authenticated, normalized intake request. It must not write mission/objective tables directly.

```text
Slack interaction / slash command
  → Slack request verifier + adapter
  → linked Overlord profile + mapping resolver
  → existing Inbox / mission / objective service
  → persisted source provenance
  → ephemeral Slack confirmation with Overlord link
```

The existing service layer remains the only place that creates missions, appends objectives, performs RBAC, applies title rules, writes entity changes, and publishes realtime invalidation. No Slack-specific lifecycle path is allowed.

### 7.2 Proposed persistence

Exact names and constraints must be finalized in the contract-first implementation objective. The expected minimum model is:

| Record | Essential fields and constraints |
| --- | --- |
| `slack_workspace_connections` | ID; `slack_team_id` unique; `overlord_workspace_id`; encrypted credential reference; installation metadata; active/revision/deletion fields. |
| `slack_workspace_project_defaults` | Connection ID unique; `project_id`; audit fields. Absence means no default project. |
| `slack_channel_project_mappings` | Connection ID; `slack_channel_id`; `project_id`; unique `(connection_id, slack_channel_id)`. |
| `slack_user_links` | Connection ID; `slack_user_id`; `profile_id`; verified/last-used fields; unique source identity; no email-based matching. |
| `slack_intake_sources` | Parent record (`inbox_item`, mission, or objective); source IDs, permalink, mode, bounded snapshot, idempotency key, audit fields. |

`missions` and `objectives` also need a non-null `submission_source` column,
initially `overlord | slack` and defaulting to `overlord` for every existing
row. DTOs expose this as non-optional `submissionSource`; older clients decode
a missing field as `overlord` under the existing additive-read convention.
`inbox_items` stores equivalent Slack-origin data until promotion.

Credential material must use the existing secret-storage pattern or a secret reference; it must not be stored as plaintext in ordinary JSON columns. Integration-owned tables belong under the finalized component/extension ownership model and must follow the contract’s table-prefix and migration rules.

### 7.3 API and interaction surfaces

Likely surfaces, subject to contract review:

- Slack OAuth/install start and callback.
- Slack interactive request endpoint for message shortcuts, modal submissions, and link-account completion.
- Slack slash-command endpoint.
- Authorized Overlord settings APIs for viewing and changing the connection, default project, channel mappings, and linked identities.
- Read-only source provenance on a mission/objective/Inbox capture where disclosure is authorized.
- Search v2/v3 and their UI controls accept `submissionSources` and project the
  matching mission/objective source so a Slack filter never needs client-side
  inference from text or permalinks.

All Slack ingress endpoints verify Slack’s signature and timestamp before parsing payloads. They acknowledge within Slack’s required interaction window and complete slower operations through an idempotent continuation when necessary.

### 7.4 UI surfaces

Overlord Settings gains a Slack integration page with:

- Connect/disconnect status and associated Slack workspace.
- The associated Overlord workspace (read-only once connected).
- Optional workspace default-project selector.
- Channel-to-project mapping list with add, change, and remove controls.
- User-link status and a way to revoke/relink the current profile.
- Privacy/scopes summary and installation instructions.

Mission, objective, and Inbox detail views should display a compact Slack-source affordance with the permalink only when the viewing user is authorized to see it. Do not render arbitrary Slack text in board cards.

## 8. Security and authorization requirements

- Verify Slack request signatures, request timestamps, and installation state before any processing.
- Use OAuth state/PKCE and encrypted credential storage appropriate to the deployment edition.
- Do not trust Slack-provided user, channel, team, text, or trigger fields as Overlord authorization claims.
- Resolve current Overlord membership and permissions for every mutation; do not cache authorization longer than the request.
- Bind an interaction to its Slack workspace connection before looking up mappings or profiles.
- Validate that a mapped project belongs to the connection’s Overlord workspace.
- Store idempotency records before side effects or in the same transaction as the created Overlord entity.
- Redact secrets and Slack payloads from logs, errors, analytics, artifacts, and delivery reports.
- Rate-limit public Slack ingress and make all error messages safe to display ephemerally.
- Treat deleted/revoked Slack connections and user links as immediately non-authoritative.

## 9. Contract impact and implementation order

This is a cross-module feature spanning database, authentication, REST ingress, integration settings, web UI, and existing mission/objective services. Before implementation, the first build objective must update `CONTRACT.md` and relevant `contract/*.yaml` files to define the ownership and stable surfaces.

`submissionSource` and `submissionSources` are stable contract additions. The
initial closed source vocabulary (`overlord | slack`), persisted database
column, DTO projection, and search-filter signature require the contract update
and version bump before implementation. `createdByKind` remains the existing
closed actor-class vocabulary (`human | agent | automation`) and must not be
repurposed for Slack.

The implementation must decide explicitly whether Slack is a first-party extension or a new core integration component. The recommended direction is a first-party integration module that uses existing core mission/objective/Inbox services; it must not establish a second mission-writing path. If it is shipped as an extension, its tables, capabilities, and conformance manifest must follow the extension contract.

Suggested delivery sequence:

1. **Contract and data design** — finalize ownership, persistence, schemas, service interfaces, RBAC, retention, source projection, and migration strategy.
2. **Connection and configuration** — OAuth/install flow, credential storage, user links, and Settings mapping UI/API.
3. **Message actions** — message and thread capture, editable modals, mapping resolution, Inbox fallback, source records, and ephemeral confirmations.
4. **Slash commands** — `/mission` and `/obj`, with shared parsing/authorization/idempotency paths.
5. **Verification and documentation** — security, migration, unit/integration/E2E tests, scope documentation, and operational runbook.
6. **Phase 2 (not release 1)** — the Slack agent container on the same app, gated
   on coo:781/coo:784 delivering the mission-management verbs and search quality.
   See [coo-880-slack-agent-surface-evaluation.md](./coo-880-slack-agent-surface-evaluation.md).

## 10. Acceptance criteria

### Workspace and mapping

- A Slack workspace can be connected to one Overlord workspace and cannot be linked to a second one without explicit disconnect/reconnect.
- An administrator can configure no default project, one default project, and any number of channel mappings.
- Channel mappings override the workspace default project.
- With neither mapping, mission-style Slack capture creates only the invoking user’s Inbox item.
- Stale or inaccessible mappings never create work in the wrong project.

### Message and thread capture

- A user can invoke **Create Overlord mission** from a Slack message and edit the generated content before submitting.
- A user can choose this message or its bounded thread context.
- A user can invoke **Add as Overlord objective**, choose an authorized existing mission, and append exactly one objective.
- Created work exposes bounded, authorized source provenance and an Overlord deep link.
- Replayed Slack interactions do not duplicate Overlord work.

### Commands

- `/mission <text>` follows the mapping hierarchy and returns an ephemeral confirmation.
- `/obj coo:880 <text>` appends to that authorized mission and returns an ephemeral confirmation.
- Invalid command syntax, missing IDs, unknown missions, unauthorized users, and unavailable connections produce actionable ephemeral errors.
- Neither command posts a public channel message or subscribes the user to notifications.

### Security and quality

- All Slack ingress verifies signatures and rejects stale/replayed requests safely.
- Slack credential material never reaches mission text, logs, API DTOs, or source snapshots.
- Every Slack-submitted mission and objective displays the Slack icon with the
  correct accessible label across all existing provenance surfaces.
- Search can filter to Slack-origin missions and Slack-origin objectives, and
  distinguishes a Slack-origin objective from the source of its parent mission.
- Tests cover authentication, workspace isolation, mapping precedence, Inbox fallback, thread bounds, idempotency, permission failures, and quiet-response behavior.

## 11. Deferred decisions

- Should a workspace default project be selectable by any integration admin, or restricted to projects they personally administer?
- Should a later global shortcut accept many pasted Slack permalinks, and what maximum is useful?
- Should source snapshots be immutable after capture, or should a user be able to redact their own captured Slack text while retaining the permalink?
- Should `/mission` eventually accept flags such as a due date or priority, or remain text-only to protect its speed and reliability?
- Does the first release need a dedicated Slack identity-link Settings page, or is an on-demand account-link flow sufficient?

## 12. External references

- [Slack message and global shortcuts](https://docs.slack.dev/interactivity/implementing-shortcuts/) — message-context actions, modal handoff, and interaction acknowledgement.
- [Slack slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/) — command payloads and the limitation that developer-created commands are not invoked inside message threads.
