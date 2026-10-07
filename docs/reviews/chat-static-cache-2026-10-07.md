# Gemini static-prefix caching: evaluation and hybrid implementation — 2026-10-07

Mission objective: `coo:1127.0904`. Baselines: [proposals](chat-optimization-proposals-2026-10-07.md) (P2), [audit](chat-diagnostics-audit-2026-10-07.md), [instrumentation](chat-performance-baseline-2026-10-07.md) and [tool subsets](chat-tool-subsets-2026-10-07.md). Numbers: [companion metrics](chat-static-cache-2026-10-07.metrics.json).

## Decision

**Implement a hybrid explicit cache, not cache-everything.** An explicit cache of only the exact system instruction and declarations helps small requests, where implicit caching was not observed to hit. It hurts large requests, because a `cachedContent` request reports only the cache's tokens as cached and gains no implicit hits on the conversation. The runtime uses the cache only while the attempt's previous reported prompt stays below 16,000 tokens. Larger requests, tool-free closing requests and summaries go inline.

In the live corpus, the effective input rate on the four primary tasks fell from $0.750 to $0.530–$0.581 per million prompt tokens (−22.5% to −29.3%). That includes storage and an upper-bound creation charge. Over all six tasks the rate moved +0.6% to −6.4%: the broad fallback task varied heavily between runs and already received large implicit hits. Answer quality and citations were unchanged in 24/24 runs, with no fallbacks or creation failures. These are measured results from a small sample, not a guarantee. Caching never removes prompt tokens or context occupancy.

## Verified support (gemini-3.8-flash, @google/genai 2.24.0)

`backend/chat/explicit-cache.live-eval.ts` sent only the Overlord-authored v8 prompt, reviewed declarations built for synthetic connection ids, and synthetic text. Every cache it created was deleted.

| Static prefix (prompt v8 + manifest) | Counted tokens | Create |
| --- | ---: | --- |
| System instruction only | 845 | — |
| Status family | 2,194 | accepted, ~1.1 s |
| Repository family | 2,511 | accepted, ~1.0 s |
| Knowledgebase read / per-message write | 4,291 / 6,336 | accepted, ~1.2–1.4 s |
| Full read / full write | 5,596 / 7,641 | accepted, ~1.1 s |

- **Minimum.** The [caching guide](https://ai.google.dev/gemini-api/docs/caching) lists 4,096 tokens for Gemini 3.8 Flash as the implicit-caching minimum. `caches.create` accepted the 2,194- and 2,511-token subset manifests, and cached requests reported exactly those counts as cached. Nothing was padded. The page does not specify billing below the minimum, so this report relies only on reported usage.
- **Request shape.** A `cachedContent` request that also set `systemInstruction`, `tools` or `toolConfig` (AUTO or NONE) was refused with 400. A cache created with AUTO (or no tool config) produced function calls. A separately created NONE cache suppressed them. The runtime therefore caches AUTO only and sends every NONE closing request inline.
- **Expiry and deletion.** A cache used after its 5 s TTL, or after deletion, was refused with 403 before any chunk.
- **Pricing.** Through 2026-12-31 the [Standard tier](https://ai.google.dev/gemini-api/docs/pricing) charges $0.75 per million input tokens, $0.075 per million cached tokens and $0.50 per million tokens per hour for storage; every rate doubles on 2027-01-01, which leaves every ratio unchanged. The pricing page does not say whether creation is billed as input. The models below bound it: either storage only, or one full-rate input charge per creation.

## Implicit and explicit cached-token behaviour

The synthetic runs used the full write prefix (7,641 tokens) plus a conversation that grew by about 2,550 tokens per round. Arm order rotated. The pure implicit and explicit arms had nine runs each (four six-round and five ten-round); the hybrid arm had three ten-round runs.

| Round (median prompt) | Implicit cached | Explicit cached | Hybrid cached |
| --- | ---: | ---: | ---: |
| 0–3 (10.2k–17.8k) | none reported | 7,641 | 7,641 |
| 4 (20.4k) | 16,250 (8/9 reported) | 7,641 | 16,250 |
| 9 (33.1k) | 28,493 | 7,641 | 28,493 |

The static prefix had already been sent many times, yet implicit caching reported nothing below about 18k-token prompts. It then cached in roughly 4,096-token blocks. Explicit caching pinned the cached count at K and never added implicit hits. The hybrid arm regained implicit hits on its first inline request. Over ten rounds, mean input cost before storage was $0.0777 implicit, $0.1133 explicit (+46%) and $0.0630 hybrid (−19%). Median first-chunk latency was 2.17 s implicit, 1.93 s explicit and 1.82 s hybrid. Run-to-run variation was wide (maxima up to 17.8 s), so this is no evidence of a latency regression, not a speedup claim.

## Cost model before implementation

`scripts/analyze-explicit-cache.mjs` applies these effects to the retained measurements:

- **Long audit run** (28 exchanges, 71.5% implicit cached). Explicit-everything would raise input cost from $0.262 to $0.586–$0.592. The hybrid caches four early requests and keeps every later implicit hit: $0.241–$0.247.
- **Tool-subset live corpus** (twelve subset runs). With one cold cache per run, a 10-minute TTL and the first request inline, the hybrid models 19.2–25.3% net input savings overall and 24.1–32.9% on primary tasks. The same assumptions for explicit-everything give net savings of only −3.6% to +2.5% overall: long runs lose about as much as short runs gain.

## Implementation

The contract was amended first (`CONTRACT.md` Gemini runtime *Static-prefix cache*, a v159 summary paragraph, `contract/components.yaml`) as an internal provider-policy refinement at v159.

- `backend/chat/gemini-client.ts`: optional `createCache`/`deleteCache` on the SDK seam (`caches.create`/`caches.delete`) and `config.cachedContent`.
- `backend/chat/static-cache.ts`: a process-local registry.
  - Key: SHA-256 of owner profile and organization, model and canonical prefix. Caches are never shared across owners.
  - TTL 600 s; reuse only with at least 60 s remaining.
  - Bounds: 64 entries, 4 per owner. A full registry skips creation; an owner's oldest cache beyond the bound is deleted from that owner's attempt.
  - Creation: single-flight, non-blocking and limited to 15 s. A cache is usable only after its creation is durably recorded. A failed key is suppressed for the TTL.
- `backend/chat/gemini-runtime.ts`: hybrid routing for AUTO requests only.
  - Fallback: on 400/403/404 at stream open (before any chunk), the cache entry is invalidated and the identical request is sent inline once.
  - Lifecycle: creation started by an attempt is awaited before the attempt finishes, including after cancellation or a crash.
  - Context: the budget still counts cached declaration bytes.
  - Diagnostics, all owner-private: `provider.cache_create`, `provider.cache_delete`, `provider.cache_fallback`; a cached `provider.request` also records `staticCache` with the name, key and effective instruction, declarations and tool config; `performance.attempt` adds request and fallback counts.
- `backend/chat/engine.ts`: on by default when a key is configured; `CHAT_GEMINI_STATIC_CACHE=off` disables it (both env examples are documented).

The config digest, checkpoint schema 2, fresh-generation rules, source authorization, live gateway checks, ordered receipts, sequential guarded writes and user-only Create are unchanged. The cache name never appears in checkpoints, snapshots or events. A resumed attempt recomputes the key and reuses or recreates the cache. No database, REST/DTO, Web, Desktop, Mobile, Auth, Protocol, CLI, MCP, Connector, Runner, Automations or extension change.

## Live end-to-end comparison

`CHAT_LIVE_EVAL_POLICY=cache` in `backend/chat/research-planning.live-eval.ts` runs both arms with the same v8 prompt, relevance subsets, runtime, gateway, SQLite persistence and synthetic sources. Only `current` has a static cache, and each run starts cold with a new registry. There were two alternating repetitions per task (24 runs). Cost uses the reported prompt and cached tokens per run, plus each created cache's tokens × storage for 10 minutes, with or without one full-rate creation charge.

| Task (2 runs/arm) | Effective $/M prompt, off → on | Cached share, off → on | Mean wall s, off → on |
| --- | ---: | ---: | ---: |
| repository-research | 0.750 → 0.494–0.539 | 0% → 38.6% | 70.6 → 44.3 |
| notes-vs-code | 0.750 → 0.562–0.588 | 0% → 28.3% | 55.1 → 60.8 |
| knowledgebase-research | 0.750 → 0.462–0.573 | 0% → 44.5% | 17.8 → 18.1 |
| status | 0.750 → 0.524–0.810 | 0% → 38.2% | 15.1 → 14.6 |
| ambiguous (full catalog) | 0.353 → 0.392–0.406 | 58.8% → 53.2% | 116.8 → 92.1 |
| expansion | 0.635 → 0.551–0.611 | 17.1% → 30.5% | 69.7 → 62.2 |
| **Primary four** | **0.750 → 0.530–0.581** | 0% → 33.5% | 39.6 → 34.5 |
| All six | 0.501 → 0.469–0.504 | 36.8% → 42.2% | 57.5 → 48.7 |

- **Cache use.** 37 of 45 primary-task requests used the cache. Each run's first request was inline while creation ran alongside it (1.10–1.36 s, off the critical path). The expansion task created a second cache for its widened manifest, as intended. There were no creation failures or fallbacks.
- **Status.** Status runs have only two requests, so a cold per-run cache serves one of them. With the full-rate creation upper bound, the status rate rises to $0.810. Warm reuse within the TTL (registry shared across an owner's runs) removes most of that cost.
- **Ambiguous task.** Provider-chosen planning varied heavily (27 vs 10 and 8 vs 17 requests), and longer runs accumulate more implicit hits. The rate difference cannot be attributed to the cache from two runs, and its raw per-exchange rows were not retained.
- **Wall time.** Varies with planning and is not claimed as a cache effect.

Quality was identical in both arms: all planted facts matched in 24/24 runs, and every answer had resolving citations.

## Testing

- `backend/chat/static-cache.test.ts` (7 tests): single-flight, owner/model/prefix keying with canonical object keys, the reuse margin and TTL renewal, per-owner retirement, the global bound, the unrecorded-creation refusal and invalidation.
- `gemini-runtime.postgres-conformance.test.ts`, *static-prefix cache* (6 tests per adapter):
  - Cold and warm use, with exactly the inline prefix and no conversation in the cache, plus effective-input diagnostics and nothing in checkpoints, snapshots or events.
  - An expired cache refused with 403 and resent inline once, with identical contents and no repeated tool.
  - Large prompts, NONE closing requests and changed manifests (expansion) all inline.
  - A failed creation captured once and then suppressed.
  - Cancellation waiting for in-flight creation capture; checkpoint recovery reusing the cache with the signed call executed once.
  - Owner isolation for identical manifests.
- The full chat runtime, Knowledgebase-write, Feature-handoff, manifest and cache battery passed **106/106** on SQLite and disposable Postgres. The engine test also passed. Changed TypeScript passes lint and format checks.
- Full Backend typechecking still reports only the pre-existing errors in `activity-feed.ts` and `execution/runner-claim-http.test.ts`.

## Risks and follow-ups

- **Creation billing.** Not documented; both bounds are reported above. Verify against actual billing after rollout.
- **Switch threshold.** The 16,000-token switch comes from this model's observed, best-effort implicit-cache behaviour. A model or provider change can move it. Watch cached shares and the `staticCache` counts in private diagnostics; the final combined evaluation (`coo:1127.2an0`) should re-measure.
- **Restarts.** The registry starts cold on restart. Orphaned caches keep accruing storage for at most 600 s each.
- **Evaluation leftovers.** The live evaluation's cold per-run caches were left to expire by TTL, and their storage is included in the costs above.

## Reproduction

```sh
GEMINI_API_KEY=... CHAT_CACHE_REPEATS=4 CHAT_CACHE_ROUNDS=6 \
  node --import tsx backend/chat/explicit-cache.live-eval.ts <probe.json>
GEMINI_API_KEY=... CHAT_CACHE_SKIP_PROBES=1 CHAT_CACHE_ARMS=implicit,explicit,hybrid \
  CHAT_CACHE_REPEATS=3 CHAT_CACHE_ROUNDS=10 node --import tsx backend/chat/explicit-cache.live-eval.ts <hybrid.json>
node scripts/analyze-explicit-cache.mjs <probe.json>... --out <aggregate.json>
CHAT_LIVE_EVAL_POLICY=cache CHAT_LIVE_EVAL_REPEATS=2 GEMINI_API_KEY=... \
  node --import tsx backend/chat/research-planning.live-eval.ts <private-dir>
node scripts/with-test-db.mjs node --import tsx --test backend/chat/static-cache.test.ts \
  backend/chat/tool-manifest.test.ts backend/chat/gemini-runtime.postgres-conformance.test.ts \
  backend/chat/knowledgebase-writes.postgres-conformance.test.ts backend/chat/feature-handoff.postgres-conformance.test.ts
```

Use Node 24, matching the installed SQLite native module.
