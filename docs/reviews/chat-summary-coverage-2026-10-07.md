# Chat summary coverage and context budgets — measured results

Mission **coo:1127**, objective **coo:1127.158y**, 2026-10-07, CONTRACT.md v159 (clarified, no version bump). Baseline: [proposals](chat-optimization-proposals-2026-10-07.md) §P1 "effective summaries", [audit](chat-diagnostics-audit-2026-10-07.md), [instrumentation baseline](chat-performance-baseline-2026-10-07.md). Aggregates: [metrics JSON](chat-summary-coverage-2026-10-07.metrics.json).

## Contract first

CONTRACT.md (Gemini runtime → _Checkpoint payload_, _Summaries_, new _Context budget_ bullet, and a v159 addendum with module impacts) and `database/docs/09-database-schema-contract.md` (`covers_through_message_id` semantics) were updated before code. No schema, REST DTO, route, closed vocabulary or checkpoint-schema change. `CHAT_GEMINI_INPUT_TOKEN_LIMIT` is additive operator configuration. The new `CONTEXT_POLICY_VERSION` enters the config digest, so checkpoints written under the old prefix policy recover through the existing fresh-generation path.

## Changes

**Coverage (Core, `packages/core/service/chat/runs.ts`).** `input()` resolves the latest usable summary's boundary by storage order `(created_at, id)` with a SQL comparison, not by searching the 100-message page. It returns `summaryCoveredCount`, the number of the oldest page messages the summary covers. That count is 0 when the boundary predates the page, and also 0 when the summary is absent, invalidated, unauthorized or its boundary cannot be resolved. The old `findIndex` gave the same answer only by accident. `summarize()` now takes an explicit `coversThroughMessageId`. The ID must belong to the thread and must not precede the latest summary's boundary; violations raise `invalid_request`. The dependency set is still the conservative thread union (`generationDependencies`).

**Prefix selection (Backend, `backend/chat/gemini-runtime.ts`).** With usable coverage, covered messages are replaced by the summary. Three kinds of message are always kept verbatim:

- the run's trigger message, which matters for continued runs whose trigger the summary covers
- every message of the current run
- the four most recent messages, so follow-up references stay intact

Proposal cards, creation receipts and the current run's signed provider turns are supplied separately and never compacted. Invalidation or revocation removes coverage, so the full authorized page with `unavailable` markers is sent, and live fencing is unchanged.

**Summary generation.** The summary call now uses a dedicated instruction of about 120 words instead of the research system prompt. It treats the transcript as untrusted data and returns the same four fields. Output is capped by `maxOutputTokens: 2048`, thinking is set to `low` and no tools are offered. The transcript is incremental: the previous usable summary plus only the uncovered messages, oldest first. It is reread after the final answer commits and cut at a message boundary at 128 KiB. Coverage is set to the last message actually read, which fixes the old path's head-truncation that could claim coverage of unread newest messages. A response is treated as a failed optional summary if any of these hold:

- `finishReason` is not `STOP`
- the JSON is invalid
- a field is out of bounds (text over 6,000 characters, over 20 decisions or open questions, over 50 refs, items over 500 characters, or refs not matching `E<n>`)

A failed summary is recorded as private `summary.error`. It is never stored and never truncated into place, and the run still completes. The eight-message cadence is unchanged.

**Context budget.** Before each tool-enabled request after an attempt's first, the runtime projects the input size. The projection is the previous exchange's reported `promptTokenCount` plus one token per two bytes of content growth. If it exceeds the input limit minus 65,536 headroom tokens, the runtime records `context.budget` and ends through the existing tool-free closing request and `allowance_exhausted` outcome; Continue then starts with the summary prefix. `inputTokenLimit` defaults to 1,048,576, the input limit `models.get` reported for `gemini-3.8-flash` (output 65,536). Without reported usage the request is sent, and a provider rejection keeps `context_limit`. No new failure code is added and context is never silently dropped.

## Method

`backend/chat/long-conversation.live-eval.ts` drives the production `GeminiChatRuntime`, `ChatRuns`, checkpoints and SQLite persistence against **live `gemini-3.8-flash`**. Each conversation is seeded with 80 synthetic messages (40 exchanges, about 500–700 characters each) in which five facts are planted at exchanges 2, 9, 17, 26 and 33. Six follow-up turns then ask for those facts, and the last asks for all decisions. Quality means every required fact appears in the answer.

- **Baseline arm** reproduces the legacy policy. A `ChatRuns` proxy zeroes coverage for prefix selection, so the summary travels with every page message. The summary request is rewritten to the research system prompt, the legacy schema and trailing instruction, with no output bound. Summary calls the legacy cadence would not have made are skipped and not counted.
- **Current arm** is the checked-out code.

The arms are interleaved with alternating order, three conversations per arm (36 turns, 12 summary calls). Tokens come from the provider's `usageMetadata` for each exchange. Raw runs stay in a mode-0700 private directory; only aggregates are published.

## Results (means per conversation of six turns, n = 3 per arm)

| Metric                          |  Baseline (sd) | Current (sd) |    Change |
| ------------------------------- | -------------: | -----------: | --------: |
| Main-request prompt tokens      |   59,712 (102) | 26,941 (161) |  **−55%** |
| Summary-call prompt tokens      |    15,782 (17) |   7,628 (34) |      −52% |
| **Total prompt tokens**         |   75,495 (119) | 34,569 (195) |  **−54%** |
| Implicit-cache tokens reported  |          3,937 |        3,937 |         0 |
| Main output + thought tokens    |      826 (184) |     700 (80) |      −15% |
| Summary output + thought tokens |    1,326 (316) |     655 (57) |      −51% |
| Summary calls                   |              2 |            2 | unchanged |
| Summary-call time (ms)          | 17,622 (4,497) |  9,335 (788) |      −47% |
| Wall time, six turns (ms)       | 40,155 (4,739) | 28,192 (647) |  **−30%** |
| Provider requests               |              6 |            6 |         — |
| Facts                           |          39/39 |        39/39 |     equal |
| Summary failures / non-`STOP`   |              0 |            0 |         — |

Per turn: turn 0 has the same 9,663-token prompt in both arms because no summary exists yet. From turn 1, main prompts fall from about 9.9–10.1k to about 3.4–3.5k tokens (−65%). Turn 0 completes in 9.5 s instead of 15.5 s, and turn 4 in 6.3 s instead of 9.7 s, because summaries are generated before the run completes and are now smaller. The second summary is incremental: about 640 prompt tokens against about 8,070 for the legacy full transcript.

## Interpretation and limits

- **Retained:** fewer prompt tokens per request after a summary exists, a cheaper and faster summary call, and equal recall of planted facts, including the all-decisions list. Savings scale with the history the summary replaces; this fixture's history is short (about 6k tokens). Threads with long research answers would save more per request, threads under eight messages save nothing.
- **Cost accounting includes the summary call.** Both arms made the same two summary calls; the current arm's are about half the size. Implicit cache hits were equal and small in this fixture (3,937 tokens per conversation), so the reduction is in uncached input.
- **Quality risk:** a summary replaces exact wording. Mitigations are the four-message verbatim tail, the exempt trigger and current-run messages, and strict rejection of incomplete summaries. Planted-fact recall was complete, but the fixture cannot show every nuance that may be lost; watch real exports in the combined evaluation (coo:1127.2an0).
- **Context budget:** never triggered live (the model limit is about 1M tokens and the 1 MiB gathered-bytes allowance binds first). Its behaviour is verified by conformance tests only.
- **Unchanged:** the latest 100-message page bounds what any request or summary can read. When uncovered messages exceed the page (which takes more than 100 messages without a successful summary), messages older than the page are skipped, exactly as before.
- Synthetic content, one model, three conversations per arm. These are controlled measurements, not production latency or billing claims.

## Verification

New conformance tests in `backend/chat/gemini-runtime.postgres-conformance.test.ts`:

- covered messages are replaced while the trigger and recent turns stay verbatim
- coverage resolves beyond the latest page; the boundary must belong to the thread and never move backwards; an invalidated summary falls back to the full page
- a revoked summary source falls back to authorized messages with withheld markers and no revoked text
- summary generation uses its own bounded instruction over uncovered messages only, and coverage ends at the last message read
- incomplete (`MAX_TOKENS`), invalid, oversized or malformed-ref summaries never fail the run or replace the valid one
- a continued run keeps its summary-covered trigger verbatim while dropping the covered earlier answer
- the token budget with headroom stops gathering and closes without tools (`allowance_exhausted`, private `context.budget`)
- checkpoint recovery in a summarized thread reproduces the compacted prefix with the signed call turn and join verbatim

The chat conformance batteries (runtime, Feature handoff, Knowledgebase writes, core chat and proposals) pass 140/140 on SQLite and disposable Postgres. Existing tests continue to pass: incompatible-checkpoint fresh generation (now including the policy digest), revocation fencing, crash recovery at `requestTools`/`joinTools`, sequential guarded writes, questions, and proposal/Create invariants.

## Reproduce

```sh
GEMINI_API_KEY=... CHAT_LIVE_EVAL_REPEATS=3 \
  node --import tsx backend/chat/long-conversation.live-eval.ts <private-dir>
```
