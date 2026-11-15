# ADR 0058: Durable objective brief worker and the objective writing profile

- Date: 2026-11-14
- Status: accepted
- Contract version: 172.2.0
- Supersedes: none (builds on ADR 0057)

## Context

ADR 0057 gave objectives durable brief state: title and description ownership,
current-instruction authorship, generation tokens, pending/failed status and removal
suppression. It deliberately shipped no consumer. Pending summary intent accumulated, and objective
titles were still written by a fire-and-forget model call that dropped failures silently and could
not combine with the summary call (mission coo:1275; plan
`planning/feature-plans/objective-descriptions-ste.md`, review findings 1, 3, 6 and 8).

The settled product rules still apply: summaries are one to three prose paragraphs that open with
the goal and close with the done-when sentence; 120 words is a target, not a cap; agent- and
assistant-written instructions qualify automatically with or without an attached session; people
never get an automatic summary for their own text; Remove keeps a summary absent until a person
selects Summarize; objective titles use the Simplified Technical English style; launch never waits
for a model.

## Decision

1. **One job kind.** `overlord.objective.brief.compose.v1` (payload `{ objectiveId }`) is a
   core-documented `worker_jobs` type. The intent stays on the objective row; the job only says
   "look at this objective".
2. **Transactional enqueue from one place per write kind.** The shared objective insert (every
   create surface: REST, protocol, hosted MCP, in-app chat, inbox conversion, scheduled missions),
   the REST/protocol update path, Summarize/Regenerate/Retry and catch-up enqueue the job in the
   same transaction as the write that leaves `title_status` or `description_status` pending.
   Automatic requests are debounced (5 s, pushed back by later edits but never more than 60 s after
   the job was queued); explicit requests run at once. A queued job is reused; a running job is left
   alone.
3. **No lost requests.** Job completion takes the objective row lock (Postgres `FOR UPDATE`), finishes
   the job and, if brief work is still pending on the live row, queues a successor in the same
   transaction. Within one job the worker re-reads the row and runs up to three passes while its
   result is stale. A restart or lost job is repaired by a bounded sweep that re-enqueues pending
   rows that have no queued or running job.
4. **Titles move to the worker.** A system-owned title (`title_source = 'generated'`) whose
   instructions are longer than 100 characters is requested as `title_status = 'pending'`; shorter
   instructions get the local title in the same statement (create, instruction edit, or clearing an
   authored title). The fire-and-forget objective title call is retired. Mission titles keep their
   existing path.
5. **One provider call, independent fields.** The worker requests only the fields that are still
   wanted and eligible — title, description or both — in one call with one versioned schema
   (`OBJECTIVE_BRIEF_SCHEMA_VERSION = 1`: `title` and/or `description { goal, decisionsNeeded[],
   body[], doneWhen, doneWhenStated }`). Each field publishes under its own ownership and generation
   guard (ADR 0057), so a description result never touches a title and vice versa.
6. **Deterministic assembly and fidelity floor.** The server builds the prose: the goal opens the
   first paragraph, each `Decision needed:` sentence follows it, at most two body paragraphs follow,
   and the done-when sentence closes the last paragraph. When the instructions state no completion
   test, the fixed sentence "The instructions do not say how to confirm that the work is complete."
   is used; a test is never invented. Model text is normalized to plain prose (no headings, lists,
   HTML, control or bidirectional characters). The instructions travel to the model as a JSON string
   value and are declared data. Every identifier-like token in the output (code spans, paths, file
   names, flags, URLs, display ids, environment variables) must appear verbatim in the instructions,
   and a summary of instructions that contain a prohibition must keep a negation. These checks are a
   floor; they do not prove fidelity.
7. **Advisory STE lint with one bounded retry.** A heuristic linter reports long sentences,
   ambiguous modals (with a replacement from the confidence vocabulary), contractions, semicolons,
   stacked or unsupported hedges and passive voice, plus goal/done-when/title length and a soft
   length ceiling (180 words). Invalid output, a fidelity failure or a style issue (except passive
   voice) asks for exactly one rewrite with the problems quoted. The best valid candidate wins; if no
   candidate is valid the field fails with `invalid_output` or `unfaithful_output` and people keep
   reading the instructions.
8. **Shared writing rules without silent drift.** The base rules move unchanged to
   `automations/src/writing/ste.ts` (pinned by a hash test) and remain what the delivery and
   mission-summary composers use. A stricter objective profile extends them for objective titles and
   summaries only: "must"/"can" instead of ambiguous modals, condition before command, `CAUTION:`
   before the step, no contractions or semicolons, the confidence vocabulary and the ambiguity
   vocabulary. Other composers adopt it only with their own regression fixtures.
9. **Operational limits.** Provider timeout 45 s; model input bounded to 40,000 characters
   (longer instructions get a title from the bounded prefix and no generated summary, recorded as
   `unfaithful_output` because a faithful summary of unseen text is impossible); output bounded to
   1,200 tokens; at most three jobs drained per tick; catch-up and orphan recovery run at most every
   five minutes, 25 rows each. With no provider configured, the local title stays final and the
   summary records `provider_unavailable` (Retry works once a provider exists). Transient provider
   errors retry with the shared backoff; the last attempt records `provider_error`. Raw provider
   messages, prompts and instruction text are never stored or logged.
10. **Catch-up scope.** Only live `draft`/`submitted` rows with agent-written current instructions,
    eligible length, no summary, no outstanding or failed request and no suppression are marked;
    unknown authorship never qualifies. Rendering, reordering, expanding or reopening a card never
    requests a brief.
11. **Both editions.** The worker runs in the backend process for SQLite (Local) and Postgres
    (Cloud), registered with the other mutation-nudged loops, and can be paused with
    `OVERLORD_OBJECTIVE_BRIEF_COMPOSE_DISABLED=1`.

## Consequences

- Pending intent written under ADR 0057 is consumed: the first sweep re-enqueues it.
- Protocol-, MCP- and chat-created objectives without a title now get a model title for long
  instructions (before, only REST-created objectives did).
- Clearing an objective title produces a title again immediately (local) or after the worker runs.
- A generated objective title or summary moves `revision` and appends an `entity_changes` row but
  never `updated_at`, so finishing generation does not reorder activity or raise a new work or
  decision notification.
- Execution contexts remain instruction-only: nothing in this decision adds the description to a
  launch or agent context.
- No REST, protocol or MCP wire shape changes here; exposing descriptions and Summarize/Remove is a
  later additive change.

## Alternatives considered

- **Keep the fire-and-forget title call next to the job.** Two calls, two vocabularies and silent
  title loss. Rejected: one call writes both (plan §4.1).
- **Deduplicate by objective id in the payload only.** Loses an edit made while a job runs (review
  finding 1). Rejected in favour of row intent plus a locked successor check.
- **Trust the model and accept the better of two attempts.** A style linter cannot detect an
  invented path or a dropped prohibition. Rejected: invalid or unfaithful output never publishes.
- **Truncate long instructions for the summary.** A summary of half the instructions reads as
  complete. Rejected: no generated summary beyond the bounded input.
- **Apply the stricter rules to every composer at once.** Changes delivery and mission-summary text
  without their own fixtures. Rejected (review finding 8).
