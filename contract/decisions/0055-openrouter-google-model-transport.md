# 0055 — Route Google models through OpenRouter

Status: Accepted

## Decision

Replace the Google SDK with a shared server-only HTTPS OpenRouter chat-completions
transport. Use `OPENROUTER_API_KEY` and optional `OPENROUTER_MODEL` for automations;
chat uses `CHAT_OPENROUTER_API_KEY` falling back to `OPENROUTER_API_KEY`, and
`CHAT_OPENROUTER_MODEL`. Bare Google model ids gain the `google/` namespace. Defaults
remain `google/gemini-3.5-flash-lite` and `google/gemini-3.8-flash` respectively.
Google keys are never sent to OpenRouter. Existing JavaScript helper names and the
REST provider identity `gemini` remain compatible.

Translate system/user messages, JSON schemas, function declarations, tool results,
reasoning effort and token usage at the transport boundary. Assemble tool argument
deltas before execution; preserve call ids and ordered reasoning details through
private checkpoints. Retain legacy checkpoint parts and translate legacy tool-call
signatures. Cancellation aborts the upstream request. An incomplete or errored stream
fails before any assembled tool batch can execute.

Retire Google's explicit cache API and its credential-specific configuration. Send
all authorized static context inline; provider implicit caching may still occur.
This removes storage charges and provider cache handles. The historical cache
feasibility evaluation is retired with the SDK; historical evaluation reports remain.

## Impact

This is a major contract change for operator configuration and the provider boundary.
Automations, backend, CLI consumers, and desktop keep their existing result/fallback
interfaces. Desktop packaging stages the new credential; backend and desktop no
longer ship the Google SDK or its authentication dependencies. REST schemas, database
schema, authorization, source isolation, tool capabilities and checkpoint schema stay
unchanged. Operators must supply the OpenRouter key to each deployed runtime.
