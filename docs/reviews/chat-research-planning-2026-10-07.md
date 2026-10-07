# Chat research planning: batched reads and focused retrieval — measured results

Mission **coo:1127**, objective **coo:1127.54xc**, 2026-10-07, CONTRACT.md v159 (unchanged). Baseline: [proposals](chat-optimization-proposals-2026-10-07.md) §P1 "fewer research rounds" and "smaller retrieved input", [audit](chat-diagnostics-audit-2026-10-07.md), [instrumentation baseline](chat-performance-baseline-2026-10-07.md). Aggregates: [metrics JSON](chat-research-planning-2026-10-07.metrics.json).

## Change

Prompt `overlord-assistant-v6` → `v7` (`backend/chat/gemini-runtime.ts`) replaces the single "request known independent reads together" sentence with three rules:

1. **Batch known reads.** Every tool turn costs a model round; call every read whose inputs are already known in the same turn, and wait only for reads that need an earlier result. Never guess ids or paths to batch. Concrete examples: notes + repository searches together, hit ranges in different files together, several missions/notes together.
2. **Narrow reads.** `search_text` for a distinctive identifier/phrase (scoped with `relativePath` when known), then `read_file` with `startLine`/`endLine`; whole files/trees only when structure matters. Knowledgebase: tool filters, selected fields, small limits, read only needed hits.
3. **Stop rule.** Stop when evidence answers the request; do not reread or reconfirm.

The `repository_read` declaration description now says "Prefer search_text, then a startLine/endLine range around the hits" (closed schema, required fields and declaration order unchanged). Bumping the version changes the config digest, so v6 checkpoints recover through the existing fresh-generation path.

**Unchanged runtime:** the ≤4-reads-per-turn pool (`CHAT_MAX_TARGET_READS_PER_RUN`, repository-read limiter), writes after reads one at a time in call order, then at most one question; complete streamed-turn checkpoint (`requestTools`) before execution; call-order join checkpoint before the next request; raw SDK/tool diagnostics; live source authorization. No new tool, speculative call, interface, DTO, schema or checkpoint shape — no contract amendment is required. A variant that let the model skip `list_workspaces` when the workspace was "known" showed no benefit and was reverted (it also invited guessed slugs).

## Method

`backend/chat/research-planning.live-eval.ts` runs the production `GeminiChatRuntime`, `ChatToolGateway`, `ChatRuns`, policy, checkpoints and receipts on in-memory SQLite against **live `gemini-3.8-flash`**. Sources are synthetic: a 10-file repository (whole-file reads 4–10 KB) and four Knowledgebase notes with realistic tools (`list_workspaces`, `search`, `read_resource`, `query`). The baseline arm substitutes the v6 prompt and v6 `repository_read` description into the outgoing request; everything else is identical. Arms are interleaved with alternating order, 5 repetitions × 4 tasks × 2 arms = 40 runs per experiment. Quality = every required fact present and `[E#]` citations linked to evidence ids. Tokens come from the runtime's private `performance.attempt` aggregate (provider `usageMetadata`). Raw runs stay in a mode-0700 private directory; only aggregates are published.

Tasks: repository research (retry limit, backoff values, post-retry handling), notes vs code (differences between design note and code), Knowledgebase research (decision + customer requirements), mission status.

## Results (final v7, experiment 2; means over 5 runs)

| Task / arm             | Provider requests | Tool turns | Calls per run |          Prompt tokens |    Gathered bytes | Output+thought |       Wall ms | Facts | Cited |
| ---------------------- | ----------------: | ---------: | ------------: | ---------------------: | ----------------: | -------------: | ------------: | ----: | ----: |
| Repository research v6 |       10.2 (6–17) |        9.2 |          11.6 |     97,625 (sd 60,647) |            36,983 |          3,060 |        47,307 | 19/20 |   5/5 |
| Repository research v7 |    **8.4** (6–10) |        7.4 |          10.6 | **60,658** (sd 13,174) |        **22,500** |          3,288 |        51,985 | 19/20 |   5/5 |
| Notes vs code v6       |               7.8 |        6.8 |          13.6 |                 65,696 |            42,172 |          3,490 |        45,794 | 25/25 |   5/5 |
| Notes vs code v7       |           **6.4** |        5.4 |          13.6 |             **57,127** |        **31,859** |          3,692 |        51,035 | 25/25 |   5/5 |
| Knowledgebase v6       |               4.0 |        3.0 |           6.0 |                 18,039 |             9,778 |          1,075 |        14,971 | 20/20 |   5/5 |
| Knowledgebase v7       |               4.0 |        3.0 |           6.2 |                 19,375 |            10,137 |          1,345 |        18,344 | 20/20 |   5/5 |
| Status v6              |               4.0 |        3.0 |           5.6 |                 17,669 |             5,661 |            829 |        13,885 | 15/15 |   5/5 |
| Status v7              |           **2.8** |        1.8 |           4.0 |             **12,841** |             4,133 |          1,357 |        15,736 | 15/15 |   5/5 |
| **All v6**             |               6.5 |        5.5 |           9.2 |                 49,757 |            23,648 |          2,114 |        30,489 | 79/80 | 20/20 |
| **All v7**             |    **5.4 (−17%)** |        4.4 |           8.6 |      **37,500 (−25%)** | **17,157 (−27%)** |   2,421 (+15%) | 34,275 (+12%) | 79/80 | 20/20 |

Multi-call turn share rose from 50% to 60%; ranged `read_file` share rose from 16% to 89%. Paired by task and repetition, v7 used fewer requests in 10/20 pairs and equal in 8 (mean −1.1); it was slower in 15/20 pairs (mean +3.8 s).

Experiment 1 (first v7 wording) reproduced the direction: requests 6.2 → 5.4 (−13%), prompt tokens 40,509 → 37,072 (−8.5%; notes vs code rose 16% because of broad `search_text "sync"` results of 12 KB), gathered bytes −23%, wall +11%, facts 79/80 → 80/80, citations 20/20 in both arms.

## Interpretation

- **Retained:** fewer provider rounds and lower cumulative input on representative research with equal fact and citation quality — the objective's acceptance target. The largest gains are on long repository research (−38% input, ~4.6× lower input variance: v6 occasionally ran 12–17 serial rounds) and status (−27% input).
- **Latency regression, not hidden:** in this harness wall time rose ~12%, consistent across both experiments. Thought tokens rose (planning larger batches), and the fixture's tools return in ~1 ms, so saved rounds save only model time. Production rounds also pay dispatch, execution and join (audit medians ≈ 0.24 + 0.80 + 0.87 s ≈ 1.9 s per round); 1.1 saved rounds would recover ~2 s of the ~3.8 s, so a smaller net regression may remain in production. This must be checked on live exports in the final combined evaluation (coo:1127.2an0).
- **Cost:** input is the dominant bucket (37.5k vs 2.4k output+thought per run). Uncached prompt tokens fell 44,092 → 37,500 (−15%) in experiment 2; v6 runs that ran long earned some implicit-cache hits (mean 5,665 cached tokens) that v7's shorter runs did not reach. Output+thought rose ~300 tokens/run. Net dollar effect depends on effective rates (`ΔU·uncached + ΔC·cached + ΔO·(output+thought)`); no billing ledger was collected.
- **Not achieved:** the model still sometimes searches common words (`sync`, `conflict`, 10–12 KB of hits) despite the distinctive-term instruction, and Knowledgebase research is unchanged at four rounds because `list_workspaces → search → read` is genuinely dependent.
- **Limits:** synthetic fixtures, one model, 5 repetitions per cell, high run-to-run variance (v6 repository research sd 60k tokens). These are controlled measurements, not production latency or billing claims.

## Safety and conformance

New conformance tests (`backend/chat/gemini-runtime.postgres-conformance.test.ts`):

- _A batched research turn runs at most four reads at once and joins out-of-order completions in call order_ — five reads in one turn, completed newest-first: max four in flight, one provider round, responses joined in original call order with the signed turn preserved, each receipt executed exactly once.
- _Cancelling a batched turn while its reads are in flight joins nothing and sends no further request_ — the queued fifth read never starts, no join checkpoint, no second provider request.

Existing coverage that still passes: sequential guarded Knowledgebase writes after the turn's reads in call order, uncertain-write no-resend, a question asked after the turn's reads with call-order join, checkpoint recovery at `requestTools`/`joinTools`, incompatible-checkpoint fresh generation, revocation, prompt injection, and proposal/Create invariants. The chat conformance batteries pass 124/124 on SQLite and disposable Postgres.

## Reproduce

```sh
GEMINI_API_KEY=... CHAT_LIVE_EVAL_REPEATS=5 \
  node --import tsx backend/chat/research-planning.live-eval.ts <private-dir>
# Optional: CHAT_LIVE_EVAL_TASKS=repository-research,status  CHAT_LIVE_EVAL_ARMS=current
```

Only synthetic fixture content is sent to the provider. Output: `<private-dir>/runs.jsonl` (private, includes answers and arguments) and `aggregate.json` (shareable aggregates).
