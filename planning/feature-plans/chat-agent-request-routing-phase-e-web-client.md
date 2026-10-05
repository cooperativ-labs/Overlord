# coo:1108.r2b0 — Web and desktop chat client (Phase E)

Minimal functional Chat in the shared SPA (browser and remote desktop). It consumes
only the v152 REST/SSE routes. Plan: `chat-agent-request-routing.md`; contract:
`CONTRACT.md` → Version 152.

## What was built

| Area | Files |
| --- | --- |
| Navigation | `webapp/web/components/app-sidebar.tsx` (Chat above Inbox), `webapp/web/router.tsx` (`/chat`, `/chat/$threadId`, `/settings/connections` callback → `/chat?connection=<status>`) |
| REST client | `webapp/web/lib/api/chat.ts` |
| Event reducer | `webapp/web/lib/chat/thread-state.ts` — snapshot → state, ordered events, duplicate drop, gap detection, revision guards, `content.invalidated` withholds blocks at once and requests a snapshot, unknown kinds tolerated |
| Transport | `webapp/web/lib/chat/thread-stream.ts` — authorized snapshot then `events?after=eventCursor`; incremental SSE parser; reload on gap, `snapshot_required` frame or 409, or invalidation; jittered exponential backoff; polling fallback (`?poll=1`) after three failures with periodic stream retry; 45 s idle watchdog; reconnect on `online`/visible; terminal states for 401/403, `chat_unavailable`, not found; the reader is cancelled on every abort |
| Presence and acks | `webapp/web/lib/chat/presence.ts`, `use-chat.ts` — presence only while the tab is visible and focused (`web`/`desktop`, one client id per page load), released on blur/hide/pagehide/unmount; acks sent from a post-commit effect, only while foreground, after the presence renewal, monotonic and coalesced, retried |
| Request ids | `webapp/web/lib/chat/request-ids.ts` — one id per action reused across retries; Create/answer/cancel/Continue ids persist in `localStorage` per backend/profile/organization and are pruned on scope change. A new thread is created empty, then the first message is submitted idempotently (a retry reuses the created thread and id) |
| Scope | `useChatAvailability` — scope = backend origin + profile + organization; it keys every query, stream and stored id; a scope change returns to `/chat`. Local backend (`meta.backendMode === 'local'`) shows "Chat is unavailable"; a 404 `chat_unavailable` also stops the stream |
| UI | `webapp/web/pages/ChatPage.tsx`, `webapp/web/components/chat/*` — thread list (activity badges, archived view), transcript (Markdown text, collapsible sources with stale flag, `unavailable` blocks, mission links, fallback text for unknown blocks), streaming caret, tool activity, Stop, failure text, Continue, open question card (options and free text; rendered even when no block references it), proposal card (frozen agent/model/reasoning with source, resource, criteria, dependencies, audience warning; superseded/invalidated/cancelled states; Create; receipt with live mission title/status through the existing `useMission` query), rename/archive, provider readiness, Knowledgebase connect/reauthorize/disconnect (desktop opens the system browser) |

## Contract change (additive, v152)

`ChatThreadSnapshotDto.referencedProposals`: created or cancelled proposals named by a
proposal block in the returned page. Without it a reload lost a created card's receipt,
because `openProposals` holds only open proposals. Implemented in
`packages/core/service/chat/conversations.ts`, asserted in
`proposals.postgres-conformance.test.ts`. Swift `Decodable` ignores the new key. CONTRACT.md
also records the client rules (idempotent first message, persistent Create ids,
superseded/invalidated cards, foreground-only presence, render-then-ack, callback path).

## Verification

Automated:
- 25 new client tests (`lib/chat/*.test.ts`, `components/chat/ChatProposalCard.test.tsx`):
  fragmented/CRLF frames; cursor handoff and duplicates; gap → snapshot; `snapshot_required`
  frame and 409; reconnect from cursor after close; polling fallback with backoff;
  401 and `chat_unavailable` stop; revocation replaced from an authorized snapshot;
  presence/ack (never while background, only after renewal, monotonic, coalesced,
  retried); proposal modes; frozen assignment display; superseded and invalidated cards;
  lost Create retried with the same id → receipt; stale revision → resync.
- Webapp suite 315/315; webapp typecheck clean; lint clean on changed files.
- Backend chat suites on SQLite and Postgres 117/117, proposal suite 20/20 with the new assertion.

Live (isolated Postgres, cloud-mode backend, Vite SPA, Chromium via Playwright, real
`gemini-3.8-flash`):
1. Chat entry above Inbox; empty state; provider readiness `gemini-3.8-flash · Ready`.
2. New conversation: "banner when the backend is unreachable…" → live streaming, tool
   activity, the assistant routed the work to OverlordMobile and asked which agent to use;
   the option was answered from the card; a two-objective proposal with the frozen
   `codex · gpt-5.6-terra · medium (chosen by the assistant)` assignment appeared;
   **Create drafts** produced draft `eng:1` (2 objectives), shown with its live title and status.
3. Reload: receipt rendered from `referencedProposals`, no Create offered.
4. Rename and archive/unarchive updated header and lists.
5. Knowledgebase Connect with no server configuration showed the not-configured message; the
   `/settings/connections?status=denied` return showed the result banner.
6. Notifications: with the tab foreground, all four candidates (two `question:1`, two
   `terminal:completed`) were `suppressed` by acks; with the tab hidden and its stream still
   open and rendering, presence was released, nothing was acknowledged, and the
   candidate was `dispatched`.

The first live run exposed and fixed two defects: questions are opened by events without a
transcript block, so the card did not render; and a nested `<main>`.

## Remaining limitations

- **Knowledgebase and repository reads were not live in the browser run.** The Knowledgebase
  was not configured (real sign-in blocked as recorded in zb9x/vx29), and the seeded projects
  had no execution target, so the research used Overlord project/mission data only.
  Revocation was verified through the transport tests, not a live revoked source.
- **Desktop shell not launched.** Desktop renders the same SPA; Local mode is gated on
  `meta.backendMode` (code-path only). Desktop sign-in returns to the hosted web
  `/settings/connections`, so the desktop panel asks the person to confirm after signing in.
- **Citation refs are not linked.** The text keeps `[E3]` refs, but the DTO carries no ref →
  evidence mapping, so sources are listed rather than linked inline.
- `tool.updated` labels are raw tool ids (from vx29). The model's closing text said Create
  would "queue and launch", which is wrong (Create is draft-only; the card says so) — a
  runtime prompt fix.
- Acknowledgements go out once per rendered event batch while streaming (about 25 in a 50 s
  run); cheap, but could be throttled.
- Earlier-message paging resets on a snapshot reload. Dev-only: the Vite proxy delays the
  SSE response line until the first frame; the backend flushes headers immediately.
- Unrelated pre-existing 400s on `/api/launch-settings` and `/api/agent-catalog` appeared
  for the fresh test account.
