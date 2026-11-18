# Automations Overview

Plan for the Open Overlord automations module. This document is the reference spec for
contract component `automations`.

## Goals

- Give developers a small, explicit interface for optional AI automations.
- Ship a reference Gemini summarization tool patterned on upstream Overlord's
  `generate-mission-title.ts`.
- Show how service-layer callers wire automations through injected persistence
  callbacks, matching upstream `generateAndSetObjectiveTitle` in `objectives.ts`.

## Automation Model

Every automation implements `Automation<TInput, TOutput>`:

```ts
type Automation<TInput, TOutput> = {
  id: string;
  label: string;
  description: string;
  run: (params: { input: TInput; context?: AutomationRunContext }) => Promise<TOutput | null>;
};
```

Built-in automations register in `automations/src/registry.ts`. Callers can also register
custom automations with `registerAutomation` during module initialization.

## Package Entry Points

| Import path                               | Safe for browser SPA?    | Contents                                                                      |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `@overlord/automations`                   | No (pulls Gemini client) | Full barrel: registry, title summarizer, objective-manager, scheduling-engine |
| `@overlord/automations/objective-manager` | Yes                      | Pure objective lifecycle helpers (`deriveObjectiveLifecycleView`, etc.)       |
| `@overlord/automations/scheduling-engine` | Yes                      | Schedule date generation and schedule types                                   |

Browser / Electron renderer code must use the subpath exports when it only needs lifecycle or
scheduling helpers so Vite does not bundle the server-only OpenRouter transport into the SPA.

## Built-In Automations

| Automation ID      | Purpose                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summarize-text`   | Generic Gemini summarization with optional length cap                                                                                                                                        |
| `compose-delivery` | Schema-constrained Gemini polish of delivery Markdown + structured callouts; the backend worker logs bounded queued/composed/fallback/failed timing and model metrics without prompt content |

Both summarization automations and `compose-delivery` return `null` when `OPENROUTER_API_KEY` is unset or the provider call fails.

## Shared Writing Rules

`src/writing/ste.ts` holds the STE-inspired writing rules for model-written text that people read.

- `WRITING_RULES` is the base profile. `compose-delivery` uses it unchanged; a test pins its
  text, so editing it is a deliberate change to that composer. No automation writes mission
  headlines or summaries: ADR 0076 removed `compose-mission-summary`, and only agents author
  mission narrative.
- `OBJECTIVE_WRITING_RULES` extends it for objective titles and summaries only: "must"/"can"
  instead of ambiguous modals, condition before command, `CAUTION:` before the step, no
  contractions or semicolons, the confidence vocabulary ("probably … because …", "It is possible
  that …", "X is not known") and the ambiguity vocabulary ("The instructions do not say …",
  "Decision needed: A or B").
- `lintSte(text)` is an advisory heuristic checker (sentence length, ambiguous modals with a
  suggested replacement, contractions, semicolons, stacked or unsupported hedges, passive voice).
  It ignores code spans, quoted text, URLs and paths. It does not prove ASD-STE100 compliance.

## Objective Brief Automation

`composeObjectiveBrief({ instructionText, fields: { title, description } })` writes an
objective's generated title and/or summary in one provider call (ADR 0058). It never touches the
database; `backend/objective-brief-compose-worker.ts` publishes its results through the core
service guards.

1. The instructions are sent as a JSON string value and declared to be data, not commands.
2. The model returns schema v1: `title` and/or `description { goal, decisionsNeeded[], body[],
   doneWhen, doneWhenStated }`, only for the requested fields.
3. The server assembles 1–3 plain-prose paragraphs: the goal first, each `Decision needed:`
   sentence after it, then the body, then the done-when sentence. When the instructions state no
   completion test, the fixed sentence "The instructions do not say how to confirm that the work
   is complete." is used. Headings, lists, HTML and control characters are removed.
4. Fidelity checks: every identifier-like token (code span, path, file name, flag, URL, display
   id, environment variable) must appear verbatim in the instructions, and a summary of
   instructions with a prohibition must keep a negation.
5. Invalid or unfaithful output, or a style issue other than passive voice, asks for one rewrite
   with the problems quoted. The best valid candidate wins; with none, the field fails with
   `invalid_output` or `unfaithful_output` and people keep reading the instructions.
6. Returns `provider_unavailable` without a provider and `provider_error` (no provider text) when
   the first call fails or times out (45 s). Input is bounded to 40,000 characters (longer text
   gets a title only), output to 1,200 tokens.

Deterministic fixtures in `src/objective-brief/fixtures/fidelity.json` run in `yarn test`.
`src/objective-brief/objective-brief.live-eval.ts` runs the same instructions against the
configured provider and prints the checked properties; it is manual because it costs provider
calls.

## Objective Title Automation

Objective titles are written by the objective brief automation through the backend worker. The
helpers below remain for mission titles and for callers outside the worker.

`generateObjectiveTitle` mirrors upstream behavior:

1. Trim instruction text; return empty for blank input.
2. For text at or below `AI_TITLE_THRESHOLD` (100 chars), derive locally via `deriveTitleFromInstructionText`.
3. For longer text, optionally call Gemini when `aiTitleGenerationEnabled` is true.
4. Fall back to local derivation when Gemini is unavailable.

`generateAndSetObjectiveTitle` wraps the same logic and persists through an injected
`ObjectiveTitleStore` so the automations module stays decoupled from Kysely/Supabase.

Example caller wiring:

```ts
import { generateAndSetObjectiveTitle } from '@overlord/automations';

void generateAndSetObjectiveTitle({
  store: {
    updateObjectiveTitle: async ({ objectiveId, title }) => {
      await db
        .updateTable('objectives')
        .set({ title, updated_at: new Date().toISOString() })
        .where('id', '=', objectiveId)
        .execute();
    }
  },
  objectiveId,
  instructionText,
  aiTitleGenerationEnabled: true
});
```

## Configuration

Environment variables (see [`.env.local.example`](../../.env.local.example) and [`.env.prod.example`](../../.env.prod.example)):

| Variable                      | Required | Default                 | Purpose                                                                                                                |
| ----------------------------- | -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`              | No       | —                       | Enables Gemini-backed automations when set                                                                             |
| `OPENROUTER_MODEL`                | No       | `gemini-3.5-flash-lite` | Model identifier for summarization calls                                                                               |
| `OVERLORD_AUTOMATIONS_MODULE` | No       | —                       | Comma-separated downstream automation bundle(s) loaded at boot (see [Downstream Automations](#downstream-automations)) |

## Layout

Each automation is self-contained in its own folder under `automations/src/`. The reference
`title-summarizer` automation owns its Gemini client, helpers, tools, and objective title
persistence helpers. Shared module code (`types.ts`, `registry.ts`, `index.ts`) stays at the
`automations/src/` root.

## Extension Guidelines

1. Add new automations as folders under `automations/src/<automation-name>/`.
2. Keep provider clients inside the automation folder (do not leak the server-only OpenRouter transport into other modules).
3. Document any new secrets in `.env.local.example` and `.env.prod.example`.
4. Never import database adapters from automations — pass store interfaces from callers.

## Downstream Automations

The `custom-automation` extension point lets a repo that tracks OpenOverlord
upstream register its own automations **without editing this module**, so those
edits never collide with upstream changes on merge.

- Build a small module that calls `registerAutomation` / `registerAutomations`
  (re-exported from `@overlord/automations`) at import time.
- Point `OVERLORD_AUTOMATIONS_MODULE` at it (comma-separated package names or
  paths for more than one). The server imports each module for its side effects
  at boot via `loadExternalAutomations()` and logs the ids it registered.

```ts
// @your-org/overlord-automations — loaded only when the env var points at it.
import { registerAutomations } from '@overlord/automations';

registerAutomations([
  { id: 'acme:triage', label: 'Triage', description: '…', run: async () => null }
]);
```

Do **not** add downstream automations to `builtInAutomations` in
`registry.ts` — that array is upstream-owned and the env-var seam exists
precisely to keep it conflict-free.
