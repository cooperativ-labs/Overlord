# AI Code Assistant Hooks Research

## Executive Summary

Only Claude Code and Codex CLI currently expose hooks that map cleanly to both of the requested lifecycle points:

1. a hook when the user submits a prompt
2. a hook when the agent finishes responding to that prompt

Cursor CLI does not appear to expose that full lifecycle today. Cursor staff state that CLI hook support is currently limited to shell-execution hooks, while broader hook support is still in development. Cursor does have separate background-agent webhooks, but those are not the same thing as prompt-submission or response-completion hooks in the CLI.

Cursor’s official hooks docs and marketplace listings do show agent-loop hooks such as `beforeSubmitPrompt`, `stop`, and `sessionStart`. So Cursor does have a hooks system for the agent loop in the product overall; the limitation is specifically the CLI surface, which is still partial.

## Findings Matrix

| Tool | Hook on user-submitted message? | Hook on completed response? | Notes |
| --- | --- | --- | --- |
| Claude Code | Yes | Yes | `UserPromptSubmit` fires when the user submits a prompt. `Stop` fires when Claude finishes responding. |
| Codex CLI | Yes | Yes | `UserPromptSubmit` is present, and `Stop` is the completion hook. Current runtime evidence also shows hooks loaded from `hooks.json` are `SessionStart`, `UserPromptSubmit`, and `Stop`. |
| Cursor CLI | Partial / not confirmed in CLI | Partial / not confirmed in CLI | Cursor’s broader hooks system includes `beforeSubmitPrompt` and `stop`, but official CLI guidance says CLI support is still limited to `beforeShellExecution` and `afterShellExecution` today. |

## Claude Code

Claude Code has the clearest and most complete hook surface of the three for this question.

- `UserPromptSubmit` runs when the user submits a prompt, before Claude processes it.
- `Stop` runs when Claude finishes responding.

That means Claude Code has:

- a hook for a user-submitted message: **yes**
- a hook for a completed response from the agent: **yes**

Relevant documentation:

- https://code.claude.com/docs/en/hooks

## Codex CLI

Codex CLI also has the requested lifecycle hooks.

Evidence from current Codex sources shows:

- `UserPromptSubmit` is used as a hook event.
- `Stop` is used as the hook that runs when the turn ends normally.
- The current hooks discovery path cited in the Codex repo issue only loads `SessionStart`, `UserPromptSubmit`, and `Stop` from `hooks.json`.

There is also a separate gap in Codex today: `AfterToolUse` is not exposed through `hooks.json` yet. That does not affect the answer to this ticket, but it confirms the lifecycle surface is narrower than Claude Code’s.

That means Codex CLI has:

- a hook for a user-submitted message: **yes**
- a hook for a completed response from the agent: **yes**

Relevant sources:

- https://github.com/openai/codex/issues/15497
- https://github.com/openai/codex/issues/15490

## Cursor CLI

Cursor CLI is the outlier.

Cursor staff explicitly state that, as of the current CLI state, only these hooks are supported:

- `beforeShellExecution`
- `afterShellExecution`

They also say full support for all hook events, like the IDE has, is still in development and there is no ETA.

At the same time, Cursor’s own hooks pages and marketplace listings show the broader agent-loop hook model:

- `beforeSubmitPrompt`
- `stop`
- `sessionStart`
- `afterAgentResponse`

That means the product-level hooks surface exists, but the CLI subset is narrower and not yet equal to the IDE surface.

So for Cursor CLI:

- a hook for a user-submitted message: **no evidence in the current CLI**
- a hook for a completed response from the agent: **no evidence in the current CLI**

Important distinction:

- Cursor does have **background-agent webhooks** for status changes.
- Those webhooks only report `statusChange` events for background agents reaching `ERROR` or `FINISHED`.
- That is not the same as a CLI lifecycle hook for prompt submission or agent completion.

Relevant sources:

- https://cursor.com/docs/hooks
- https://forum.cursor.com/t/cursor-cli-doesnt-send-all-events-defined-in-hooks/148316/7
- https://docs.cursor.com/background-agent/api/webhooks
- https://cursor.com/blog/hooks-partners

## Recommendation

If the goal is a local hook that can observe both prompt submission and agent completion in the CLI:

1. Claude Code is supported today.
2. Codex CLI is supported today.
3. Cursor CLI is not yet at parity for those lifecycle hooks.

If you want, I can turn this into a smaller decision memo or a comparison table for the team wiki.
