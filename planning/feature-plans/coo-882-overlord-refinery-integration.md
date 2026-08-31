# Overlord ⇄ Refinery integration (Overlord-side work)

**Status:** proposed — companion to the standalone product plan, which now
lives in the Refinery repo
(`~/Development/Cooperativ/Refinery/planning/coo-882-refinery-standalone-product.md`);
this document stays in the Overlord repo and defines everything Overlord
itself must build.
**Principle:** Overlord is a *thin client* of Refinery. No refinement tables,
no runner changes, no new protocol verbs. Refinery creates objectives through
the user's own `ovld` CLI / MCP credentials like any other agent caller.

## 1. What Overlord builds

### 1.1 Service connection settings (Local edition, v1)

- A Settings entry for the local Refinery endpoint: base URL (default
  `http://127.0.0.1:<port>`) and the bearer token (pasted, or read from
  `~/.refinery/serve.token` by the desktop shell).
- A health indicator driven by Refinery's `GET /v1/health` (reachable /
  drivers available), used to enable or grey out the Refine actions.
- Loopback calls originate from the desktop shell / local backend — never
  from the browser page directly (the SPA must not hold the Refinery token).

### 1.2 Sending: the "Refine" action

Available on draft/future objectives (mission panel) and on inbox captures:

- Composes a Refinery transcript from: the objective/inbox text, mission
  title, intake provenance when present (e.g. coo:880 Slack thread snapshot,
  message-per-author in order), and relevant attachments as media parts.
- Passes repo hints: the project's resource keys/paths (registered in
  Refinery's repo registry; first-run flow prompts the user to register
  them).
- Passes options: the pre-configured destination profile for this project
  (profile's `projectId` = this project), `requireConfirmation` defaulting to
  true, and a callback so questions push into Overlord rather than polling.
- Records the returned `caseId` on the source entity's metadata
  (namespaced key, no schema change) so the UI can show case status and
  deep-link.

### 1.3 Rendering questions and answers

- Overlord renders Refinery's versioned question schema (free_text,
  single_choice, multi_choice, confirmation — with optional file/UI-element
  subject anchors) in the mission panel and inbox detail.
- Answers submit back via `POST /v1/cases/:id/answers`; the confirmation
  question renders the pending result as a current-vs-proposed diff with
  edit-before-approve (mirrors the edit-then-accept UX from the superseded
  in-Overlord plan).
- Unknown `schemaVersion` → render a "open in Refinery / answer via CLI"
  fallback rather than guessing.

### 1.4 Receiving results

- Nothing to build on the write path: results arrive through the existing
  create surfaces (`ovld protocol create` / `add-objectives` / MCP) as agent
  identifier `refinery`, in **draft** state, in the profile's project.
- Presentation: existing `createdByAgent` provenance marks the objective.
  Optional (needs contract bump): a `submissionSource`-style value
  (`refinery`) aligned with coo:880's provenance/search model, if filtering
  refined work becomes wanted.
- When the source entity carries a `caseId`, the UI links the created
  objective back to the case and marks the source (e.g. inbox capture)
  resolved.

## 2. Cloud edition (phase 2 — separate mission)

A cloud backend cannot reach a laptop service, so intake inverts to the
runner pattern:

- Overlord backend hosts a small **refinement intake queue**: enqueued
  transcript envelopes + question/answer relay rows, claimed by the user's
  local Refinery via outbound long-poll with the user's credentials.
- This is the only part of the integration with real contract impact (new
  queue surface + tables) and must go through the normal contract-first
  objective when scheduled.
- The Slack-direct flow ("refine before any objective exists, Q&A in the
  Slack thread") composes coo:880's intake with this queue and belongs to
  that phase.

## 3. Explicitly out of scope for Overlord

- Running or supervising the Refinery process (user installs/starts it;
  desktop-shell supervision is a possible later convenience, not v1).
- Storing Refinery API keys, driver config, or repo registry — all Refinery-
  owned.
- Any second write path for objectives: Refinery uses the same authenticated
  create surfaces as every agent.

## 4. Contract impact summary (Overlord)

| Item | Impact |
| --- | --- |
| v1 Refine action, question UI, settings entry | Webapp/desktop only; namespaced metadata key for `caseId`; **no contract bump expected** |
| `refinery` agent identifier | Open vocabulary (connector/agent identifiers) — no bump |
| Optional `submissionSource: refinery` | Closed-vocabulary addition → contract bump; decide with coo:880 |
| Cloud intake queue (phase 2) | New tables + REST surface → contract bump, contract-first objective |

## 5. Suggested Overlord-side objectives (when Refinery MVP exists)

1. Settings + health + "Refine" send path for objectives and inbox captures
   (Local edition, polling or callback).
2. Question rendering + answers + confirmation diff UI.
3. Case linking/provenance polish (`caseId` metadata, resolved inbox states).
4. (Phase 2) Cloud intake queue + Slack-thread Q&A relay — contract-first.
