# Chat diagnostics latency and cost audit

Mission **coo:1127**, objective **coo:1127.502m**. Audited 2026-10-07 against CONTRACT.md version 159 and the current checkout. This objective documents findings; runtime optimizations and impact estimates belong to coo:1127.6xq3.

The largest measured speed driver is repeated serial provider generation, followed by substantial persistence/source-check work between generations and while streaming. The largest token driver is retransmitting cumulative tool exchanges. Diagnostics make that repetition visible but also persist every repeated request. There is no explicit context-cache integration; **provider-reported cache hits already exist** and must be included in any savings baseline.

## Dataset and measurement limits

Read the authenticated owner REST API at `https://backend.ovld.ai`: list threads, then exhaust `GET /api/chat/threads/:id/diagnostics?after=<seq>` with `nextCursor` until `hasMore=false`. Seven pages returned 538 rows across all three threads in the returned unarchived listing. No sequence gaps appeared within these histories. This is an owner sample, not a deployment-wide table count, physical storage measurement, or load test. Archived threads were not included. Capture begins at upgrade; thread creation dates precede observed history.

| Thread alias / id | Captured UTC interval | Rows | Sum of compact JSON payload bytes |
| --- | --- | ---: | ---: |
| A: `25eaf8d8-8598-4f3e-9632-31139cf43757` | 07:00:27.946–07:08:52.233 | 377 | 4,050,332 |
| B: `93c38614-4595-48d1-912a-6a64e5867112` | 06:55:24.778–07:00:27.917 | 156 | 733,705 |
| C: `1c91b21c-66b7-4dba-a3d5-96ed12b3bfd9` | 06:55:03.144–06:55:25.272 | 5 | 4,157 |

Sizes are UTF-8 bytes of JSON reserialized from API payloads, excluding DTO envelopes. They are neither actual SDK wire bytes nor Postgres relation/TOAST/index/WAL sizes. Timestamps are server observation times, taken during transactions before commit; differences include application work, lock wait, source checks, transport and scheduling. They do not measure isolated SQL execution or provider network TTFT. Provider usage is taken from the **last usage-bearing chunk of each exchange**, never summed across chunks. Quantiles use nearest rank; two runs cannot establish population percentiles.

The companion `chat-diagnostics-audit-2026-10-07.metrics.json` contains per-exchange sizes, usage and tool timing aggregates without raw conversation, tool arguments or tool output. Raw diagnostics were kept only in mission-private scratch, not copied into this report or general logs. The owner diagnostic endpoint remains the authoritative raw history.

## Entries, volume and storage amplification

| Kind | A rows / payload bytes | B rows / payload bytes | C rows / payload bytes |
| --- | ---: | ---: | ---: |
| `provider.request` | 28 / 3,257,369 | 8 / 473,768 | 0 |
| `provider.chunk` | 91 / 130,475 | 46 / 59,474 | 0 |
| `provider.response` | 0 | 0 | 0 |
| `tool.response` | 26 / 163,946 | 7 / 42,969 | 0 |
| `http.exchange` | 50 / 44,177 | 33 / 11,788 | 5 / 4,157 |
| `tool.updated` | 81 / 355,178 | 21 / 86,698 | 0 |
| `message.delta` | 35 / 58,633 | 18 / 30,368 | 0 |

Other rows include `provider.completed` and `provider.stream_closed` (one each per stream), thread/message/run transitions and proposal transitions. `provider.response` is a **nonstreaming generate** response, used here by summarization code; streams produce chunks and completion markers instead. Its absence in these two runs is expected, not proof that capture failed. Neither run triggered a summary generate request. Provider errors and retries were not observed.

`provider.request` holds `{exchangeId, method, request}` including model, contents, static instructions and all tool schemas. Chunks hold `{exchangeId, chunk}` with raw candidates, response identifiers, SDK response metadata and usage. `tool.response` holds operation id, tool id and raw gateway output. `tool.updated` carries private raw tool, run and attempt rows plus the curated event and event sequence. `http.exchange` holds method/path, query/body and response status/body or error. It can duplicate complete thread snapshots. Diagnostics polling is explicitly excluded; it does not recursively log itself.

In A, request bodies account for **80.4%** of all diagnostic payload bytes; streaming chunks account for only 3.2%. Large repeated request snapshots dominate byte growth in this sample. Largest request diagnostic payload: 217,286 bytes. Tool output also appears in receipt transition rows and later provider requests. Each tool normally has three transitions (requested/executing/completed); A's 27 calls yield 81 transition rows. There are only 26 `tool.response` rows because `prepare_proposal` bypasses the general gateway response recorder; its receipt and proposal events are still observed. Questions and argument-validation failures similarly need not produce a gateway response row.

`database/{postgres,sqlite}/migrations/20261007070000_chat_diagnostics.sql` gives the table `(thread_id, seq)` primary key and `(run_id, seq)` index, unrestricted JSON payload, thread cascade and nullable run/attempt ids. Postgres uses JSONB; SQLite uses text JSON. `appendDiagnostic` allocates `MAX(seq)+1` under the thread lock. Existing indexes support sequence lookup; an actual query plan was not collected, so this audit does not claim a full table scan. Standalone capture uses one transaction per observation: `ChatStore.diagnostic` locks through `UPDATE chat_threads SET id=id`, reads the thread, serializes and inserts, then commits. Curated event capture occurs inside the existing domain transaction and additionally reads run, attempts and tool state. Diagnostics reads also acquire the thread lock and can contend with streaming writes.

## Request payloads and tokens

Both runs use `gemini-3.8-flash` and the same **24 declarations** on every request. The observed prompt is 4,664 UTF-8 bytes and tools are 23,632 JSON bytes: tool schemas are about five times the prompt size. Largest individual declarations: Knowledgebase query 2,770 bytes, prepare_proposal 2,377, repository_read 1,703 and Feature mission lookup 1,604. Sixteen Knowledgebase declarations were offered; neither run invoked a Knowledgebase tool. This is authorization filtering, but not relevance filtering. Gateway declarations are resolved once at session startup; live call-time authorization still applies.

| Measurement | A: research/proposal run | B: status run |
| --- | ---: | ---: |
| Stream exchanges / tool calls | 28 / 27 | 8 / 7 |
| First → last request bytes | 28,693 → 217,204 | 28,559 → 74,528 |
| First → last contents bytes | 229 → 188,740 | 95 → 46,064 |
| First → last content turns | 1 → 55 | 1 → 15 |
| First → last prompt tokens | 7,925 → 63,593 | 7,903 → 24,100 |
| Summed prompt tokens | 978,429 | 153,668 |
| Summed cached prompt tokens | 699,210 (71.5%) | 89,373 (58.2%) |
| Prompt tokens not reported cached | 279,219 | 64,295 |
| Candidate / thought tokens | 4,806 / 5,907 | 1,056 / 3,178 |
| Total tokens | 989,142 | 157,902 |

Combined: 1,132,097 prompt tokens, 788,583 cached tokens, 343,514 not reported cached, 5,862 candidate tokens and 9,085 thought tokens. Reported totals reconcile exactly to prompt + candidate + thoughts. The initial tiny-user-input requests already cost roughly 7.9k prompt tokens; this is evidence of the combined prompt/schema baseline, not a tokenizer breakdown assigning exact tokens to individual fields.

A retransmits 130,592 prompt bytes and 661,696 schema bytes over 28 exchanges. Its cumulative function responses appear **378 times** across requests (1+…+27), although only 27 calls execute. B repeats seven responses 28 times. Within-run turns, signed function parts, untrusted content wrappers, evidence arrays and prior outputs are copied in full on each request. Request growth is therefore cumulative and token work across a run grows approximately quadratically with serial tool turns of similar size. Merging adjacent roles reduces structural overhead, not substantive text.

`ChatRuns.input` fetches the latest 100 messages and the latest usable summary. `GeminiRunSession.contents` appends the summary **and all those messages**; `summaryCoversMessageId` is used for summary cadence, not prefix trimming. Thus summaries currently add context instead of substituting for covered messages. `maybeSummarize` makes an additional provider call before run completion when eight uncovered messages accrue, resends the full system instruction and up to 128×1024 JavaScript characters of transcript, and does not set `maxOutputTokens`. These costs are code-derived; no summary request exists in this dataset. Message limits and the 1 MiB gathered-content allowance are not token budgets; context-limit errors remain possible. JavaScript-character truncation is not a UTF-8 byte or token limit.

No cache creation, cache handle, expiry management or `cachedContent` request field exists in `gemini-runtime.ts` / `gemini-client.ts`. However 21/28 A exchanges and 5/8 B exchanges report `cachedContentTokenCount`. With no explicit cache reference, these are consistent with automatic implicit caching. Google's [context caching documentation](https://ai.google.dev/gemini-api/docs/caching) confirms default implicit caching for newer models and a 4,096-token minimum for Gemini 3.8 Flash. Do not describe the current system as uncached, or estimate explicit-cache savings against all 1.13M prompt tokens at the uncached rate.

Dollar cost is not reconstructable from these logs alone: no invoice, effective rate or billing ledger was collected. Using prices per million tokens, the combined input baseline is `0.343514 × uncached_input_rate + 0.788583 × cached_input_rate`; output buckets total `0.014947 × applicable_output_rate` if candidates and thoughts share that rate. Confirm actual billing treatment before applying prices. Any explicit-cache storage charge would be additional. Transport compression alone does not reduce model token counts.

## Latency breakdown

| Observed interval (milliseconds) | A | B |
| --- | ---: | ---: |
| Running → completed | 269,024 | 74,686 |
| Request → first chunk, median / p95 / max | 3,440 / 26,108 / 33,546 | 4,238 / 17,080 / 17,080 |
| Request → completed, summed across exchanges | 204,256 | 62,895 |
| Requested → executing, median / max; sum | 238 / 931; 8,300 | 296 / 354; 1,729 |
| Executing → completed, median / max; sum | 797 / 1,477; 21,599 | 330 / 508; 2,430 |
| Last tool completion → next request, median / max; sum | 874 / 1,962; 24,019 | 790 / 1,033; 5,431 |
| First request → first non-thought provider text | 231,151 | 67,443 |
| Final request → first non-thought text | 5,227 | 11,924 |
| Final streaming exchange duration | 42,333 | 18,453 |

All 34 observed tool-call turns contain **one call**. The runtime supports up to four concurrent reads, but these runs never use that capacity. A performs 21 repository reads, two mission reads and other discovery/proposal calls; B performs five mission searches and two discovery/detail calls. Sequential provider decisions, rather than slow individual tool service, dominate these wall times. Provider observation intervals occupy roughly 76% of A and 84% of B, but include synchronous capture and text persistence; they are not pure model compute measurements. A has long first-chunk outliers at diagnostic request sequences 143 (26.108 s), 243 (15.987 s) and 279 (33.546 s), without recorded retry errors.

TTFT has two meanings here: first SDK chunk can contain a function call or usage only; first user-visible text is much later, after research. Neither diagnostic timestamp measures first network byte, token production or actual browser paint. First text in A appears at sequence 290 (07:06:07.825); its first text `message.created` is sequence 291, 915 ms later. In B the equivalent gap is 325 ms. Text-bearing chunks followed by a message event before the next chunk have median gaps of **841 ms** (36 samples) in A and **256 ms** (18 samples) in B. These support a persistence/source-check contribution but cannot assign it specifically to SQL.

Function-call dispatch waits for the whole streamed turn, then `requestTools` atomically saves the signed turn/checkpoint and receipts before execution. `resolvePending` runs reads through a bounded pool, then writes sequentially in call order, then a question. Execution timings include gateway work, raw output capture, source/evidence checks and durable receipt writes. Completion-to-next-request timings include receipt/input reconstruction, dependency checks, ordered join/checkpoint persistence and another authorized `providerInput` gate. This join proxy is useful but not an isolated join benchmark. No writes or waiting-user pauses occur in these runs.

Streaming uses 250 ms / 400-character defaults. It is **arrival-driven**, not a timer: the threshold is checked only while processing non-thought text, and final stream completion flushes leftovers. `lastFlush` starts at zero, so the first text flushes immediately. `flushStreaming` awaits dependency gathering and `runs.text`; per-event observation reads, inserts, retention and source authorization add work. The provider wrapper first awaits a standalone diagnostic transaction for **every chunk**, then yields it. Thus event coalescing never coalesces raw chunk diagnostics, and both paths can apply backpressure. A has 91 chunk writes but 35 text deltas; B has 46 chunk writes and 18 deltas. A's final stream has 37 chunks and 35 deltas: relatively slow writes can themselves make nearly every arriving text chunk cross the 250 ms threshold.

No transaction duration, query duration, lock-wait time, pre-serialization timestamp, raw arrival timestamp or browser-render timing is recorded. A controlled baseline with equivalent capture and explicit timing spans is needed to quantify database overhead. Default retries add 400 ms then 1,500 ms plus repeated request cost on transient open failures; midstream failures are not retried. This is an unobserved code path in the sample.

## Frontend and contract comparison

`ChatDiagnostics.tsx` loads up to 100 entries per page, immediately drains backlog, then polls every second. It appends all entries in memory, renders one details element per entry, and only pretty-prints JSON when expanded. Memoization helps existing rows; there is no virtualization or resident-history bound. Capture continues with the browser-local setting off. The viewer adds parsing, memory, repeated array copies and owner-thread lock contention, but does not feed content to the model. Actual browser memory/paint time was not measured.

The observed pipeline aligns with v159's complete SDK capture, unrestricted payloads, append-only owner history, chronological paging and exclusion from normal SSE/snapshots/provider history. Do not apply normal chat-event 7-day/5,000-row retention to diagnostics: v159 requires thread-lifetime history. Sampling chunks, truncating tool payloads, suppressing capture when display is off, or deleting old observations would change that guarantee and require a contract change, with Database/Core/REST/Web and optional Mobile impacts. Full-fidelity ordered batching would need explicit durability and crash-recovery analysis before claiming conformance.

The current checkpoint/receipt barriers and providerInput authorization gate follow the runtime requirements at CONTRACT.md's “Checkpoints and recovery” and Gemini runtime sections. Removing the barriers for speed risks repeated writes, stale access or mismatched function responses. Reads can use existing four-way concurrency; Knowledgebase writes remain ordered and retain revision/uncertain-write guards. Prompt changes must preserve untrusted-data treatment, owner authorization, source invalidation and proposal-only Create behavior. Tool subsetting must be assessed against the documented fixed tool surface and must never bypass live gateway policy. Prefix trimming may address redundant summary context, but cannot rewrite this run's signed checkpoint turns or omit still-required creation receipts, questions and evidence dependencies.

The observed deployed system prompt and the current checkout prompt are both 4,664 UTF-8 bytes. The observed prompt describes Knowledgebase writes as request-only while declarations include writes with no per-message grant, consistent with v158's all-workspaces authorization. The current checkout has the same request-only prompt language. This wording lags the current permission model; authorization itself still resides in the gateway. Prompt revision is a candidate for the next objective, not an authorization defect established by this audit.

## Mission evidence mapping and handoff

All nine supplied ids resolve in A's provider function-response evidence arrays, associated with repository head `0ac2a10e` or the listed Overlord entity. They are source evidence ids, not diagnostic exchange ids:

| Evidence id | Provider ref / source |
| --- | --- |
| `1d541a7e-cce6-4ce1-a073-7d80883b45bd` | E5, Project Overlord |
| `fae4f427-d54f-4ebe-9e41-93f8b1828063` | E18, CONTRACT.md |
| `dc37af4a-91b3-4390-b6ff-6d2f0e27fed2` | E22, ChatDiagnostics.tsx |
| `d010611d-b385-44d7-9513-886425111c3b` | E29, gemini-runtime.ts |
| `4ffd43c7-cd85-44e1-9668-eb390d0de03f` | E30, gemini-runtime.ts |
| `ce1db32c-b395-4399-bc82-2d581e40bfdf` | E33, gemini-runtime.ts |
| `73736ed7-c916-4f08-8825-b2031291d128` | E34, gemini-runtime.ts |
| `c4893f8f-3d5d-4bc7-abc3-f4db20ee98d4` | E36, diagnostics.ts |
| `c8f51949-e2b8-4d61-bb9e-98a2891bdc94` | E50, mission coo:1125 |

The next objective can prioritize eliminating unnecessary serial generations and repeated context, then evaluate explicit caching against the **already cached** baseline, then persistence/coalescing changes with lossless diagnostic guarantees. Use this sample as a concrete baseline; do not infer a promised speedup, marginal cache savings or database share without measurements. No runtime, schema or contract changes were made in this objective.
