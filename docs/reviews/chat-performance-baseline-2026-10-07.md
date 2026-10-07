# Chat performance instrumentation and evaluation baseline — 2026-10-07

Mission `coo:1127.w09e`. This establishes measurement boundaries and a reproducible application baseline for the later optimization objectives. It changes no prompt, tool policy, caching, history selection, coalescing threshold or persistence strategy.

The prior live sample remains [the audit](chat-diagnostics-audit-2026-10-07.md) and its [metrics](chat-diagnostics-audit-2026-10-07.metrics.json); the optimization hypotheses remain [the proposal](chat-optimization-proposals-2026-10-07.md). Two complete live runs took 269,024 and 74,686 ms. Their request-to-first-chunk medians were 3,440 and 4,238 ms; the first non-thought text arrived 231,151 and 67,443 ms after the first request. Those diagnostic observation intervals include capture and publication work. They do not isolate SDK arrival, SQL, network/model computation or browser paint and are not repeated controlled trials.

The new measurements below are **scripted provider / fake upstream experiments**, with real services, authorization, transactions, checkpoints, receipts and diagnostic writes. They measure local application overhead and verify instrumentation. They do not measure live Gemini latency, model answer quality, effective billing or production Knowledgebase/repository network time. The headless browser sample measures the paint probe with synthetic DOM content. No new production messages, source exports, notes or missions were created by these experiments.

## Measurement boundaries

| Observation                           | Definition and limit                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First SDK chunk                       | Monotonic offset at consumption from the SDK iterator, before awaiting its raw diagnostic write. Includes iterator/backpressure effects; not first network byte or first token produced.                                                                                                   |
| First non-thought text                | First nonempty text part of the primary candidate that is not a thought, observed before diagnostic capture. A function call, usage-only chunk or thought is not visible text.                                                                                                             |
| First durable text                    | Offset after the awaited `runs.text` returns, including its source/fence checks and transaction completion. The worker runs outside an enclosing transaction.                                                                                                                              |
| Diagnostic transaction                | Awaited standalone diagnostic transaction return, including admission, lock, serialization, insert and completion. The final performance report itself is outside the measurement scope.                                                                                                   |
| Diagnostic admission                  | Time from invocation until the transaction callback begins. Includes SQLite mutex/pool/admission and BEGIN round trips; not a pure lock-wait measurement.                                                                                                                                  |
| Thread lock                           | Awaited no-op thread UPDATE acquisition/statement duration. Includes adapter/SQL round-trip work. In SQLite the enclosing transaction mutex wait appears in admission, not this UPDATE.                                                                                                    |
| Serialization / insert                | Separate spans around the existing lossless serializer and awaited diagnostic INSERT, including domain-event observations. Neither the INSERT nor a nested transaction return alone proves outer commit.                                                                                   |
| Source authorization / checker        | Full `checkSources` invocation versus adapter-check/timeout wait alone. Membership, source lookup, invalidation and SQL remain in the full span.                                                                                                                                           |
| Tool dispatch / receipt               | `executeTool` call through completion, including guards, invocation, source/evidence checks and durable receipt. Independent read spans can overlap.                                                                                                                                       |
| Tool join                             | Dependency lookup through ordered `joinTools` / checkpoint completion. Does not speculate or change call ordering.                                                                                                                                                                         |
| Complete run                          | Terminal durable `chat_runs.completed_at - created_at`, available in existing raw run-transition observations. Includes queue/recovery/user pauses; do not substitute summed attempt durations. Failed-worker terminal transitions may occur after `performance.attempt`.                  |
| Browser DOM / first paint opportunity | Submission-to-React text commit and a subsequent foreground double-rAF opportunity. Tab-local `overlord.chat.firstTextPaint` User Timing marks; no telemetry request. It cannot guarantee pixels reached a display or prove the text was in the viewport. Hidden tabs wait for visibility. |

All attempt spans use `performance.now()`. Wall timestamps correlate attempts to durable run timestamps; browser offsets use the browser submission clock. Never subtract server and browser clocks. Spans nest and concurrent reads overlap: adding categories does not reconstruct total wall time.

`performance.attempt` contains bounded numeric aggregates, attempt state/recovery mode, first offsets, schema/request byte sizes, opened streaming rounds, request attempts, normally completed streaming rounds, separate summary calls, and available prompt/cached/candidate/thought usage. Streaming usage is counted once from the last report in each exchange; missing buckets remain absent and per-bucket reporting counts distinguish partial coverage. Raw SDK requests, every chunk, errors and raw transitions remain complete and awaited. Instrumentation is independent of the diagnostic display toggle and emits no global log, search, webhook or ordinary chat-event payload.

System bytes count UTF-8 instruction text. Tool bytes count JSON of the SDK `config.tools` envelope, including declarations. Request bytes count the captured request representation, not transport bytes. Bytes are not tokens; separate model tokenization belongs to the next prompt objective. Summary exchanges participate in request-size and reported-token totals.

## Repeated application corpus

`node scripts/evaluate-chat-performance.mjs` runs ten scenarios, one discarded warm-up pair followed by five on/off pairs per scenario. Each sample uses a fresh isolated database and process. Mode order alternates. Both modes retain the same raw diagnostics; off disables measurement metadata and the final performance row, while inactive measurement hooks remain. Thus the delta measures active instrumentation overhead, not a pristine historical binary comparison. Fresh-process warmups warm filesystem/system caches, not the next process's JavaScript JIT.

Each pair retains private per-attempt observations and test output in a newly created mode-0700 directory; files are mode 0600. Only content-free aggregates are copied into this report's companion JSON. Synthetic databases are disposed. Launch scratch is removed by mission delivery; production raw observations continue their authorized thread-lifetime retention. No owner content was copied into this report.

The corpus checks status/citations and thought-versus-text boundaries; independent repository and Knowledgebase reads with ordered joins; dependent repository search and a focused file range; Knowledgebase reads/writes under per-message grants; live all-workspaces writes and grant removal; canonical Feature handoff with user-only draft Create and repeated-link guard; a 108-message conversation with a latest-100-message page and summary call; cancellation; checkpoint recovery; and uncertain-write recovery with no resend. These are exact scripted functional assertions, not an evaluation of spontaneous model decisions.

| Scenario                    | On median / p95 ms | Off median ms | Paired added mean ± SD ms | Runtime attempts per repetition |
| --------------------------- | -----------------: | ------------: | ------------------------: | ------------------------------: |
| status                      |    16.860 / 38.182 |        15.255 |          -18.031 ± 38.218 |                               1 |
| repository-and-kb-read      |    26.031 / 31.913 |        25.655 |             0.763 ± 4.026 |                               1 |
| repository-search-and-range |    31.325 / 40.135 |        30.674 |             1.100 ± 2.172 |                               1 |
| kb-per-message-write        |    46.590 / 58.279 |        42.974 |             4.895 ± 2.338 |                               1 |
| kb-all-workspaces-write     |    37.531 / 46.543 |        43.361 |            -4.577 ± 7.686 |                               1 |
| feature-handoff             |    77.467 / 86.904 |        74.741 |           -2.098 ± 13.542 |                               2 |
| long-conversation           |    12.033 / 51.567 |        10.526 |            1.095 ± 30.131 |                               1 |
| cancellation                |      7.025 / 7.366 |         7.597 |            -0.238 ± 0.663 |                               1 |
| checkpoint-recovery         |    33.024 / 38.577 |        31.511 |             2.300 ± 1.827 |                               3 |
| uncertain-write-recovery    |    31.560 / 37.595 |        33.127 |            -0.819 ± 3.442 |                               2 |

Execution time sums measured runtime invocations within one scenario, including the final instrumentation report when enabled. Database/bootstrap setup, worker claim, simulated downtime, HTTP/SSE and browser delivery are excluded. Recovery and Feature scenarios intentionally have multiple attempts. The signed paired delta is on minus off for matching repetition numbers. Negative deltas indicate variability, not an optimization. With five repetitions, nearest-rank p95 equals the maximum; the JSON also includes min, mean, population standard deviation and sample counts. Do not treat the local in-memory SQLite times as Cloud/Postgres durability estimates.

| Per-attempt median (ms)           | Status | Repository search/range | All-workspaces writes | Long conversation |
| --------------------------------- | -----: | ----------------------: | --------------------: | ----------------: |
| First SDK chunk                   |  2.497 |                   3.061 |                 4.696 |             6.016 |
| First non-thought text            | 12.486 |                  23.470 |                32.218 |             6.025 |
| First durable text                | 14.039 |                  26.088 |                34.640 |             7.449 |
| diagnostic.transaction total      |  2.072 |                   2.267 |                 2.934 |             2.558 |
| diagnostic.admission total        |  0.199 |                   0.201 |                 0.242 |             0.134 |
| diagnostic.serialization total    |  0.399 |                   0.597 |                 0.923 |             0.580 |
| diagnostic.insert total           |  0.637 |                   0.943 |                 1.255 |             1.206 |
| thread.lock total                 |  2.107 |                   3.299 |                 3.494 |             1.505 |
| source.authorization total        |  2.477 |                   5.994 |                 6.241 |             0.443 |
| source.checker total              |  1.048 |                   2.679 |                 2.922 |                 — |
| tool.dispatch_receipt total       |  3.516 |                   7.670 |                15.014 |                 — |
| tool.join total                   |  1.026 |                   2.337 |                 1.321 |                 — |
| text.commit total                 |  0.948 |                   0.959 |                 1.225 |             1.013 |
| Maximum tool-envelope UTF-8 bytes |   8744 |                    6882 |                 21832 |              8744 |

The [application aggregate JSON](chat-performance-baseline-2026-10-07.metrics.json) retains all measured first offsets, request/schema sizes, provider/summary rounds, token coverage and span distributions. Fixture usage is synthetic: status deliberately repeats cumulative reports and must total 200 prompt, 80 cached, 20 candidate and 6 thought tokens over two exchanges. Other scripted exchanges generally omit token buckets; a summary supplies only totalTokenCount, which cannot be assigned to input/output/thought buckets. Missing counts are not zero. Live effective cost remains unmeasured; use actual rates/billing only after obtaining complete usage coverage.

## Browser experiment

`node scripts/evaluate-chat-paint.mjs` launches a fresh headless Chrome profile, bundles the production paint helper, waits a controlled 10 ms before a synthetic text DOM mutation, and observes the same double-rAF probe. Two warmups are discarded; thirty observations are retained privately. This tests the probe/compositor scheduling, not the whole React chat journey or a production device. It does not compare provider tokens or chat network cost.

| Browser interval               | Median ms | p95 ms | Maximum ms |    Mean ± SD ms |
| ------------------------------ | --------: | -----: | ---------: | --------------: |
| Submission → DOM commit        |    13.400 | 15.200 |     15.400 |  13.017 ± 1.513 |
| Submission → paint opportunity |    33.100 | 38.200 |    497.100 | 48.730 ± 83.292 |
| DOM commit → paint opportunity |    20.400 | 26.800 |    485.000 | 35.713 ± 83.471 |

The [browser aggregate JSON](chat-performance-baseline-2026-10-07.paint.metrics.json) preserves the outlier and variability. The large maximum is an observed scheduler delay; no measured evidence assigns it to application work. The rAF probe has measurement delay by construction. Scope switching clears its bounded tab-local marks and identifiers; no content is stored. Unit tests cover first-only recording, hidden/resumed tabs, unmount, mismatched runs and account changes. Browser observations work with the diagnostics panel off.

## Reproduction and use with live authorized exports

Use a Node executable compatible with the installed SQLite native module. This run used Node 24.13.0 on Darwin arm64; the machine's default Node 26 could not load the existing Node-24 SQLite binary. Commands below assume `node` resolves to the compatible runtime:

```sh
CHAT_EVAL_REPEATS=5 node scripts/evaluate-chat-performance.mjs
node scripts/evaluate-chat-paint.mjs
node scripts/with-test-db.mjs node --import tsx --test --test-concurrency=1 backend/chat/gemini-runtime.postgres-conformance.test.ts backend/chat/knowledgebase-writes.postgres-conformance.test.ts backend/chat/feature-handoff.postgres-conformance.test.ts packages/core/service/chat/chat.postgres-conformance.test.ts packages/core/service/chat/performance.test.ts
```

The application harness honors `TEST_DATABASE_URL` when explicitly supplied; otherwise it runs SQLite. Postgres conformance uses an isolated disposable schema/instance, not production credentials. Set `CHAT_EVAL_CHROME` to the Chrome executable on another OS. Both harnesses print only private result locations; their aggregate files can be compared/published after review.

For live repetitions, hold model/config, task text, starting conversation, authorized source revisions and grant mode fixed. Use separate owner-private threads and compare cold/warm order with at least five repetitions. For writes use an explicitly authorized scratch workspace and guarded revisions; never blindly replay an uncertain result. Record task/citation correctness, draft/Create behavior, cancellation/recovery and live authorization removal as well as latency. Do not interpret the scripted corpus as proof of generated answer quality.

Drain the existing owner-only diagnostics endpoint in ordered pages, including the terminal run transition. Save only in owner-authorized private storage. Save browser mark details locally with `performance.getEntriesByName('overlord.chat.firstTextPaint').map(entry => entry.detail)` before changing account or leaving the tab. The following analyzer accepts a complete array of diagnostic entries (or `{ entries }`) and optional paint details, strips identities/content and counts each exchange's last usage report once:

```sh
node scripts/analyze-chat-performance.mjs /private/path/diagnostics.json /private/path/paint-details.json > /private/path/aggregates.json
```

It rejects missing/duplicate sequence prefixes and an undrained page. Contiguity alone does not prove the tail was fully exported; verify the final page's cursor/hasMore and the terminal run transition. Durable run wall times include all attempts and pauses; per-attempt metrics permit active-time analysis. Browser submission latency is reported separately, never subtracted from a server clock. This analysis path also works with pre-instrumentation exports for raw usage/size/run-duration buckets, leaving new first/span measurements absent.

## Compatibility and verification

Contract v159's open private diagnostic payload vocabulary already permits these observations. CONTRACT.md, the machine-readable component declaration and the schema documentation were clarified before implementation. No stable route, DTO, database column, closed vocabulary, prompt digest or checkpoint format changed; no version bump or migration is needed. Core owns numeric scopes and service timings; Backend retains them via existing private diagnostics; Web and Desktop's shared SPA measure locally. Mobile and other components need no implementation change.

Raw payload equality and gap-free capture are verified with no display enabled, including thoughts, signatures and repeated usage-only chunks. Async measurement scopes are tested under overlapping attempts and failure. Existing tests continue to verify source revocation, stale fences, ordered joins, signed recovery, live grant removal, sequential guarded/uncertain writes, owner access, cascades, snapshot/replay and user-only draft Create.

- Full conformance battery: 97 passing tests across SQLite and disposable Docker Postgres (no skipped adapter battery). After adding the focused repository case, its two-adapter check and SDK/usage/capture check passed all 4 tests; this repeats the 2 existing status assertions and adds 2 repository assertions.
- Final repeated corpus: all 120 scenario/mode executions passed (10 scenarios × 6 warmup/measured pairs × 2 modes); 100 measured scenario/mode executions enter the aggregates.
- Browser/diagnostics client tests: 5 passing; async-scope isolation and export-analyzer tests: 2 passing. Headless Chrome 154 produced 30 measured paint observations.
- Core and Web typechecks pass. Changed TypeScript/TSX files pass ESLint; diff whitespace, workspace scoping and conformance-version checks pass. The version check reports existing older manifests without failure.
- Full Backend typechecking reports only the two existing `backend/execution/runner-claim-http.test.ts` errors at lines 39–40: the response test double's `status()` type does not satisfy the Express `ClaimResponse` return type. That fixture is unchanged by this objective; no instrumentation type errors remain.

The retained result is a baseline/harness, not a claimed speedup or cost saving. The later objectives should rerun matched scenarios and authorized live exports individually and in combination, retaining only measured improvements with equal functional and answer/citation quality.
