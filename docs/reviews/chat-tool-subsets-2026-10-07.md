# Recoverable relevance tool subsets — 2026-10-07

Mission objective: `coo:1127.kaed`. Baselines: [proposals](chat-optimization-proposals-2026-10-07.md), [instrumentation](chat-performance-baseline-2026-10-07.md), [research planning](chat-research-planning-2026-10-07.md) and [summary coverage](chat-summary-coverage-2026-10-07.md).

## Implementation and contract disposition

The runtime declares a deterministic relevance subset of the existing authorized catalog. It does not use a routing model. Initial selection examines the trigger message: status/mission terms, repository/code terms, Knowledgebase/note terms and Feature/handoff terms select stable families; explicit cross-family terms select their union. Unknown or referential language and requests for all sources retain the full catalog. A per-message write grant also selects Knowledgebase. This heuristic can miss implicit intent; expansion and the full fallback are part of the design, not exceptional escape paths.

Every manifest retains project discovery, `ask_user`, proposal preparation and any authorized Knowledgebase workspace discovery. `expand_capabilities` discovers available family/tool names when called without families, or adds `status`, `repository`, `knowledgebase`, `feature` or `all` for the next request. It cannot install tools or change permissions. Feature includes Knowledgebase plus exhaustive Feature-reference lookup and mission detail. Reviewed writes appear only within an appropriate family and a live authorized scope. Relevance never becomes authority.

Expansion uses ordinary bounded tool execution, signed-turn checkpointing, durable receipts and ordered joins. Calls outside the original turn's manifest are refused even when that turn also expands their family. Successful expansion receipts reconstruct the family union after crashes at request checkpoint, receipt completion and join. Reads retain the four-call concurrency bound; writes remain sequential and questions run afterward.

Before implementation, `CONTRACT.md`, `contract/components.yaml` and `database/docs/09-database-schema-contract.md` were amended. The private Gemini checkpoint changes from schema 1 to schema 2 and the prompt from v7 to v8; the config digest includes the relevance policy. A schema-2 checkpoint stores the selected families and the exact declaration schemas/descriptions/effects used for its pending signed turn. SHA-256 identity canonicalizes object keys (Postgres JSONB changes their order) but preserves arrays and declaration order. Restore validates integrity and uses historical schemas/effects for pending calls. New provider requests refresh live declarations. A grant removed after checkpointing refuses the pending write before upstream dispatch. Corrupt manifests fail closed. Old-version/digest-incompatible checkpoints use the existing fresh-generation path and authorized completed observations.

Current-run signed provider parts are never compacted or rewritten. Google documents the need to return complete response parts, including thought signatures, in multi-step tool use: [Generate Content thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures). Live expansion exercises this continuation as well as the scripted recovery tests.

All raw provider requests/chunks and tool responses remain awaited in private diagnostics, including when the display is disabled. A private `tools.manifest` observation records identity/families/names. No global content telemetry, tool-policy widening, source-authorization shortcut or fire-and-forget capture was introduced. Context estimation now includes tool-declaration growth after expansion.

| Component | Impact |
| --- | --- |
| Backend | Family selection/expansion, manifest validation, schema-2 checkpoint payload, prompt/config digest, refreshed live declarations, suppression of write declarations for a lost/empty authorized workspace scope, evaluation harnesses. |
| Core | Existing opaque checkpoint/receipt storage, ordered execution and live gateway/source policy; no production API change. |
| Database (SQLite and Postgres) | Existing JSON and schema-version columns; no migration or column change. Private payload shape documented; JSONB key normalization covered. |
| REST/DTOs, Web, Desktop, Mobile | No surface changes. Ordinary snapshots never expose checkpoints; existing owner-private diagnostic paging works unchanged. |
| Auth, Protocol, CLI, MCP Server, Connector, Runner, Automations, extensions | No interface changes. Outbound Knowledgebase allowlist, rate limits, live scopes and guarded writes remain authoritative. |

Contract remains v159: this refines internal provider policy and opaque private checkpoint contents, without a stable public-interface or closed storage-vocabulary change. No new operator configuration is required. `fullToolCatalog` is an internal evaluation option, included in the config digest.

## Static schema-token measurements

`backend/chat/tool-manifest.live-eval.ts` builds production gateway declarations from all reviewed Knowledgebase tools, a synthetic connection id and read/request/all-workspaces scopes. It invokes live `gemini-3.8-flash` with a fixed `Reply OK.` input, no system instruction and function calling `NONE`. Reported prompt usage minus the identical tool-free control (4 tokens) measures schema overhead. This is provider input usage, not JSON tokenization or an estimated bytes/token ratio. A single probe per manifest suffices for the deterministic input count; it does not measure latency distributions, cache effectiveness or write quality. No upstream Knowledgebase/repository call runs.

| Manifest | Read-only schema tokens | Savings vs read full | Per-message write schema tokens | Savings vs request full | All-workspaces schema tokens | Savings vs all-workspaces full |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Status | 1,349 | 71.6% | 1,349 | 80.1% | 1,349 | 80.1% |
| Repository | 1,666 | 64.9% | 1,666 | 75.5% | 1,666 | 75.4% |
| Knowledgebase | 3,446 | 27.5% | 5,491 | 19.2% | 5,473 | 19.3% |
| Feature | 3,986 | 16.1% | 6,031 | 11.3% | 6,013 | 11.3% |
| Full fallback | 4,751 | 0% | 6,796 | 0% | 6,778 | 0% |

Both full and subset controls include the expansion declaration; these percentages isolate subsetting rather than compare with the retired prompt/catalog. Keeping the large proposal schema available in every manifest limits further savings intentionally. A per-message write grant normally selects Knowledgebase even when status/repository words also appear; the narrow status/repository rows with write-capable connections measure the declarations, not a claim that a granted run would omit its write family.

The SDK Developer API CountTokens converter does not support tools/system instructions in this installed version, so the probe uses Generate Content usage. An initial unsupported `MINIMAL` thinking setting was refused with 400; the retained probes use supported `LOW`. Failed sandbox-network attempts were excluded from successful live measurements.

## Live comparison methodology

`CHAT_LIVE_EVAL_POLICY=subsets` enables a full-catalog vs subset comparison in `backend/chat/research-planning.live-eval.ts`. Both arms use the same checked-out v8 prompt, summary policy, runtime, gateway, SQLite persistence, synthetic sources and model. The baseline arm sets `fullToolCatalog`; the current arm uses family selection. No old v6 prompt is substituted in this mode. Arm order alternates between repetitions.

The corpus covers repository retry research, notes/code comparison, Knowledgebase research, mission status, broad ambiguous all-source research, and a repository request whose implicit notes dependency requires expansion. Quality checks are planted-fact regexes and citation linkage; they are useful regression checks, not comprehensive semantic grading. The broad ambiguous task has only one general fact requirement and is a fallback/variability probe. The repeated corpus checks citation presence and linked evidence ids; the finalized harness additionally resolves every cited receipt ref through the existing source-deduplicated citation cards. Guarded writes, Feature handoff and crash recovery are exercised by deterministic conformance tests rather than live writes.

Measurements include complete run wall time, attempted/completed provider requests, reported cumulative prompt/output/thought tokens, each cached-token bucket's reporting coverage, schema bytes and expansion calls/turns. Missing usage stays missing. A missing cache field does not prove zero cache hits, and a partial bucket total does not establish net billing savings. Raw synthetic answers/arguments remain in private scratch during evaluation; published metrics contain only numeric aggregates and fixed scenario labels.

## Live measured results

24/24 corpus runs completed: 84/84 planted facts matched and every run contained citations with linked evidence. Two repetitions per scenario/arm are a small sample; all numeric runs, ranges, standard deviations, reporting coverage and static counts are retained in [the companion metrics](chat-tool-subsets-2026-10-07.metrics.json). A separate final status smoke passed every-reference source-link checks in both arms, respecting the citation card’s deduplication of repeated observations.

| Task (two runs/arm) | Mean provider requests, full → subset | Mean reported prompt tokens, full → subset | Mean wall seconds, full → subset |
| --- | ---: | ---: | ---: |
| repository-research | 8 → 7 | 52,712.0 → 38,036.0 | 52.21 → 45.96 |
| notes-vs-code | 7.5 → 7 | 71,738.0 → 55,058.0 | 54.16 → 47.12 |
| knowledgebase-research | 4 → 4 | 21,055.5 → 15,019.5 | 17.99 → 18.72 |
| status | 3 → 3 | 14,388.5 → 10,205.0 | 13.16 → 14.53 |
| ambiguous | 11 → 12.5 | 141,698.5 → 189,911.5 | 68.76 → 119.53 |
| expansion | 7.5 → 7.5 | 75,511.5 → 68,459.0 | 65.21 → 65.18 |

For the four primary tasks combined (eight runs/arm), mean reported prompt tokens fell **26.0%** (39,973.5 → 29,579.6), mean attempted requests fell 5.625 → 5.25, and mean wall time fell **8.1%** (34.38 → 31.58 s). Every primary task reduced reported prompt input; Knowledgebase/status latency slightly increased. Repository full-catalog runs ranged 38.31–66.10 s and subsets 38.68–53.24 s; there is no uniform speedup.

The expansion task added one Knowledgebase expansion call in the first turn of each subset run, alongside independent discovery reads. It added **zero dedicated expansion turns** and both arms averaged 7.5 attempted requests. Reported prompt input fell 9.3% and mean wall time was essentially equal (65.21 → 65.18 s). Additional calls/results/rereads are included in these totals, rather than treating schema savings as free.

The ambiguous all-sources request selected the full catalog in both arms (10,628 schema JSON bytes). Its uncontrolled planning varied substantially: full requests 6–16 versus current 11–14, wall time 51.92–85.60 versus 82.91–156.15 s. This is a fallback/control sample with identical schemas, not a subsetting gain. Including it, **the whole six-task corpus had essentially unchanged reported prompt totals and was slower**: 62,850.7 → 62,781.5 tokens/run (−0.1%), 45.25 → 51.84 s (+14.6%), and 6.833 attempted requests/run in both arms. Do not extrapolate the primary-task savings to every request or add them to earlier optimization estimates.

**Implicit-cache reporting:** the full arm reported a cached-token field on 12/81 completed exchanges, the subset arm on 14/81. Those positive reported totals were 140,716 and 211,769 tokens respectively; remaining fields were absent, not recorded zeroes. Most of these observations came from the broad fallback task with identical declarations. The primary-task full arm had one positive cache report across 45 completed exchanges; subsets had none across 41. There were 82 attempted requests/arm and 81 completed exchanges/arm (one pre-turn retry in each arm). Missing usage for unsuccessful requests and sparse cached buckets prevent an exact net-cost or implicit-hit-rate comparison. No explicit cache is created.

**Retained decision:** keep deterministic expandable subsets for their measured schema and primary-task prompt reductions, with broad full-catalog fallback and historical recovery. There is no universal end-to-end latency or billing improvement claim. Watch implicit-cache behavior and expansion frequency on the existing private diagnostic surface; explicit caching and the final combined evaluation remain separate planned objectives. Old schema-1 checkpoints recover by fresh generation, which may require new model work but preserves completed guarded-write receipts.

## Verification and reproduction

The runtime, Feature and Knowledgebase conformance battery passed 85/85 tests on SQLite and disposable Postgres after correcting JSONB canonical hashing. Two additional historical-write tests (one per adapter) then passed: remove an all-workspaces grant after the signed write is checkpointed, recover with its original schema/effect, refuse it before upstream dispatch, and omit writes from the next live manifest. The connection-declaration test also passed on both adapters after adding checks for a foreign workspace, a lost per-message workspace and an empty all-workspaces scope. The unit checks cover family union/fallback, retained discovery, authorized-only expansion, exact identity, reordered JSON object keys and corrupt/duplicate manifests.

Existing tests still cover out-of-order reads and ordered joins, cancellation, stale/source fences, prompt injection, question recovery, incompatible-checkpoint fresh generation, uncertain writes with no repeat, revision conflicts, summaries and user-only draft Create/idempotency. Changed TypeScript passes lint/format checks; workspace-scoping, conformance-version and whitespace checks pass. Full Backend typechecking has unrelated errors in the pre-existing `activity-feed.ts` DTO projection and two `execution/runner-claim-http.test.ts` response fixtures; changed chat files have no errors. No release/deployment was performed.

```sh
CHAT_LIVE_EVAL_POLICY=subsets CHAT_LIVE_EVAL_REPEATS=2 GEMINI_API_KEY=... \
  node --import tsx backend/chat/research-planning.live-eval.ts <private-dir>
GEMINI_API_KEY=... \
  node --import tsx backend/chat/tool-manifest.live-eval.ts <schema-aggregate.json>
node scripts/with-test-db.mjs node --import tsx --test \
  backend/chat/tool-manifest.test.ts \
  backend/chat/gemini-runtime.postgres-conformance.test.ts \
  backend/chat/knowledgebase-writes.postgres-conformance.test.ts \
  backend/chat/feature-handoff.postgres-conformance.test.ts
```

Use a Node 24 binary compatible with the installed SQLite native module. The system Homebrew Node uses a different ABI; validation used the installed Node 24.13.0 without rebuilding shared dependencies.
