# Automations Module

Optional AI automations for Open Overlord. Developers register simple automations behind
a shared `Automation` interface; the reference implementation is Gemini-backed text
summarization and objective title generation.

## Table of Contents

- [For Users](#for-users)
  - [Configuration](#configuration)
- [For Developers](#for-developers)
  - [Contract Component](#contract-component)
  - [Documentation](#documentation)
  - [Code & Tests](#code--tests)
  - [Interaction Boundaries](#interaction-boundaries)

## For Users

### Configuration

Copy [`.env.local.example`](../.env.local.example) to `.env.local` for development, or
copy [`.env.prod.example`](../.env.prod.example) to `.env.prod` for packaged builds, and set `OPENROUTER_API_KEY` to enable
Google Gemini models through OpenRouter. When the key is missing or a call fails, automations return `null` and
callers should use deterministic local fallbacks (see `deriveTitleFromInstructionText`).

When enabled, mission and objective titles are refined asynchronously with Gemini
after an immediate local title is set. Title updates stream through the
`entity_changes` feed so the web board refreshes live.

## For Developers

### Contract Component

Maps to the **Automations Layer** (`automations`) in [`contract/architecture.md`](../contract/architecture.md), which owns:

- The `Automation` interface and built-in automation registry
- OpenRouter provider configuration (`OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`)
- Reference summarization automations
- Fire-and-forget helpers that persist results through caller-supplied store interfaces

It does **not** own database schema, mission/objective lifecycle, or agent protocol
behavior.

### Documentation

- [01 — Automations Overview](docs/01-automations-overview.md): automation model, OpenRouter setup, and extension guide
- [Test Plan](docs/testing.md): unit coverage for title derivation, fallbacks, and registry behavior

### Code & Tests

Implementation lives under [`src/`](src):

- `types.ts` — shared `Automation` interface
- `registry.ts` — built-in automation catalog and registration hook for new automations
- `title-summarizer/` — self-contained reference automation (provider config, tools, helpers, persistence helpers)

Inside `title-summarizer/`:

- `config.ts` / `gemini-client.ts` — OpenRouter provider configuration and client lifecycle
- `tools/summarize-text.ts` — generic Gemini summarization
- `tools/summarize-objective-title.ts` — mission-style objective title summarization
- `objectives/generate-objective-title.ts` — `generateObjectiveTitle` and `generateAndSetObjectiveTitle`
- `helpers/title.ts` — deterministic local title derivation

Colocated tests:

- `src/title-summarizer/helpers/title.test.ts`
- `src/title-summarizer/objectives/generate-objective-title.test.ts`
- `src/registry.test.ts`

### Interaction Boundaries

Other components consume automations only through the `@overlord/automations` package API.
Persistence must go through injected callbacks such as `ObjectiveTitleStore`; the
module must not read or write domain tables directly.

Google model defaults are unchanged: `google/gemini-3.5-flash-lite` for automations,
`google/gemini-3.8-flash` for chat. Bare model ids are accepted. Chat uses
`CHAT_OPENROUTER_API_KEY` (falls back to `OPENROUTER_API_KEY`) and optional
`CHAT_OPENROUTER_MODEL`. Existing Gemini-named JavaScript helpers remain compatible;
Google credentials are no longer used. Google explicit caching is retired; prompts
and authorized tool schemas are sent inline. The server transport lives in
`src/openrouter/` and must not be imported by browser code.
