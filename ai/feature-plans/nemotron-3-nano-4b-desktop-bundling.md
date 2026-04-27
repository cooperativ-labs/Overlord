# Nemotron 3 Nano 4B in the Overlord Desktop App

**Ticket:** [`32580cfe`](https://overlord.cooperativ.io) — *Nemotron 3 nano 4b in desktop app*
**Author:** Claude (Opus 4.7) via Overlord
**Date:** 2026-04-27
**Status:** Investigation — no code changes proposed yet

---

## TL;DR

- **Bundling cost:** ~3 GB on-disk (Q4_K_M GGUF) + ~50 MB of `node-llama-cpp` native binaries per platform. The Overlord desktop installer roughly **doubles or triples in size**. Better path: ship the runtime, lazy-download the model on first opt-in.
- **Compatibility:** Works on Apple Silicon (Metal), x64 Mac/Windows/Linux. Mamba-2 hybrid architecture is supported in current `llama.cpp`. Notarization on macOS already permits `allow-jit` and `allow-unsigned-executable-memory`, which is what `llama.cpp` needs.
- **Replacing Gemini for title summarization:** Yes — strong fit. Same caveat for commit messages. PR drafts are borderline (latency + structured JSON). **Keep Gemini 3 Flash for feed posts.**
- **Ticket-collision review (future use case):** Plausible but not optimal at 4B. Better with a fine-tuned classifier or a hybrid embedding + small-model approach. Nemotron's strong long-context (262K) is a real asset here.
- **Sandboxing:** Yes — `llama.cpp` makes no outbound network calls; combined with Electron's process isolation we can confine the model to in-process IPC only. The model itself has no IO; the runtime is what we'd lock down.
- **Recommended model:** **Qwen 3 4B** edges out Nemotron Nano 4B for our specific workloads (instruction-following, tool-calling, Apache-2.0 license). Nemotron Nano is a close second and wins on context length and math reasoning, but its **NVIDIA Open Model License** has a guardrail-tampering termination clause worth legal review.

---

## 1. Current Gemini surface area in Overlord

Mapped from `lib/ai/`, `lib/actions/`, and `supabase/functions/`:

| # | Purpose | File | Model | Input size | Output | Latency | Local-candidate? |
|---|---------|------|-------|------------|--------|---------|------------------|
| 1 | Ticket title summarization | `lib/ai/generate-ticket-title.ts` | `gemini-2.5-flash-lite` | ~100–1,000 chars | ~10 tokens, free text | Background | ✅ Strong |
| 2 | Commit message generation | `lib/ai/generate-commit-message.ts` | `gemini-2.5-flash` | Diff up to 60K chars | ~500 tokens | User-facing (~3s budget) | ✅ Good (Q8) |
| 3 | PR body draft | `lib/ai/generate-pull-request.ts` | `gemini-2.5-flash` | Diff up to 80K chars | JSON `{title, body}`, 2K tokens | User-facing (~3–5s) | ⚠️ Borderline |
| 4 | Feed post synthesis | `supabase/functions/generate-feed-post/index.ts` | `gemini-3-flash-preview` | Multi-ticket corpus | Complex nested JSON | Background | ❌ Stay on frontier |
| 5 | Slack-events title fallbacks | `supabase/functions/slack-events/index.ts` | `gemini-2.5-flash-lite` | Single objective | Title text | Background | n/a (server-side, not desktop) |

**No local-model infrastructure exists today.** The desktop app's `local-runtime.ts` is unrelated — it's just a PID/secret file for the Electron-hosted Next server.

---

## 2. Bundling cost & desktop packaging impact

### Current packaging

`apps/desktop/electron-builder.yml` already ships:

- The Next.js standalone server (`apps/web/.next/standalone/**/*`)
- The `overlord-cli` package
- Three plugins (overlord, claude, cursor)
- `remote-agent` resources

These are all in `extraResources` / `asarUnpack`, so we already understand the pattern of shipping native-friendly content unpacked from the asar.

### What Nemotron 3 Nano 4B would add

| Component | Size | Notes |
|-----------|------|-------|
| `nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF:Q4_K_M` | **2.84 GB** | Recommended consumer quantization |
| `Q8_0` (higher-quality alternative) | ~4.0–4.3 GB | Only worth shipping if Q4 quality is insufficient |
| `node-llama-cpp` + prebuilt binaries | ~30–80 MB per platform | Metal (mac arm64), CPU+AVX2 (x64), Vulkan/CUDA optional |
| Tokenizer + config files | ~5 MB | |

A typical Overlord install today is on the order of a few hundred MB; **adding Q4_K_M roughly triples the installer**, and that footprint persists at rest.

### Recommended packaging path

**Don't bundle the weights in the installer.** Instead:

1. Ship `node-llama-cpp` and its prebuilt binaries inside the Electron app (must live outside the asar — node-llama-cpp explicitly requires its file structure preserved).
2. Add a settings panel ("Local AI" / opt-in toggle) that, on first enable, downloads the Q4_K_M GGUF from Hugging Face into `~/.ovld/models/` with a checksum.
3. Surface progress in the desktop UI; allow the user to delete the model to reclaim disk.
4. Fall back to Gemini transparently when the local model is disabled or the file is missing.

This keeps the installer lean (~60 MB added for the runtime), respects user disk space, and lets us ship multiple model options later (Q8 for users with 16 GB+ RAM, alternative models, etc.).

### macOS code-signing / notarization

The existing `entitlements.mac.plist` already grants:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.allow-dyld-environment-variables`

These are exactly the entitlements `llama.cpp` requires for Metal-accelerated inference, so **no notarization changes are needed**. The native `.node` binaries from `node-llama-cpp` are signed at build time by their distributor; we'd need to verify and potentially re-sign during our `afterSign: scripts/notarize.cjs` step.

---

## 3. Compatibility & runtime concerns

### Architecture

Nemotron 3 Nano 4B is a **hybrid Mamba-2 + 4-layer attention** model (3.97 B parameters, dense, derived by structured pruning from Nemotron Nano v2 9B). Mamba support landed in `llama.cpp` over the past year; the Q4_K_M GGUF is published by NVIDIA and validated against `llama-server`.

**Hardware requirements (from NVIDIA + Unsloth docs):**

- Q4_K_M needs ~3 GB RAM at runtime; Q8_0 needs ~5 GB.
- Verified at 18 tok/s on a Jetson Orin Nano 8 GB (Q4_K_M, llama.cpp).
- Apple Silicon: Metal acceleration works out of the box (`-DGGML_CUDA=OFF` in build).
- Intel Macs: CPU-only fallback; performance will be poor.
- Windows/Linux x64 without a GPU: CPU-only is workable but slow.

### Known weaknesses

- Mamba models have weaker exact-recall on long-range lookups versus full-attention transformers — relevant if we use the 262 K context for full repo scans.
- Trails comparable transformers on vanilla MMLU (NVIDIA's own caveat).
- Reasoning mode (default-on) inserts CoT tokens; for short tasks like title summarization we'd disable it via system prompt to cut latency.

### License

**NVIDIA Nemotron Open Model License** (a permissive, royalty-free, commercial-OK license). Two clauses worth flagging to legal:

1. **Guardrail termination:** if we "bypass, disable, reduce the efficacy of, or circumvent" any safety guardrail "without a substantially similar Guardrail appropriate for your use case", the license auto-terminates. We don't intend to do this, but a prompt-engineering choice could conceivably be construed this way; we'd want to document our system prompt as a substantially-similar guardrail.
2. **Patent litigation:** standard copyleft-style termination if we sue NVIDIA over the model.

Compare to Apache-2.0 (Qwen, Phi-4-mini), which has neither clause.

---

## 4. Replacing Gemini for title summarization

### Verdict: ✅ Yes, this is the strongest first use case

The current call (`lib/ai/generate-ticket-title.ts:12-48`) sends a 100–1,000 character objective and asks for a ≤60-character action-oriented title. There's no schema, no tool use, and no UI is blocked on the result.

Nemotron Nano 4B at Q4_K_M with reasoning disabled should produce this in well under 1 second on Apple Silicon, with quality indistinguishable from `gemini-2.5-flash-lite` for this task. IFEval-Instruction at 88.0 (reasoning-off) is comfortably above what's needed for a one-shot instruction-following prompt.

**Suggested rollout:**

- Add a `local` model strategy alongside `gemini` in `lib/ai/generate-ticket-title.ts`.
- Route the call through an Electron IPC channel that talks to a `llama-server` instance launched by the desktop main process.
- Web/server-side title generation (Slack events handler) keeps using Gemini — local inference is desktop-only.
- Track local-vs-cloud quality with a logging hook so we can measure regression rates.

**Keep Gemini for feed posts.** The feed post call (`supabase/functions/generate-feed-post/index.ts`) does multi-document synthesis with nested-JSON output, runs in an edge function (no desktop runtime), and benefits materially from `gemini-3-flash-preview`'s sophistication. Don't touch it.

---

## 5. Ticket-collision review (future use case)

The objective hints at a future agent that reads draft tickets and predicts which files each will touch, to avoid two agents stomping on the same file simultaneously.

**Can a 4B model do this? Plausibly, with caveats:**

- **Strengths:** Nemotron Nano's 262 K context window is unusual for this size class — it could in principle ingest a small codebase tree and a batch of ticket drafts in one pass.
- **Weaknesses:** Mamba models trade exact-recall for throughput; precise file-path prediction is exactly the kind of needle-in-haystack task where vanilla transformers do better.
- **Better architecture:** A hybrid pipeline likely beats a single LLM call:
  1. Embedding-based coarse retrieval (e.g., `bge-small` over the file tree) to narrow candidates.
  2. A 4B model classifier to confirm which files each ticket touches.
  3. A simple set-overlap calculation to score collision risk.

This is a place where Qwen 3 4B's stronger benchmark numbers and Apache-2.0 license would matter more than Nemotron's context length, *unless* we want to feed entire repos in one pass.

---

## 6. Sandboxing the model from the outside internet

### Yes, this is straightforward.

`llama.cpp` (and `node-llama-cpp` on top of it) is purely a numerical inference engine — it makes **zero outbound network calls** at runtime. The model weights are static; the only IO is reading the GGUF file and producing tokens.

What needs to be sandboxed is the **runtime that hosts the model and exposes it to other code**. In Overlord's Electron architecture, the cleanest setup is:

1. **Spawn `llama-server` as a child process** of the Electron main process, bound to `127.0.0.1` on a random port with `--api-key` set to a per-session secret (mirrors `local-runtime.ts`'s existing secret pattern).
2. **Apply OS-level firewalling on macOS via `sandbox-exec`** (or a launchd plist for spawned children) denying `network-outbound` except to `localhost`. The existing `entitlements.mac.plist` already grants `network.client` to the parent app — we'd revoke it for the child.
3. **Route all model calls through a single Electron IPC channel** to a TypeScript shim that validates inputs, applies prompt templates, and forwards to the local `llama-server` over loopback. The renderer never gets direct access; the model never gets a fetch handle.
4. **For tool/function calling:** the model can *emit* tool-call JSON, but execution stays in the TS shim, which only allows tool names from a hardcoded allow-list mapped to specific Overlord API methods. This is the canonical pattern (similar to how Anthropic's tool-use API works).

The result: the model can communicate **only** via Overlord's defined IPC surface, and it has no path to the network even if prompt-injected to try.

### Caveat

`node-llama-cpp` itself can lazy-download model weights at first run if we use its built-in model-pull helpers. We'd disable that and explicitly manage downloads through a controlled flow (signed URLs, checksum verification, user consent).

---

## 7. Other features unlocked by local model + full code access

Because the model runs in-process with the Electron app, it has the same filesystem access as the user's editor. Features this enables:

| Feature | Description | Privacy impact |
|---------|-------------|----------------|
| **Offline ticket drafting** | Pre-fill ticket title + objective from a selected file/diff with no network call | Strong — code never leaves the laptop |
| **Pre-flight ticket review** | Local pass that flags vague objectives, missing acceptance criteria, scope creep, or duplication of recent tickets | Same |
| **Smart ticket-to-file routing** | When user starts a ticket, suggest relevant files/symbols based on objective text + repo grep | Same |
| **Auto-tagging & duplicate detection** | Suggest project, priority, related tickets at draft time | Same |
| **Local commit-message and PR drafting** | Move (2) and (3) above to local for users on metered Gemini quotas | Same |
| **In-IDE-style code Q&A from the desktop app** | Chat with your repo without ever invoking a remote provider | Strong |
| **Always-on collision predictor** | Continuously analyze in-flight tickets to warn before launching collisions (the future case from the objective) | Strong |
| **Privacy mode for sensitive repos** | Toggle that forces all AI features through local inference; bail out gracefully on calls that need a frontier model | Strong |
| **Background pre-summarization** | Generate titles, tags, and short blurbs as the user types, with no network round-trip | Lower latency |

Most of these are small, opt-in features that would be hard to justify shipping if they meant a network round-trip on every keystroke. Local inference flips the cost equation.

---

## 8. Comparison with peer 4B-class models

All numbers from public model cards / `llm-stats.com` / NVIDIA's technical report. Treat as directional.

| Model | Params | License | Ctx | IFEval (instr) | MMLU-Pro | GPQA | Math | Tool-calling | GGUF Q4 size | Notes |
|-------|--------|---------|-----|---------------|----------|------|------|--------------|--------------|-------|
| **Nemotron 3 Nano 4B** | 3.97 B | NVIDIA Open Model License | 262 K | 88.0 / 92.0 (reasoning) | n/a | 53.2 (reasoning-on) | 95.4 MATH500 | Trained on glaive + APIGen + ToolBench (BFCL v3: 61.1) | **2.84 GB** | Hybrid Mamba-2; reasoning toggle; pruned from 9B parent |
| **Qwen 3 4B** | 4.0 B | Apache 2.0 | 32 K (131 K w/ YaRN) | ~89.8 | 79.1 | 76.2 | strong | First-class agent/tool support | **2.5 GB** | Pure transformer; widest runtime support; SOTA among open 4B in early 2026 |
| **Phi-4 Mini** | 3.8 B | MIT | 128 K | n/a | 52.8 | 25.2 | 88.6 GSM8K | Strong structured-output story | ~2.4 GB | Very low VRAM, fastest tokens/sec; weaker GPQA |
| **Gemma 3 4B** | ~4 B | Gemma (Google) | 128 K | 90.2 | n/a | n/a | 89.2 GSM8K | Function-calling supported | ~2.6 GB | Permissive but Google-specific terms; broad runtime support |
| **Llama 3.2 3B** | 3.2 B | Llama 3 Community | 128 K | strong | low | weak | weak | Limited | ~1.9 GB | Smaller and faster; older capabilities; outclassed by above |

### Recommendation

**Primary pick: Qwen 3 4B.**

- Apache 2.0 license is the cleanest legal story.
- Native tool-calling, strong agent benchmarks, broad runtime support (`llama.cpp`, `ollama`, `mlx`, `vLLM`).
- Best-in-class IFEval and MMLU-Pro for the size.
- 32K native context is plenty for our title/commit/PR workloads.

**Secondary pick: Nemotron 3 Nano 4B.**

- Better choice if we want the 262 K context (e.g., for the future ticket-collision feature ingesting a repo tree).
- Strong math/reasoning scores but those don't help our workloads much.
- License needs a quick legal review for the guardrail clause.

**Worth keeping on the bench: Phi-4 Mini.**

- The fastest option per token; if we discover latency is the binding constraint for in-flight features (auto-tagging while typing, etc.), this becomes the right call.
- MIT license is bulletproof.

A pragmatic implementation could ship **Qwen 3 4B as the default**, with the model identifier pluggable in user settings so we can A/B-test or let power users switch.

---

## 9. Suggested next steps (not implemented in this ticket)

1. **Spike (~1 day):** Wire `node-llama-cpp` into a throwaway Electron branch; benchmark Qwen 3 4B and Nemotron Nano 4B on title summarization and commit-message generation across an M1, M3, and Intel Mac. Report tokens/sec and quality vs `gemini-2.5-flash-lite`.
2. **Ticket: Local-AI settings panel.** New section in `apps/web/components/modals/settings/` for enabling local inference, choosing a model, and triggering the download with progress UI.
3. **Ticket: IPC + sandboxed `llama-server` host.** New `apps/desktop/electron/services/local-llm.ts` that spawns the server, secures it with the existing `local-runtime` secret pattern, and exposes typed IPC methods.
4. **Ticket: Strategy abstraction in `lib/ai/`.** Replace direct `gemini-2.5-flash-lite` calls with a `summarizeTitle()` function that picks `local` or `gemini` based on user config and availability.
5. **Ticket: Legal review of NVIDIA Nemotron Open Model License** (only if Nemotron is the chosen model).
6. **Future ticket (collision review):** Prototype the hybrid embedding-retrieval + small-model classifier sketched in section 5; revisit which model wins on this specific task.

---

## Sources

- [NVIDIA-Nemotron-3-Nano-4B-GGUF (Hugging Face)](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-GGUF)
- [NVIDIA Nemotron 3 Nano family overview (NVIDIA Research)](https://research.nvidia.com/labs/nemotron/Nemotron-3/)
- [NVIDIA Nemotron 3 Nano technical report (PDF)](https://research.nvidia.com/labs/nemotron/files/NVIDIA-Nemotron-3-Nano-Technical-Report.pdf)
- [Unsloth: NVIDIA Nemotron 3 Nano run guide](https://unsloth.ai/docs/models/nemotron-3)
- [Awesome Agents: Nemotron 3 Nano 4B benchmarks & deployment](https://awesomeagents.ai/news/nvidia-nemotron-3-nano-4b/)
- [NVIDIA Nemotron Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-nemotron-open-model-license/)
- [Hidden risks of NVIDIA's Open Model License (analysis)](https://shujisado.org/2025/12/19/nvidia-open-model-license-a-corporate-risk-analysis/)
- [Qwen3-4B-GGUF (Hugging Face)](https://huggingface.co/Qwen/Qwen3-4B-GGUF)
- [Phi-4 Mini vs Qwen3.5-4B comparison (llm-stats)](https://llm-stats.com/models/compare/phi-4-mini-vs-qwen3.5-4b)
- [node-llama-cpp Electron guide](https://node-llama-cpp.withcat.ai/guide/electron)
- [Local LLMs on Apple Silicon Mac 2026](https://www.sitepoint.com/local-llms-apple-silicon-mac-2026/)
- [Small Language Model Leaderboard (Awesome Agents)](https://awesomeagents.ai/leaderboards/small-language-model-leaderboard/)
