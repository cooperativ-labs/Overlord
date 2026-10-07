# Final chat optimization validation — 2026-10-07

Mission `coo:1127.2an0`. This report evaluates the selected changes from the [proposal](chat-optimization-proposals-2026-10-07.md), using the [original audit](chat-diagnostics-audit-2026-10-07.md) and [instrumented corpus](chat-performance-baseline-2026-10-07.md). Results are measurements of synthetic fixtures through the production runtime, not a production SLA or a billing statement. Individual percentages are never added together.

The final configuration does **not** establish a chat-wide speed/cost improvement: the six-task research corpus used 31% more prompt tokens and took 30% longer. Primary tasks used 16% fewer prompt tokens at a 24–30% lower conditional modeled cost, while the separate long-conversation experiment used 54% fewer prompt tokens and finished 37% faster. All combined-task fact/citation checks passed. The report preserves the regressions and measurement gaps alongside the gains.

## Method and comparison boundaries

The final research experiment compares the retained v6 prompt/repository description, full authorized declarations and no explicit cache against the checked-out v8 prompt, expandable relevance subsets and hybrid static-prefix caching. Both arms use current persistence, authorization, instrumentation and coalescing. This isolates the combined **provider policy**, not the historical application binary. The v6 control already includes the Knowledgebase permission-description correctness fix; no numeric credit is claimed for that fix. The baseline still has the current expansion declaration in its full catalog.

There are three repetitions per arm and task, alternating arm order. The four primary tasks are repository research, notes versus code, Knowledgebase research and mission status. Broad ambiguous research and cross-family expansion run in a separate process, with the same three-pair design. Each run starts a fresh SQLite fixture and cold cache registry; the current arm charges a full ten-minute TTL for every cache creation. Production can reuse a registry between an owner's runs, but this experiment does not assume that benefit. Fresh source fixtures are synthetic and use no real notes/repositories or upstream writes. Some benchmarks run concurrently on this machine; wall-time variation includes local contention and provider variation. No statistical significance or universal speedup is claimed from three pairs.

`wallMs` spans the awaited runtime execution through completion, including its diagnostic capture and cache-creation completion. It excludes queue admission, fixture setup, HTTP/SSE delivery and browser rendering. First SDK/non-thought/durable text are runtime monotonic offsets. Browser paint uses its own submission clock and is measured separately; the clocks are never subtracted or their medians added. The long-conversation experiment includes summary-generation time and tokens, with 80 seeded messages and six follow-up turns per conversation. It isolates summary policy with current other defaults, without an explicit cache. Guarded writes, Feature handoff, cancellation and recovery use deterministic conformance fixtures instead of spending live model calls on external mutations.

Quality checks require planted facts and citation references resolving to source-deduplicated evidence cards. They do not prove every factual assertion is entailed by its citation. The ambiguous task's single broad fact is a weak quality check, so it is reported separately. The application corpus checks exact scripted behavior, not spontaneous model reasoning.

Only fixed labels and numeric aggregates are published in the [validation metrics](chat-final-validation-2026-10-07.metrics.json) and [combined-policy metrics](chat-final-combined-2026-10-07.metrics.json). Raw answers, arguments and test logs remain in owner-private scratch. The analyzer does not publish arbitrary labels, answers, arguments, source identities or error content.

## Cost model and missing data

[Google's pricing page](https://ai.google.dev/gemini-api/docs/pricing), checked October 7, lists Gemini 3.8 Flash Standard rates through December 31, 2026 of $0.75/M input, $0.075/M cached input, $3.75/M output including thinking, and $0.50/M token-hours of cache storage. The calculation counts cumulative usage once per completed exchange, adds candidates and thoughts once, and adds every cache's full 600-second storage. It shows zero versus full-input-rate creation charges because creation billing was not independently reconciled.

An omitted cache usage bucket remains missing in the observed metrics. The conditional cost model assumes no discount for that omitted bucket; it is **not a measured bill**. A separate all-input-cached floor shows sensitivity to unknown cache discounts. Partial prompt/output/thought coverage, missing cache-creation size, or an attempted request without a completed exchange disqualifies a run from the complete rate model; its latency, quality and token observations still remain in the results. Model cost excludes infrastructure and database charges. Neither viewer virtualization nor HTTP compression saves model tokens.

## Individual optimization evidence

These are separate experiments, with different controls and sample sizes; they are not additive and are not a predicted combined result.

| Change | Evidence and retained decision | Limitation or regression |
| --- | --- | --- |
| Prompt permission correction and shorter static instructions | Keep explicit per-message/live-all-workspaces authorization, untrusted-data, citation, guarded-write and user-only Create rules; v8 measured static instruction is 845 tokens in the cache probe. | This final comparison starts at corrected v6; no isolated dollar saving attributed to permission wording. |
| Research planning and focused ranges | [Five-pair study](chat-research-planning-2026-10-07.md): requests 6.5 → 5.4 and prompt tokens 49,757 → 37,500 per run, planted facts 79/80 in each arm. | Wall time rose 30.49 → 34.28 seconds and output/thought tokens rose. Fewer rounds did not guarantee faster answers. |
| Recoverable relevance subsets | [Two-pair study](chat-tool-subsets-2026-10-07.md): primary-task prompt input −26%; read status/repository schemas −71.6%/−64.9% against full declarations. | Whole six-task corpus input essentially unchanged and wall time +14.6%; full-catalog ambiguity and cache behavior dominate some runs. |
| Hybrid static cache | [Isolated cache study](chat-static-cache-2026-10-07.md): primary effective input rate $0.750 → $0.530–$0.581/M, including storage/creation sensitivity. | Six-task rate ranged −6.4% to +0.6%; cold short status can cost more. Cache-all was rejected because it displaced growing-conversation implicit hits. |
| Summary coverage and bounded incremental generation | Final repeated live summary result below, including both summary calls per conversation. | Exact prior wording is replaced; planted-fact recall is narrower than general quality. Active signed turns and trigger/recent messages remain verbatim. |
| Diagnostic persistence and 500 ms / 800-character coalescing | [Prior plans/timings](chat-diagnostics-persistence-optimization-2026-10-07.md); final two-adapter matrix below retains every chunk and all final text. | First text still immediate; intermediate publication is chunk-driven, not a timer. No causal total-latency improvement claimed from local noisy samples. |
| Viewer virtualization and hidden polling pause | Final browser comparison below. | Full payload history is still held and parsed. Memory remains proportional to retained content; live append still waits for polling. |
| Durable diagnostic journal | [No-go](chat-diagnostic-batching-2026-10-07.md): no SQLite end-to-end advantage; safe ordering/materialization adds complexity and domain-event work for small projected gains. | No journal, new sequence allocator or batching schema shipped. Hosted RTT scenarios were modeled, not production measurements. |
| Diagnostic HTTP compression | [No-go](chat-diagnostics-compression-2026-10-07.md): synthetic transfer sensitivity did not establish representative authenticated paging CPU/latency gains. | No compression middleware shipped; zero model-token savings. |

## Fresh individual comparisons on the final checkout

The final pass also reran **72 live research tasks**: prompt/planning, relevance subsets and cache, each with three alternating pairs across the same four primary tasks (12 runs/arm). The [ablation metrics](chat-final-ablations-2026-10-07.metrics.json) retain all task-level distributions, token buckets, first-text offsets, signed paired differences and usage coverage. These experiments ran concurrently and are not an orthogonal factorial design; comparison-arm policy is held fixed within each experiment, but provider planning and cross-run implicit warmth are not deterministic.

| Final-checkout ablation | Requests/run, control → changed | Prompt tokens/run | Wall seconds/run | Conditional USD/run, including storage/creation |
| --- | ---: | ---: | ---: | ---: |
| Prompt/planning: v6 → v8, full catalog, cache off | 6.00 → 5.50 | 39,830 → 38,483 | 30.51 → 33.42 | 0.03601 → 0.03824 |
| Subsets: full → relevance, v8, cache off | 5.58 → 5.50 | 39,685 → 32,300 | 33.91 → 33.46 | 0.03865 → 0.03350 |
| Cache: off → hybrid, v8 + relevance | 6.08 → 5.92 | 36,637 → 36,386 | 34.57 → 35.65 | 0.03711 → 0.02829–0.03012 |

All 72 runs completed and every answer's citation references resolved. Automated facts were 47/48 → 48/48 for planning, 47/48 → 48/48 for subsets, and 48/48 → 48/48 for cache. Manual inspection of the two flagged control answers found all required facts: each expressed the 500-ms base value in inline code followed by the unit, which the regex missed. Those original scores remain unchanged in the metrics, with explicit adjudication notes. This is not evidence of a genuine quality improvement; manual review only resolves those flags, not every assertion in all answers.

The planning-only rerun saved 3.4% input and 8.3% requests, but took 9.5% longer and cost 6.2% more under the rate model. Reported cached tokens fell from 30,321 to an absent bucket; reported output/thought totals rose from 25,096 to 29,998. The larger earlier planning input gain is not a stable magnitude. Subsets saved 18.6% input and 13.3% modeled cost, with wall time essentially unchanged (−1.3%). Hybrid caching left input nearly unchanged (−0.7%), reduced modeled cost 18.8–23.8%, and took 3.1% longer. Cache controls reported no cached field; final cache requests reported 154,195 cached tokens across 59/71 exchanges (58 requests used an explicit cache; reported cache coverage is not an explicit-cache request count). Twelve cold cache creations and full TTL storage are included.

Prompt/output/thought coverage is complete on every completed exchange in all three ablations, with no unmatched attempted requests; all 12 cost pairs per experiment qualify under the stated missing-cache assumption. These results reinforce a **cost-versus-latency tradeoff**, not a blanket improvement. Their changes are not added to the directly measured combination below.

## Combined provider-policy result

The final combination improves primary-task input/cost efficiency, **but does not deliver a general speedup**. Across the four primary tasks (12 runs per arm), mean prompt input fell 16.4%, requests fell 10.1%, and the conditional cost model fell 24.2–29.6% including cache storage and creation sensitivity. Runtime wall time rose 13.5%, and mean first durable text arrived about 4.0 seconds later. All 96/96 planted fact checks and 24/24 citation-resolution checks passed across both arms.

| Task (3 runs per arm) | Requests, control → final | Prompt tokens, control → final | Wall seconds, control → final | First durable text seconds, control → final | Modeled USD/run, control → final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Repository research | 7.33 → 7.33 | 48,072 → 37,097 | 36.99 → 40.38 | 32.61 → 36.21 | 0.04503 → 0.02878–0.03066 |
| Notes versus code | 7.33 → 6.67 | 56,823 → 58,769 | 42.29 → 52.92 | 37.22 → 48.59 | 0.05520 → 0.04710–0.04922 |
| Knowledgebase research | 4.00 → 4.00 | 18,370 → 14,630 | 16.58 → 17.78 | 14.92 → 16.14 | 0.01775 → 0.01161–0.01329 |
| Status | 4.33 → 2.67 | 19,203 → 8,668 | 15.50 → 15.36 | 14.39 → 14.15 | 0.01751 → 0.00787–0.00952 |
| **Primary mean** | **5.75 → 5.17** | **35,617 → 29,791** | **27.84 → 31.61** | **24.79 → 28.77** | **0.03387 → 0.02384–0.02567** |

The cost range is a model under the missing-cache assumption described above, not an invoice range. Control reported prompt/output/thought usage on 69/69 completed exchanges and no cache bucket; final reported those buckets on 62/62 and cache usage on 50. Unknown control cache discounts could narrow the modeled gain. Every final run used a cold registry, so storage/creation is charged per run rather than amortized away. Primary mean candidate-output tokens rose 745 → 771 and thought tokens 1,165 → 1,616; reducing prompt input did not reduce model output/thinking work. Mean first SDK chunk was 3.54 → 4.48 seconds, first non-thought text 24.78 → 28.77 seconds, and first durable text 24.79 → 28.77 seconds. The SDK-to-visible-text gap is dominated by research turns in this fixture; it is not a database timing estimate.

Repository wall-time ranges were 36.12–38.51 seconds control and 35.37–43.54 final; notes/code were 38.67–46.60 and 46.49–62.17. Notes/code used slightly more prompt input and took 25.1% longer despite fewer requests. Status varied 12.39–21.12 seconds in the final arm. Per-task SD, min/median/p95/max, signed paired deltas, all token buckets and SDK/non-thought/durable text observations are retained in the combined metrics; with three repetitions per cell p95 is the maximum. Mixed-task mean/SD also reflects differences between tasks and is not within-task jitter.

The broad fallback and expansion probes are reported separately below rather than hidden in the primary mean. Their measured outcomes constrain the rollout recommendation: retain the correctness and input-efficiency changes, but do not advertise a chat-wide latency improvement or promise the earlier proposal's estimates.

### Broad requests change the overall result

| Task (3 runs per arm) | Requests, control → final | Prompt tokens, control → final | Wall seconds, control → final | First durable text seconds, control → final |
| --- | ---: | ---: | ---: | ---: |
| Ambiguous full-catalog research | 7.67 → 13.67 | 92,465 → 203,687 | 48.87 → 85.51 | 41.49 → 77.52 |
| Cross-family expansion | 7.00 → 7.33 | 60,408 → 64,443 | 45.62 → 56.52 | 38.06 → 49.08 |
| **All six tasks** | **6.28 → 6.94** | **49,224 → 64,549** | **34.31 → 44.74** | **29.78 → 40.28** |

Across all 36 runs, the final combination used **31.1% more prompt tokens and 30.4% more wall time**, with 126/126 planted facts and resolving citations in all 36 answers. Ambiguous final requests ranged 6–19 and wall time 47.65–118.99 seconds, versus control 7–9 requests and 44.45–51.87 seconds. Both arms expose a full catalog for ambiguity; the different prompt/cache policy and stochastic planning interact. Three pairs do not isolate which change caused the longer plans. The expansion probe includes its additional discovery, expansion and rereads in the measured totals.

Reported cached tokens across the six tasks were 80,835/886,023 prompt tokens in control versus 534,244/1,161,883 final (9.1% versus 46.0% **reported-token ratios**, not complete billing hit rates). There were 21 cache creations, 82 explicitly cached requests and no cache failures/fallbacks in the final arm. The other reported cache benefit includes implicit hits in longer inline requests. Larger cached totals do not imply less total work.

One final expansion run attempted an extra request without a completed exchange. All 124 completed final exchanges report prompt/output/thought counts, but usage for that failed attempt is unknown. Consequently no exact or complete six-task net-cost reduction is claimed. The cost model covers 18/18 control runs and only 17/18 final runs; their raw means ($0.04362 versus $0.04139–$0.04365) have different denominators and **must not be read as a corpus saving**. For ambiguity alone, all three cost-qualified runs average $0.06895 control versus $0.09517–$0.09783 final. This is a measured regression under the stated rate assumptions. Matching only the 17 pairs with complete prompt/output/thought usage gives control $0.04266 versus final $0.04139–$0.04365 per run: **−3.0% to +2.3%**, including the creation sensitivity. The excluded pair and unknown cache buckets still prevent a whole-corpus billed-cost claim.

The rollout decision is therefore limited: the selected summary and viewer changes have repeatable local benefits; primary research can use less input at a lower modeled price; **a chat-wide speed/cost improvement is not established**. Broad planning loops and cold-cache economics need workload monitoring before a general performance claim. No additional production policy change is justified solely by these three high-variance pairs.

## Final long-conversation measurement

Three conversations per arm; each has six turns and two summary calls. Means (reported sample SD in parentheses) include summary work.

| Metric per conversation | Legacy coverage | Current coverage |
| --- | ---: | ---: |
| Total prompt tokens | 75,890 (68) | 34,925 (192) |
| Main prompt tokens | 60,016 (56) | 27,296 (152) |
| Summary prompt tokens | 15,875 (12) | 7,629 (39) |
| Reported output + thought tokens, including summaries | 2,300 (501) | 1,268 (51) |
| Reported main cached tokens | 1,313 | 3,939 |
| Runtime wall seconds | 47.44 (6.08) | 29.87 (4.81) |
| Summary seconds | 22.62 (3.59) | 10.60 (1.16) |
| Main / summary calls | 6 / 2 | 6 / 2 |
| Planted facts | 39/39 | 39/39 |
| Failed summaries / failed turns | 0 / 0 | 0 / 0 |

Prompt input fell 54.0% and measured runtime wall time 37.0%. Cache reporting differs between these arms, so these percentages are not an uncached-input or billed-cost claim. The current range was 26.56–35.39 seconds, control 41.04–53.13. This repeats the earlier summary-policy result on the final runtime. This fixture does not exercise the near-million-token budget live; conformance tests cover that stop/Continue behavior.

All 24 exchanges per arm reported prompt and candidate-output counts. Thought counts appeared on only 16 control and 7 current exchanges; cached counts appeared on 1 and 3. The table sums reported buckets without inventing the missing counts. The strict complete-cost model therefore returns no whole-conversation dollar value for either arm; exact net cost remains unmeasured for this fixture.

## Application overhead and publication

The original ten-scenario corpus passed all 120 fresh-process scenario/mode executions (one discarded warmup pair plus five alternating measured pairs). Both instrumentation modes retain full raw diagnostics with display disabled. All observations use SQLite; Postgres correctness and the persistence/coalescing matrix are separately exercised below. These times exclude live provider/network/worker queues and cannot be multiplied into a Cloud speedup.

| Scripted scenario | Final instrumented median / p95 ms | First durable text median per attempt ms |
| --- | ---: | ---: |
| Status | 18.4 / 19.6 | 15.4 |
| Repository + Knowledgebase reads | 24.3 / 25.7 | 5.2 |
| Dependent search and range | 31.9 / 32.4 | 24.2 |
| Per-message guarded write | 42.4 / 43.9 | 40.5 |
| All-workspaces guarded write | 31.9 / 32.5 | 29.9 |
| Feature handoff | 69.5 / 74.1 | 37.0 |
| Long conversation | 34.6 / 34.8 | 30.8 |
| Cancellation | 7.6 / 7.8 | absent |
| Checkpoint recovery | 36.6 / 37.9 | 3.4 |
| Uncertain-write recovery | 33.0 / 37.9 | 16.8 |

Recovery/Feature cases contain multiple attempts; per-attempt first text is not complete-run first text. Compared with the initial scripted baseline, several overhead medians are flat or lower, while long-conversation overhead grew from 12.0 to 34.6 ms under the changed summary policy. These are different policy/request shapes on separate runs, not a controlled persistence-only comparison. Full signed on/off differences, token reporting coverage and variance remain in the JSON.

The coalescing matrix runs three repetitions of all nine thresholds on both adapters. Every run retained 40/40 raw SDK chunks and 2,400/2,400 answer characters. Default 500/800 produced four text commits versus seven at 250/400 on both adapters in this rerun. Exact times are retained in the JSON; concurrent local test load makes timing attribution weak. The newly added first and final pending-flush cancellation tests commit cancellation before the text fence and assert no subsequent publication, one provider request, preserved earlier text and gap-free diagnostics for every consumed chunk.

## Browser results

Fresh headless Chrome 154, production React bundle, synthetic ordered pages; three alternating runs per size and arm. Control is viewer revision `0ac2a10e220893e736441ba39409202a7e365b39`.

| Rows | Drain median ms, old → current | Heap MiB, old → current | Rendered rows, old → current | Parse median ms, old → current |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 98.0 → 63.6 | 9.36 → 7.40 | 1,005 → 22 | 3.2 → 2.9 |
| 5,000 | 500.3 → 296.5 | 45.06 → 34.80 | 5,005 → 23 | 10.2 → 10.3 |
| 10,000 | 1,674.8 → 603.7 | 89.78 → 69.06 | 10,005 → 22 | 21.8 → 25.8 |

At 10,000 rows, backlog drain fell 64.0% and retained heap 23.1%; JSON parsing did not improve. Hidden polling fell from three requests per three seconds to zero. Complete escaped payload expansion and scrolling remain available. Live append-to-frame median was 893 → 910 ms at 10,000 rows; this polling-dominated measure did not improve. Browser changes are not token/cost savings.

The independent first-text probe (30 samples, two warmups, synthetic 10 ms delivery) measured submission-to-paint-opportunity median 33.4 ms, p95 38.2, max 39.3; DOM-to-opportunity median 19.4, p95 24.0. The initial baseline was 33.1/38.2 ms submission median/p95. No live server-to-browser first-text comparison was captured; these browser numbers must not be added to live SDK or durable-text offsets.

## Implementation and contract inventory

| Component | Final selected behavior and compatibility |
| --- | --- |
| Backend chat | Versioned prompt v8 and context/relevance digest, four-read bounded scheduling, expandable stable families, private schema-2 signed manifests, live authorization refresh, hybrid owner-keyed static cache with 600s TTL / 16k threshold / inline NONE and summary requests, 500/800 chunk-driven publication. |
| Core chat | Numeric attempt spans; storage-ordered summary coverage with validated boundary; diagnostics append avoids unused thread DTO read; owner-authorized paging avoids writer lock. Checkpoint/receipt atomicity and live source/fence gates retained. |
| Web / Desktop shared SPA | Tab-local paint probe, virtual rows, lazy escaped JSON, hidden polling pause, scoped cursor/expansion state. |
| Database, both adapters | Existing tables/columns/indexes and diagnostic thread-lifetime cascade; no optimization migration. Schema docs describe internal coverage/manifest semantics. Initial v159 diagnostic table migration remains prerequisite for installations predating diagnostics. |
| REST / public DTOs / Mobile | Existing owner-private diagnostics paging and ordinary snapshot/SSE shapes unchanged by optimizations. |
| Auth / Protocol / CLI / MCP / Connector / Runner / Automations / extensions | No optimization interface change; authorization, execution, audit and user-only draft Create remain existing paths. |

Contract remains **159**. Earlier objectives clarified CONTRACT.md, `contract/components.yaml` and database schema documentation before their internal policy changes. This final objective adds only evaluation/report tooling and cancellation regression coverage; no new interface, schema or contract amendment is needed. Old schema-1/digest-incompatible checkpoints use fresh generation with authorized completed observations; compatible schema-2 checkpoints preserve signed parts and receipt idempotency. Cache handles are not checkpoint authority. No journal, timer queue or transport compression was introduced.

## Verification and rollout gates

- Targeted final safety battery: 222/222 tests, SQLite and disposable Postgres, no skips, including all coalescing thresholds. Four additional first/final-flush cancellation tests passed on both adapters.
- Required `yarn test:conformance`: 361 passing, zero failures, two deliberately gated coalescing tests skipped. Those two adapter matrices passed in the separate enabled battery above; no adapter was skipped.
- Browser viewer/paint unit tests: 9/9. Browser replay/state/Knowledgebase client tests: 17/17. Backend HTTP/engine/limit tests: 14/14, including owner gates, no-store, SSE live/replay, Local refusal and diagnostic cascades. The existing private-export analyzer test and three new combined-cost/isolation tests passed.
- Safety coverage includes crashes after request checkpoint and receipt/join commit, out-of-order read completion and call-order join, four-read bound, stale fences, revocation during generation/summary, removed grant before resumed write dispatch, uncertain writes without resend, historical manifest integrity, cache expiry/fallback/cancellation/owner isolation, user-only Create and idempotency, diagnostics ordering with display disabled, snapshot handoff/replay and thread deletion cascades.
- Core and Web typechecks pass. The initial activity-feed DTO errors disappeared after the conformance build refreshed package declarations. The final Backend typecheck retains only existing errors at `backend/execution/runner-claim-http.test.ts:39–40`: incomplete Express response fixtures. Those fixtures are not changed in this objective and prevent claiming a clean whole-workspace typecheck.
- Workspace-scoping and conformance-version checks pass. The latter explicitly reports 12 older manifests (mostly v153, Desktop v35, MCP v155); it is not a blanket declaration that all components were revalidated at v159.
- All 12 manifests pass individual `ovld contract check` validation. Changed evaluation/test code passes ESLint, and whitespace checks pass.

Before rollout, resolve the remaining Backend fixture type errors and rerun `yarn typecheck:backend`. On an authorized staging owner, run status, cross-family research and a summarized continuation, then drain private diagnostics through the terminal run/page and collect the foreground browser marker before changing scope. Verify prompt/usage reporting coverage, exact effective cached declarations, cache requests/fallbacks, first durable text and terminal wall timestamps. Test grant removal and an intentionally interrupted guarded write only in a scratch workspace. Confirm warm/cold and restarted cache behavior and reconcile actual cache charges with billing. Disable `CHAT_GEMINI_STATIC_CACHE=off` if the real workload's net cost worsens; the cold short-run and high implicit-cache cases need particular attention. Keep complete capture enabled regardless of display and verify no-store, no sequence gaps and full final text after reconnect. No deployment was performed by this objective.

## Reproduction

Use Node 24.13.0, matching the installed SQLite native module. Live commands need the existing Gemini credential in the environment; the repository's `scripts/with-prod-env.mjs` can load the configured credential without printing it. Use a fresh owner-private output directory for each experiment. These commands send only the harness's synthetic fixtures.

```sh
CHAT_LIVE_EVAL_POLICY=combined CHAT_LIVE_EVAL_REPEATS=3 \
  node --import tsx backend/chat/research-planning.live-eval.ts /private/path/combined
node scripts/analyze-chat-combined.mjs /private/path/combined/runs.jsonl /private/path/combined-metrics.json
CHAT_LIVE_EVAL_REPEATS=3 \
  node --import tsx backend/chat/long-conversation.live-eval.ts /private/path/long
CHAT_EVAL_REPEATS=5 node scripts/evaluate-chat-performance.mjs
node scripts/evaluate-chat-diagnostics-viewer.mjs --sizes 1000,5000,10000 --runs 3 --baseline 0ac2a10e220893e736441ba39409202a7e365b39
node scripts/evaluate-chat-paint.mjs
yarn test:conformance
CHAT_COALESCING_EVAL=1 node scripts/with-test-db.mjs node --import tsx --test \
  backend/chat/gemini-runtime.postgres-conformance.test.ts
node --test scripts/analyze-chat-combined.test.mjs
```

For individual provider-policy ablations the same research harness accepts `CHAT_LIVE_EVAL_POLICY=subsets` (same prompt, full versus relevance catalog), `cache` (same prompt/subsets, cache off versus on), or no policy (retained v6 versus current prompt, full catalog and no explicit cache). Keep tasks, model, repetition count and source fixtures fixed. The older studies remain their original results; the fresh final-checkout ablations are published separately and are not pooled with them. Cold and warm registries are different experiments (`CHAT_LIVE_EVAL_CACHE_SHARED=1` for warm reuse) and their creation/storage counts must be accounted for separately.
