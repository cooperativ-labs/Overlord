# Gemini research runtime, evidence, and source revocation — coo:1108.vx29

Phase C, objective 07. Builds on contract v152 (coo:1108.vasc), the durable
conversation services (coo:1108.a1ac), account connections and the Knowledgebase
client (coo:1108.zb9x), repository inspection (coo:1108.zg8m), and the Phase A Gemini
proof (coo:1108.cag9). Codex, Local, provider fallback, coo:1109, and coo:1110 are out
of scope. Proposal preparation and Create are Phase D (coo:1108.k0tc).

## What was built

| Layer | File | Responsibility |
| --- | --- | --- |
| Core | `packages/core/service/chat/access.ts` | `ChatAccess`: the thread owner's live organization memberships and role grants (no request snapshot exists in a background run); the `overlord` and `repository` source checkers |
| Core | `packages/core/service/chat/tools.ts` | `ChatToolGateway`: the fixed, Overlord-authored tool list, closed-schema argument validation, owner-scoped Overlord reads, `repository_read` through the zg8m service, Knowledgebase reads through the zb9x client, bounded provider content, source metadata |
| Core | `packages/core/service/chat/runs.ts`, `store.ts` | `recordEvidence`, `attachCitations`, `summarize`, `questionSince`, `dependencies`; `input()` also returns questions, run usage/limits, summary coverage and the next turn index; shared `registerSources` (used by `Conversations.sources`) and `checkSources(thread, ids?)` |
| Backend | `backend/chat/gemini-client.ts` | Narrow seam over `@google/genai` 2.8.0 `generateContentStream`/`generateContent`; provider error classification |
| Backend | `backend/chat/gemini-runtime.ts` | `GeminiChatRuntime` (the worker's `ChatRuntime`): streamed tool loop, run-local verbatim checkpoints, parallel reads (four at a time), `ask_user` as a checkpointed call, citations, summaries, allowance handling, readiness |
| Backend | `backend/chat/engine.ts`, `backend/index.ts` | Engine bootstrap from configuration; source checkers registered with the connections module; `GET /api/chat/providers`; the worker now runs the Gemini runtime instead of the unavailable one |
| Backend | `backend/connections/index.ts` | `createConnectionsRuntime({ checkers })` composes the Overlord and repository checkers with the Knowledgebase checker |

Contract: `CONTRACT.md` v152 "Gemini research runtime and tool gateway (coo:1108.vx29,
refines v152)" and `contract/components.yaml`. No DTO, table, or route shape changed;
`GET /api/chat/providers` was already contracted and is now implemented. Configuration:
`CHAT_GEMINI_API_KEY` (falls back to `GEMINI_API_KEY`), `CHAT_GEMINI_MODEL` (default
`gemini-3.8-flash`), `CHAT_MAX_GATHERED_BYTES_PER_RUN` (default 1 MiB), documented in
both `.env.*.example` files.

## Design decisions

- **The checkpoint holds only this run's provider turns.** Phase A showed that only
  the current turn's function-call parts need signatures. The prefix (summary and
  authorized messages) is rebuilt from storage for every request, so revoked or
  withheld content can never re-enter through a checkpoint, and resuming after a
  question does not duplicate the answer message.
- **`ask_user` is a tool call, not a side channel.** The call is checkpointed like a
  read; the question opens through the existing question path, the lease is released,
  and the user's answer becomes that call's recorded result when the run resumes from
  its checkpoint. The function-call/response pairing is never broken.
- **Evidence is recorded with the result, before the result is stored.** Sources are
  registered and checked live inside the read; a source that is not `authorized`
  withholds the content (`source_unverified`), so unverifiable content is never stored
  for provider input. The tool call's dependency set grows to include its sources, so
  recovery and fresh-generation observations are authorized against them.
- **Citations are thread-local refs.** Results tell the model `E<n>` refs; the final
  `[E<n>]`/`[E<n>, E<m>]` citations become `evidenceIds` and one evidence block per
  cited source. The ref-to-evidence map is stored in receipts, so it survives restarts.
- **Conservative unions.** Streamed text, questions, checkpoints and summaries use the
  union of every authorized dependency set in the thread; a cited message additionally
  adds its cited sources. Revoking any source therefore invalidates every block that
  could have used it.
- **Permissions come from the database, not the model.** Each Overlord or repository
  read resolves the owner's live role grants in the project's workspace at call time.
  An undeclared tool answers `unknown_tool`; extra or malformed arguments answer
  `invalid_arguments`; another workspace's project answers `not_found`.
- **Allowance exhaustion drops the unexecuted turn.** A function-call turn that would
  exceed the tool limit is never checkpointed; one tool-free request writes the
  closing summary and the run completes `allowance_exhausted` (Continue available).
- **Provider errors are typed; other errors are not disguised.** SDK errors with a
  status and transport failures map to the closed codes; any other exception (a bug,
  a database error) propagates and the worker records `provider_error` as before.

## Verification

### Automated (both databases)

`backend/chat/gemini-runtime.postgres-conformance.test.ts` drives the real runtime,
gateway, access checks and stores against a scripted Gemini client that returns signed
parts. 11 scenarios per database:

| Scenario | Proves |
| --- | --- |
| Parallel Knowledgebase + repository reads | Both results joined in call order with provider ids; signature preserved; `[E1, E2]` becomes two evidence entries of both kinds; summary written with a dependency set containing both kinds; no signature or function part in snapshot/events; no write-like tool name offered |
| Restart after `requestTools` / after `joinTools` (two tests) | Crash at each boundary, lease expiry, `checkpoint` recovery, then a second crash after a parallel batch's join and a third attempt; every read executed exactly once across three attempts; replay carries both signed model turns verbatim; checkpoint deleted at completion; the stale attempt cannot write |
| Incompatible checkpoint | `fresh_generation`: no function parts or signatures sent, recorded observation reused (not re-read), partial reply `interrupted` |
| Revocation during a live attempt | Revoking the note after its join fences the run `source_access_lost` before another provider request; snapshot/replay contain no note text; checkpoint deleted; regeneration sends only the withheld marker |
| Prompt injection | Injected text plus model calls to `overlord_create_mission`, a Knowledgebase write tool, another workspace's repository, and an extra argument answer `unknown_tool`, `unknown_tool`, `not_found`, `invalid_arguments`; no mission created; identical tool list every turn |
| `ask_user` | Waiting run, open question with options, `chat_needs_answer` candidate; answer resumes from the checkpoint with the answer as the call result next to the parallel read; one assistant message spans the question |
| Allowance | Tool-free (`NONE`) closing request; `allowance_exhausted` with Continue |
| Typed failure | 429 → `rate_limited`; readiness `rate_limited`; no key → `not_configured` |
| Cancellation during a read | Run `cancelled`; no further provider request |
| Overlord reads | Owner sees only readable projects; mission by display id; stranger gets `not_found`; deleting the mission and removing the role revoke the sources |

Commands (Node 24, from the repository root):

```sh
TMPDIR=/tmp node scripts/with-test-db.mjs node --import tsx --test --test-concurrency=1 \
  backend/chat/gemini-runtime.postgres-conformance.test.ts \
  packages/core/service/chat/chat.postgres-conformance.test.ts \
  backend/connections/connections.postgres-conformance.test.ts backend/chat.test.ts \
  database/src/chat-schema.postgres-conformance.test.ts \
  packages/core/service/repository-reads.postgres-conformance.test.ts
```

Results: 109/109 on SQLite and Postgres (22 new runtime tests, one new providers-route
test, unchanged predecessor suites). `yarn test:core` 588/588, `yarn test:backend`
586/586, core typecheck clean, backend typecheck has only the two existing
`runner-claim-http.test.ts` errors, lint clean on changed files, workspace-scoping
check passes. The new suite is in `yarn test:conformance`.

### Live (`planning/spikes/coo-1108-vx29/live-research.ts`)

Real: Gemini `gemini-3.8-flash` through the production runtime, gateway, conversation
services and `ChatWorker`; repository reads through `performRepositoryRead` → the
mission-less runner queue → the real claim → the target-side read code the runner
executes (`InProcessProvider` + `executeLocalTargetMutation`) on this machine's
Overlord (HEAD `34e44ebe`) and OverlordMobile (HEAD `2e468876`) checkouts; the
production connections module and `KnowledgebaseMcp` client with OAuth sign-in.
Not real: the Knowledgebase server is the in-memory fake with one seeded design note,
and the claim/complete loop runs in-process instead of over the runner's HTTP route.
Results: `planning/spikes/coo-1108-vx29/results/live-research-2026-10-04.json`.

| Run | Outcome |
| --- | --- |
| Research ("What would adding offline support require across Overlord and OverlordMobile? Check our notes and what is currently being changed…") | Completed `answered` in 44 s; 26 tool calls (project/target discovery, Knowledgebase `list_workspaces`/`search`/`read_file`, 20 repository reads incl. status, diff, search and file reads on both checkouts), 107 KB gathered, 18 cited sources (Knowledgebase note, Overlord projects, repository observations with HEAD and time); the answer separated the note's requirements from the observed code gaps and stated observation times; summary written |
| Restart | First worker killed right after a parallel join (`tool_results_joined`); second attempt `checkpoint` recovery `succeeded`; all five reads executed once; correct answer (37 vs 2 unstaged files) |
| Revocation | Node revoked upstream: the research answer became one `unavailable` block; the note text was absent from the snapshot and from every later provider request, which carried the withheld marker; the follow-up re-read the note, got `source_unverified`, and told the user it could not access the notes |

The first live attempt exposed two defects, both fixed and covered by tests: combined
citations (`[E5, E6]`) were not parsed, and the summary request (sent with tool
history but no declarations and a 1,024-token cap) failed silently; summaries now use
a plain-text transcript. It also showed the model treating repository documents as
"our notes", so the system prompt now names the Knowledgebase as the user's notes.
(The harness's first two runs also failed to connect the Knowledgebase because its
fetch wrapper parsed form bodies as JSON; that was a harness bug.)

## Remaining limitations

- **Real Knowledgebase reads remain unverified** for the same reasons as zb9x: the
  client metadata document is not deployed and the account holder has not signed in.
  The live Knowledgebase content came from the fake server through the production
  client. Rechecked in coo:1108.z77k.
- **Hosted backend and runner HTTP transport not exercised here.** Repository reads used
  the real queue, claim and target code in-process; the hosted-to-runner path was
  proved locally by zg8m and still needs the deploy and runner update.
- **Proposal preparation is not a tool yet.** The assistant describes drafts in text;
  the versioned proposal tool, frozen assignments and Create are coo:1108.k0tc.
- **A live attempt that loses source access fails** `source_access_lost` instead of
  restarting itself; regeneration happens on the user's next message. Combined with
  the fail-closed `unknown` rule from a1ac, a transient Knowledgebase outage during a
  check permanently invalidates content that cited it.
- **Citations resolve only refs from the current run's reads.** Refs from earlier runs
  in the thread are not attached as evidence (the text still shows them).
- **Token scope is not applied to assistant reads.** `USER_TOKEN` bearers other than
  `project_automation` reach `/api/chat/*` (backend/auth.ts step 2), and the background
  run reads with the owner's role grants, so a narrowly scoped token is not narrowed
  when it drives the assistant. Needs a contract decision (session-only chat, or
  persisting the submitting token's scope on the run).
- **Untuned budgets.** Five live runs used 5–26 calls, 13–44 s and 8–193 KB; the 1 MiB
  content budget and 60-call limit are defaults pending the routing sample in z77k.
- `tool.updated` labels are raw tool ids; the evidence `stale` flag is computed once,
  when evidence is attached.
- Gathered notes, files and diffs are sent to Gemini; inference is paid by the operator.
