# Generalize Gemini LM Calls — Assessment (TanStack AI)

Mission: `coo:645` — *Generalize Gemini API Calls*  
Date: 2026-08-07  
Referenced tweet: [TanStack AI announcement](https://x.com/tan_stack/status/2085286291965370499) (TanStack AI beta / provider-agnostic toolkit)

## Verdict

**TanStack AI is a reasonable long-term option if Overlord wants real multi-provider LM support**, but it is **not a drop-in win for our current Gemini usage**, and **it does not replace `@google/genai`**.

For today's surface area (two server-side one-shot calls with null fallbacks), prefer a **thin internal LM interface** in `automations/` first. Adopt TanStack AI (or Vercel AI SDK) only when a second provider is a concrete near-term requirement.

| Question | Answer |
| --- | --- |
| Is TanStack AI a good way to generalize? | **Yes as a provider layer**, if multi-provider is a product goal. Overkill if we stay Gemini-only. |
| Would it replace `@google/genai`? | **No.** `@tanstack/ai-gemini@0.21.0` depends on `@google/genai` (`^2.10.0`). Switching adapters swaps the *wrapper*, not the Gemini SDK. |

## What we have today

Automations Layer owns optional Gemini tools (`CONTRACT.md` §8). Concrete call sites:

| Call | File | Shape |
| --- | --- | --- |
| Title / text summarization | `automations/src/title-summarizer/gemini-client.ts` → `generateGeminiText` | Plain text, `GEMINI_MODEL` / `gemini-2.5-flash-lite` |
| Delivery composition | `automations/src/compose-delivery/compose.ts` | Schema-constrained JSON via `@google/genai` `responseSchema` + `responseMimeType: 'application/json'` |

Shared pieces:

- Cached `GoogleGenAI` client (`getGeminiClient`)
- Env config: `GEMINI_API_KEY`, optional `GEMINI_MODEL`
- Contract rule: return `null` on missing key / provider failure so callers fall back deterministically
- Browser isolation: SPA must not import the automations root barrel (pulls `@google/genai`)

There is **no** streaming chat UI, tool-calling agent loop, or multi-turn conversation in this path. Desktop packs `@google/genai` because the embedded server uses the same automations package.

## What TanStack AI offers

[TanStack AI](https://tanstack.com/blog/tanstack-ai-beta) (beta as of 2026-06-09) is a TypeScript-first, provider-agnostic SDK:

- Unified activities (`chat`, structured output, media, realtime, …)
- Per-provider adapters (`@tanstack/ai-gemini`, `@tanstack/ai-openai`, `@tanstack/ai-anthropic`, Ollama, Groq, …)
- Structured outputs via `outputSchema` (Zod / Standard Schema / JSON Schema) — Gemini maps to native `responseSchema`
- Middleware, streaming UI hooks, AG-UI protocol — useful for apps, **mostly unused by our current automations**

Example shape that would map to `compose-delivery`:

```ts
import { chat } from '@tanstack/ai';
import { geminiText } from '@tanstack/ai-gemini';
import { z } from 'zod';

const draft = await chat({
  adapter: geminiText('gemini-3.1-flash-lite'),
  messages: [{ role: 'user', content: prompt }],
  outputSchema: ComposeDeliveryZodSchema
});
```

Provider swap is an adapter import change — that part matches the tweet's pitch.

## Would it replace `@google/genai`?

**No, not while Gemini remains a provider.**

Verified package metadata:

```text
@tanstack/ai-gemini@0.21.0
  dependencies: { '@google/genai': '^2.10.0', ... }
```

Implications:

1. Gemini path still ships Google's SDK (likely a newer minor than our pinned `2.8.0`).
2. Direct `GoogleGenAI` / `Schema` / `Type` imports in `compose.ts` would move behind TanStack's schema bridge (Zod → provider schema).
3. Only a **non-Gemini** adapter path would avoid `@google/genai` in that code path — and even then the Gemini adapter package still pulls it if installed.

So TanStack AI **abstracts** the Google package; it does not **eliminate** it.

## Fit against Overlord constraints

| Constraint | TanStack AI | Thin internal LM iface |
| --- | --- | --- |
| Optional provider / null fallback | Compatible (wrap try/catch → `null`) | Native fit |
| Schema-constrained compose-delivery | Supported (`outputSchema`; Gemini uses `responseSchema`) | Keep current `@google/genai` schema or Zod |
| Avoid leaking provider into SPA | Still need browser-safe subpaths; root must not export LM client | Same |
| Contract: Automations owns provider config | Env model would broaden beyond `GEMINI_*` | Same, smaller blast radius |
| Bundle / dep weight | `@tanstack/ai` + adapter(s) + still `@google/genai` | One extra interface file + Gemini adapter |
| API maturity | Beta (stable enough to build on per TanStack; still evolving) | Full ownership |
| Multi-provider tomorrow | Best | Manual second adapter |

## Alternatives

1. **Stay on `@google/genai` (status quo)** — Correct if Gemini-only is intentional. Lowest cost.
2. **Thin internal LM client (recommended near-term)** — e.g. `generateText` / `generateStructured` in `automations/src/lm/`, Gemini as default adapter, OpenAI/Anthropic later. Matches AGENTS.md “new provider” extension path without adopting a full AI app toolkit.
3. **TanStack AI** — Choose when we want adapter ecosystem, typed structured output across providers, and possibly future chat/streaming surfaces.
4. **Vercel AI SDK** — More mature competitor with the same “doesn’t remove Google SDK” property for Gemini. Prefer only if the team already standardizes on it elsewhere (Overlord currently does not).

## Recommendation

**Do not migrate automations to TanStack AI solely to “generalize Gemini.”**

1. If the goal is **provider choice**, introduce a **small Overlord-owned LM interface** under `automations/` and keep Gemini as the first adapter. That answers the mission without betting the Automations Layer on a beta app SDK.
2. If the goal is **TanStack ecosystem alignment** (streaming UIs, middleware, multi-modality later), TanStack AI is a **good fit for a follow-up implementation mission** — plan migration of `generateGeminiText` + `composeDeliveryWithGemini`, expand env config beyond `GEMINI_*`, update CONTRACT / docs, and accept that `@google/genai` remains a transitive dependency for Gemini.
3. Either path requires a **contract update** before implementation: Automations currently documents Gemini-specific provider config (`GEMINI_API_KEY`, model selection), and the SPA isolation language names `@google/genai` explicitly.

## Suggested follow-up objectives (if product wants multi-provider)

1. Spec `LanguageModel` / `LmClient` interface + env selection (`OVERLORD_LM_PROVIDER`, provider keys).
2. Migrate title summarizer to the interface (Gemini adapter).
3. Migrate compose-delivery structured output (Zod schema preferred over `@google/genai` `Schema` types).
4. Optionally evaluate TanStack AI as the interface implementation vs hand-rolled adapters.
5. Contract + docs update; keep browser-safe subpaths.

## Assumptions

- The linked tweet refers to **TanStack AI** (provider-agnostic toolkit), not a different TanStack product.
- Current automations stay one-shot server jobs; no product requirement for chat UI in this mission.
- “Replace Google genai” means remove it from Overlord’s dependency tree for Gemini calls — which TanStack AI cannot do.
