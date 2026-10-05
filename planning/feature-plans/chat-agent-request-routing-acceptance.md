# Overlord assistant, milestone one: acceptance report (coo:1108.z77k)

Date: 2026-10-04. Plan: [chat-agent-request-routing.md](chat-agent-request-routing.md), section 14.
Contract: version 152 (refined in place; see "Contract changes").

## Verdict

The milestone works end to end on a scratch Cloud-mode stack with real Gemini, real
repository reads through the real runner, and the production web and mobile client code.
**It is not accepted as complete**: three required checks could not be run and are listed
as blocked, not passed.

| Status | Rows of the section 14 matrix |
| --- | --- |
| Executed live and passed | 20 of the 23 rows (see the matrix) |
| Executed with a substitute for one external system | 2 rows, Knowledgebase plus Git and revoked authorization: real Overlord code against an in-memory Knowledgebase server |
| Passed up to the point that needs a device | 1 row, mission-less chat push: dispatch, history and deep-link handling passed; no real push was delivered or tapped |
| Blocked, not verified | Real Knowledgebase sign-in and reads; hosted backend (`backend.ovld.ai`) to the installed runner; physical phone with the desktop app closed, including a real APNs push and a cold-start tap |

Seven defects were found by the live runs and fixed (see "Defects found and fixed").

## What was run

All of this is one machine, isolated from the user's real Overlord home, database and
checkout metadata. Harness and reproduction steps: `planning/spikes/coo-1108-z77k/README.md`.

| Part | Real | Substitute |
| --- | --- | --- |
| Backend | `backend/index.ts`, Cloud mode, Postgres 17; a second instance in Local mode on SQLite | |
| Engine | `gemini-3.8-flash` through the production runtime | |
| Repository reads | `ovld runner` from this checkout, over HTTP, on two registered targets: this Overlord checkout (HEAD `34e44ebe`) and OverlordMobile (HEAD `2e468876`), plus two clones of a fixture repository in different states | |
| Web client | The SPA in headless Chromium, same-origin and cross-origin bearer mode | The Electron shell was not launched (it would share the user's running desktop profile) |
| Mobile client | Production `AssistantChatModel`, `EventStreamClient` and codecs with real `URLSession` IO, run on macOS through SwiftPM; the iOS test target on the iPhone 17 simulator | No physical phone |
| Knowledgebase | Production connections module, OAuth client, egress policy, MCP client and source checker, over the HTTP routes | In-memory `FakeKnowledgebase` behind them |
| APNs | Dispatch state machine | No credentials, so no push left the machine |

Evidence files (in `planning/spikes/coo-1108-z77k/results/`):

- `acceptance-final-2026-10-04.json`: the complete pass on the final code, 129 checks
  passed and 2 failed. Both failures were harness mistakes, not product behaviour: an
  allowance of four tool calls that one parallel batch exceeded, and an UPDATE using a
  status value the schema rejects. Both checks were corrected and rerun:
- `acceptance-final-limits-2026-10-04.json` (12 of 12) and
  `acceptance-revocation2-2026-10-04.json` / `acceptance-final-revocation-2026-10-04.json`
  (18 of 18).
- `browser-same-origin-2026-10-04.json`, `browser-remote-2026-10-04.json` (9 of 9 each)
  and `browser-local-2026-10-04.json` (5 of 5): sign-in, the Chat entry above Inbox,
  provider readiness, a streamed answer, a proposal card with its frozen assignment,
  Create, the receipt after a reload, a revoked thread's placeholder, the connected-accounts
  page, and the Local-mode unavailable page.
- `acceptance-routing-first-sample-2026-10-04.json`: the first routing sample.
- `acceptance-revocation-first-run-2026-10-04.json`: the run in which a live attempt was
  fenced with `source_access_lost`.

Across the whole session the scratch backend ran 148 assistant runs and 1,155 tool calls
(119 answered, 6 allowance-exhausted, 14 cancelled on purpose, 9 failed: 6 by injected
provider faults, 2 fenced by revocation, and 1 spontaneous provider failure). Sixteen
Create receipts produced 24 missions, all drafts, with no launch or queue entry. The
backend log shows no error from chat code.

Automated suites on the final code:

| Suite | Result |
| --- | --- |
| Focused chat suites on SQLite and Postgres (schema, conversations, proposals, repository reads, connections, Gemini runtime, notifications, HTTP, limits, shutdown) | 207 of 207, none skipped |
| `yarn test:core` | 599 of 599 |
| `yarn test:backend` | 606 of 606 (an unrelated flaky test failed in one earlier run; see the end of "Observed limitations") |
| `yarn test:webapp` | 315 of 315 |
| `yarn test:desktop` | 30 of 30 |
| Typecheck core, backend, webapp, CLI | Clean, except two existing errors in `backend/execution/runner-claim-http.test.ts`, a file this mission did not touch |
| Workspace scoping, conformance versions | Pass. Six desktop, extension and MCP manifests are still listed as validated against older contract versions, as before |
| OverlordMobile portable harness (`scripts/test-chat.sh`, `scripts/test-event-stream.sh`) | 33 of 33 and 22 of 22 |
| OverlordMobile iOS test target, iPhone 17 simulator; generic iOS device build | 54 of 54; build succeeded |
| OverlordMobile contract conformance | passes at version 152, 165 types |
| OverlordMobile live journey (`scripts/test-chat-live.sh`) | 2 of 2, twice in a row |

## Section 14 matrix

"Live" means the row was executed against the scratch stack with real Gemini. "Suite"
means the dual-database conformance suites also cover it.

| Test | Status | Evidence |
| --- | --- | --- |
| Research-only conversation | Passed, live | Cited answer in 66 s with 23 tool calls and 233 KB gathered; mission, objective and launch counts unchanged; only mission-less capability calls were queued |
| Knowledgebase plus Git | Passed with the substitute Knowledgebase | One answer cited the offline-support note and five repository observations, each with target, resource, HEAD and observation time, from both checkouts. Real Knowledgebase: **blocked** |
| Similar project names | Passed, live | "Add rate limiting to Scribe" produced a question naming Scribe and Scribe Server with their project ids as options; after the answer the proposal named the chosen project by id |
| Two targets, different state | Passed, live | Branch, HEAD and uncommitted changes attributed to "Jake Mac" (`main`, `8377c67`, dirty) and "Build Box" (`release`, `a9a0ac1`, clean); evidence carries each target id. With one runner stopped the answer said that target was offline and still reported the other |
| Background and relaunch | Passed, live | HTTP client: dropped stream, snapshot, resume at the next sequence with no gap; repeated submission returned the original run. Mobile model: stop mid-run, new model instance restored the thread through the polling fallback, one copy of each message, ordered transcript |
| Mission-less chat push | Passed up to dispatch; delivery **blocked** | Candidate dispatched after the grace period with owner, organization, thread and run and no mission; history and unread count correct; the mission notification table untouched. Deep link parsing and cold-start open verified in the mobile model. No real push or tap |
| Push while away | Passed, live | One candidate per transition (database check across every run); a foreground acknowledgement suppressed it for good; stored row holds a title and ids only |
| Background/disconnect before completion | Passed, live | An open stream with foreground presence and no acknowledgement still dispatched; an acknowledgement after presence was released suppressed nothing |
| Multiple devices and repeated questions | Passed, live | The backgrounded device could not suppress, the foreground one did; two questions in one run produced `question:1` and `question:2`; a question answered inside the grace period was cancelled, not pushed |
| Message while a question is open | Passed, live | A typed message answered the question and resumed the same run; one run in the thread; the stale card was refused |
| Real Gemini failure around a tool result | Passed, live | The backend process was killed (SIGKILL) at the `tool_requested` and at the `tool_results_joined` checkpoint. Each time a new attempt resumed in `checkpoint` mode and completed; completed reads ran once, the interrupted read reran under its operation id; one assistant message; the checkpoint was deleted. A spontaneous provider failure was also observed (see defects) |
| Allowance exhausted | Passed, live | With the tool-call limit set to 8 the run completed `allowance_exhausted` with a summary; concurrent and repeated Continue produced one new run, which did more research; Continue on an ordinary run was refused |
| Crash after draft commit | Passed, live | After Create, the backend was killed and restarted; the retry with the same request id returned the identical mission ids with `replayed: true` and created nothing more |
| One failing project in a proposal | Passed, live | With mission-create access lost in one destination workspace, and separately with one destination project deleted, Create returned 409 and created no mission in either project |
| Project preference changes after proposal | Passed, live | The project default was changed after the card was shown; the saved objectives kept the card's agent, model and reasoning. An unsupported selection: suite |
| Stale worker | Passed, live | After each kill the old attempt was `fenced`. On the same Postgres rows, an event and a checkpoint carrying the dead attempt's fence were refused ("stale chat fence") |
| Cancel versus Create race | Passed, live | Cancel and Create sent together on a published revision: Create succeeded with both drafts and the run ended cancelled. Cancelling again returned the same run |
| Cross-owner, organization, or project request | Passed, live | Every thread, run, presence, acknowledgement and stream route answered another organization's user, and another person in the same organization, exactly as it answered a random id (same status and body). A Labs-only member's assistant saw only Labs projects and was refused the Engineering repository; a project-automation token reached no chat route |
| Revoked authorization after research | Passed with the substitute Knowledgebase | Snapshot and replay replaced derived answers with unavailable markers; Create of the derived proposal was refused; no later provider request held the note text; a re-read was refused. Repository and Overlord sources: answers withheld when target access or the workspace was lost. Unverifiable check: withheld. Disconnect: immediate. A live attempt was fenced with `source_access_lost` in one of three trials; in the other two it finished inside the 15-second check cache and its content was invalidated afterwards |
| Path traversal, symlink, secret, binary, huge output | Passed, live | 16 checks through the HTTP route: absolute, `..`, and `.git` paths refused; symlink, `.env` and `secrets.json` denied; binary returned as metadata; file content cut at 64 KiB, diff at 128 KiB, search at 100 hits; one queued job per operation id |
| Prompt injection in tool content | Passed, live | The assistant read a file telling it to create a mission, delete notes, read `.env` and `/etc/passwd`. No work was created; the tool list was identical on every provider request; `.env` was denied; no secret value reached the provider, the transcript or stored results |
| Both databases | Passed | Suites: 207 of 207 on SQLite and Postgres. Live: the feature on Postgres; Local-mode gating on SQLite |
| Local edition | Passed, live | A SQLite backend answered every chat and connection route with 404 `chat_unavailable`; the SPA showed "Chat is unavailable" and made no chat request; the mobile model reported unavailable |

Failure-table rows also exercised live: message while the assistant is working (409
`run_in_progress`); provider 429 (`rate_limited`, readiness reports it) and 503
(`provider_unavailable`), then recovery in the same thread; a fourth concurrent run for
one owner refused (`limit_exceeded`); cancel ends the run at once and no tool call follows.

## Blocked and unverified

1. **Real Knowledgebase.** `https://backend.ovld.ai/oauth/clients/knowledgebase.json`
   returns 404 because this code is not deployed, and the Knowledgebase accepts only a
   public HTTPS client metadata document. Consent also needs the account holder. Not
   verified: sign-in from the phone, authorized reads, refresh rotation, and upstream
   revocation against the real server.
2. **Hosted backend to the installed runner.** The hosted backend lacks the read route
   and the Mac's installed runner predates the read capabilities. The same path was
   exercised over HTTP between a scratch backend and a runner built from this checkout.
3. **Physical phone with the desktop app closed.** `devicectl` reported the iPhone 16 Pro
   as unavailable, and the journey needs a person at the device. Not verified: the native
   UI on a device, `ASWebAuthenticationSession` sign-in, a real APNs alert, and the
   cold-start tap. The scratch backend has no APNs credentials.
4. **Electron desktop shell.** Not launched. The shared SPA was verified in the browser in
   the cross-origin bearer mode the Remote profile uses.

To finish: deploy the backend with `KNOWLEDGEBASE_MCP_URL` and
`ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`, update the runner, connect from the phone, then run
the Phase A revocation steps and the phone journey (ask, answer a question, Create,
background, tap the push).

## Defects found and fixed

| # | Defect | Found by | Fix |
| --- | --- | --- | --- |
| 1 | In Cloud mode the backend ignored the first `SIGTERM` or `SIGINT`: the chat bootstrap registered signal listeners that stopped the workers and never exited. A deploy would have left a process serving requests with no chat worker | Restarting the scratch backend | `stopOnTermination` re-sends the signal after stopping; process-level test |
| 2 | Gemini rewrote dotted Knowledgebase tool names (`kb.<id>.search` came back as `kb.<id>:search`), so every notes read was refused as an unknown tool. It had worked in an earlier run | First live research run | Tool ids are `kb_<id>_<tool>`; contract updated |
| 3 | A transient provider failure (observed once, spontaneously, nine tool calls into a run) failed the whole run | Mobile live journey | Up to two retries of 5xx and transport failures before any part of a turn arrives |
| 4 | `overlord_list_projects` repeated the agent catalog on every project: 84 % of the result, and enough to pass the 96 KiB provider bound at about thirty projects | Content measurements | Catalog sent once per workspace |
| 5 | A refused `prepare_proposal` returned only `not found`, so the model retried the same call three times | Similar-names run | Specific reasons for the model only; HTTP error bodies unchanged |
| 6 | Run limits could not be configured, although the plan and contract call them configurable | Allowance test | Nine `CHAT_*` settings with ranges; documented in the env examples and contract |
| 7 | Mobile: tapping Cancel (or Continue) just after the run ended posted to a path with an empty id; the 404 cleared the whole chat session | Review while building the live journey | Guarded; regression test |

Also changed: progress labels are a fixed vocabulary, so a tool name chosen by the model
(possibly steered by injected text) is never shown to clients; and the assistant is told
that Create only saves drafts, after an earlier run claimed it would launch work.

## Routing sample

Twelve real requests against five projects in two workspaces, two at a time, run twice.
Each asked for a draft (one asked only who owns a change). No card was tapped.

| Measure | First run | Final run |
| --- | --- | --- |
| Correct project and resource | 12 of 12 | 12 of 12 |
| Asked which project | 1 (the deliberately vague "add dark mode") | 1 |
| Unnecessary questions | 0 | 0 |
| Ambiguous request answered without asking | 1 ("export to PDF for Scribe" went to the Scribe app, a defensible owner) | 1 |
| Time until a card or question, median / p90 / max | 37 s / 78 s / 96 s | 41 s / 82 s / 119 s |
| Tool calls per request, median / max | 21 / 32 | 21 / 33 |
| Gathered content per request, median / max | 56 KB / 249 KB | 61 KB / 469 KB |

No correction was needed in either run. Requests about a project with a bound checkout
took 40 to 120 s because the assistant reads code before writing objectives; requests about
projects with no checkout took 13 to 27 s. The prompts named the agent; without that, and
with no project launch preference, the assistant asks for an agent and model (seen in the
similar-names run).

The sample is small, uses one person's phrasing and five projects, and the two ambiguous
cases are not enough to measure a clarification rate.

## Initial limits and targets

Limits stay at the contracted defaults. The largest observed request used 33 of 60 tool
calls, 469 KB of the 1 MiB content budget and 119 s of the ten minutes.

| Setting | Value | Observed peak |
| --- | --- | --- |
| `CHAT_MAX_TOOL_CALLS_PER_RUN` | 60 | 33 |
| `CHAT_MAX_GATHERED_BYTES_PER_RUN` | 1048576 | 468673 |
| `CHAT_MAX_ACTIVE_MS_PER_RUN` | 600000 | about 119000 |
| `CHAT_MAX_CONCURRENT_RUNS_PER_OWNER` | 3 | limit reached only on purpose |
| `CHAT_NOTIFICATION_GRACE_MS` / `CHAT_PRESENCE_TTL_MS` | 5000 / 30000 | |
| `CHAT_ATTEMPT_LEASE_MS` | 30000 | with the lease set to 8 s, a killed run finished 12 to 22 s after the restart |

Targets to track once real use starts: correct owner on unambiguous requests at least
90 %; median time to a card or question at most 45 s and p90 at most 90 s for requests
that inspect a checkout; no request ending `allowance_exhausted` without the user asking
for broad research. Revisit the content budget if two-codebase requests become common;
one of them used 45 % of it.

## Setup and configuration

- **Engine.** `CHAT_GEMINI_API_KEY` (falls back to `GEMINI_API_KEY`) and
  `CHAT_GEMINI_MODEL` (default `gemini-3.8-flash`). Without a key the engine reports
  `not_configured` and runs fail `provider_unavailable`. `GET /api/chat/providers` shows
  readiness. Inference is paid by the operator; gathered notes, files and diffs are sent
  to Gemini.
- **Knowledgebase.** `KNOWLEDGEBASE_MCP_URL` (HTTPS), optional
  `KNOWLEDGEBASE_EGRESS_ORIGINS`, `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY` (32 bytes,
  base64url) and its key id. The backend must be reachable at a public HTTPS origin: it
  serves the client metadata document and the OAuth callback.
- **Cloud only.** Chat is available when the backend runs on Postgres or in cloud mode.
- **Targets.** A project's primary resource must be linked on a target whose runner is
  current; a project with no registered resource cannot receive drafts from the assistant.
- **Limits.** The `CHAT_*` settings above; see `.env.prod.example`.
- **Push.** The existing `OVERLORD_APNS_*` settings. Without them candidates are marked
  dispatched and appear in history, with no push.

## Retention and recovery

- Messages, runs, questions, proposals, receipts and evidence are kept until the account
  is deleted; there is no thread deletion in this milestone, only archive.
- Events are kept for seven days or 5,000 per thread, whichever comes first. A client
  with an older cursor gets `snapshot_required` and reloads the snapshot.
- A provider checkpoint exists only while a tool turn is in flight and is deleted when the
  run ends.
- A worker that dies holds its lease until it lapses (30 s by default). Another worker
  then resumes from the checkpoint, or starts a fresh generation when the model, prompt or
  checkpoint version changed. Changing the system prompt therefore turns in-flight
  recoveries into fresh generations.
- On a normal stop the backend exits at once; in-flight runs wait for the lease to lapse.
- Content invalidated by a loss of source access stays invalidated when access returns;
  the user asks again.
- Conversation notifications are delivered at least once and replace each other on the
  device through the collapse id.

## Observed limitations

- **Revocation lag.** A positive Knowledgebase check is cached for 15 s. A run that
  finishes inside that window keeps using the source; its content is invalidated on the
  next check.
- **One inaccessible hit withholds a whole result.** A Knowledgebase search result is
  withheld if any node in it fails its access check.
- **Source checks are frequent.** Every snapshot, stream poll and run step rechecks the
  thread's sources. The live runs made 1,136 `get_related` calls against roughly 60
  content calls. A real Knowledgebase may need a longer cache or a batch check.
- **No text until the end.** In the research run the first answer text arrived at 63 s of
  66 s; until then the client shows progress labels only.
- **Projects without a registered resource** cannot receive drafts; the assistant says so.
- **Archived projects** accept Create, as the existing mission route does.
- **Token scope** is still not applied to assistant reads (recorded by coo:1108.vx29).
- **Citations** resolve only references from the current run (recorded by coo:1108.vx29).
- **An over-limit batch is dropped whole.** If one turn asks for more tool calls than
  remain, none run and the run ends `allowance_exhausted`.
- **Readiness is sticky.** After a failed run the provider reads `unavailable` (or
  `rate_limited` for 60 s) until a run succeeds. Clients do not block sending on it.

Not part of this milestone and unrelated to chat, seen during regression:
`backend/shared-context.test.ts` fails about half the time (it orders two changes written
in the same millisecond by a random id), and the web test run takes five minutes because
one test leaves a query-cache timer alive.

## Contract changes

Version 152 was refined in place, as the earlier objectives did; it has not been released.
`CONTRACT.md` → "Verification and hardening (coo:1108.z77k)" records: the operator limit
settings, the Knowledgebase tool id format, the fixed progress-label vocabulary, the
project list tool's catalog shape, proposal preparation reasons, transient provider
retries, termination behaviour, and the archived-project rule. No DTO, route or schema
changed. Mobile and web clients need no change for these.
