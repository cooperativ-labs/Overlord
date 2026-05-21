# Implementation Plan - Reinstating Desktop Agent Launching over SSH

This plan restores the desktop app's ability to launch AI coding agents in a local terminal window while executing the agent on a remote machine over standard SSH.

The implementation must cover the full launch path, not just the Electron main process:

1. The renderer must allow Electron projects to select the SSH workspace.
2. Every Electron launch callsite must pass SSH launch fields into IPC.
3. Electron IPC must distinguish local terminal preferences from remote server multiplexer preferences.
4. The Electron launcher must run remote commands without local working-directory validation.
5. The behavior must stay aligned with the existing `ovld launch --ssh-command ... --remote-working-directory ...` CLI surface.
6. Connector parity docs and tests must be updated so this does not drift again.

## Goals

- Launch Claude Code, Codex, Cursor, Antigravity, OpenCode, and Pi from the desktop app into the user's local terminal app while running the agent remotely over SSH.
- Use system SSH rather than `ssh2`, tunnels, or filesystem mounts.
- Allocate an interactive TTY for remote agent CLIs.
- Transfer prompt context safely without requiring synchronized temporary files on the remote machine.
- Support optional remote tmux wrapping from the existing server terminal settings.
- Preserve the existing direct Electron local launch path for non-SSH projects.
- Keep desktop SSH behavior consistent with the existing CLI SSH launch behavior.

## Non-Goals

- Do not add a persistent remote daemon, tunnel, or mounted remote filesystem.
- Do not delegate local Electron launches to `ovld launch`; local desktop launches should continue to use the direct main-process path.
- Do not change protocol operation surfaces. This is a launch-path change, not a new API/CLI/MCP protocol operation.
- Do not require a local project directory to exist for remote-only launches.

## Current Gaps to Address

- [useWorkspacePreference.ts](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/projects/useWorkspacePreference.ts) currently forces Electron to `local` and nulls `effectiveSshCommand` / `effectiveRemoteWorkingDirectory`.
- Renderer launch callsites such as [AgentSplitButton.tsx](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/AgentSplitButton.tsx) and [FeedPostDiscussPanel.tsx](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/feed/FeedPostDiscussPanel.tsx) do not pass SSH fields to `launchAgent()`.
- [agent-launcher.ts](file:///Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts) validates `resolvedCwd` locally, which would break remote-only launches or projects whose local path is missing.
- The original plan risked duplicating logic already present in [launcher.mjs](file:///Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs) instead of aligning desktop behavior with the CLI SSH path.
- The verification plan needs renderer payload tests and negative remote cases, not just TypeScript plus a manual happy path.

## Implementation Steps

### 1. Shared SSH Shell Utilities

Add shared shell helpers for SSH launch construction. Prefer a location that both Electron and CLI code can consume without web bundling surprises, such as [lib/ssh/shell-utils.ts](file:///Users/jake/Development/Cooperativ/Overlord/lib/ssh/shell-utils.ts) plus any needed Node-compatible entrypoint.

Implement:

- `parseShellCommand(command: string): string[]`
  - Tokenizes shell-like command strings while respecting single quotes, double quotes, and backslash escapes.
  - Used for user-provided SSH commands such as `ssh -i ~/.ssh/key user@host`.
- `parseSshCommand(command: string, options?: { forceTty?: boolean }): string[]`
  - Parses the SSH command.
  - Injects `-tt` when `forceTty` is true and no equivalent TTY option is already present.
  - Preserves existing user SSH options.
- `shellEscape(value: string): string`
  - Escapes values for safe use in POSIX shell snippets.
- `buildRemoteTmuxCommand(innerCommand: string, tmuxCommand?: string | null): string`
  - Uses the configured `{script}` template when present.
  - Falls back to `tmux new-session bash {script}`.

Use these helpers to avoid creating one SSH quoting dialect in Electron and another in the CLI.

### 2. Renderer Workspace Selection

Update [useWorkspacePreference.ts](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/projects/useWorkspacePreference.ts).

- Remove the Electron-specific branches that force `executionWorkspace: 'local'`.
- Let Electron use `resolveExecutionWorkspace()` like the web app.
- Keep fallback behavior: if the selected workspace is SSH but no valid `sshCommand` exists, resolve back to local when available.
- Return `effectiveWorkingDirectory` only for the local workspace.
- Return `effectiveSshCommand` and `effectiveRemoteWorkingDirectory` only for the SSH workspace.
- Update comments that currently state Desktop does not support SSH execution.

Expected outcome: Electron-rendered project, ticket, and feed surfaces can see the active SSH workspace preference.

### 3. Renderer Launch Payload Plumbing

Audit every renderer call to `launchAgent()` and pass the effective workspace fields where available.

Primary files:

- [AgentSplitButton.tsx](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/AgentSplitButton.tsx)
- [FeedPostDiscussPanel.tsx](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/feed/FeedPostDiscussPanel.tsx)
- [QuickTaskBar.tsx](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/QuickTaskBar.tsx)
- [QuickRunModal.tsx](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/QuickRunModal.tsx)
- [AutoAdvanceLauncher.tsx](file:///Users/jake/Development/Cooperativ/Overlord/apps/web/components/features/terminal/AutoAdvanceLauncher.tsx)

For each callsite:

- Pass `cwd` only when the effective workspace is local.
- Pass `sshCommand` and `remoteWorkingDirectory` only when the effective workspace is SSH.
- Preserve existing fields: `ticketId`, `agent`, `organizationId`, `projectId`, `launchMode`, `flags`, `model`, `thinking`, `feedPostId`, and `initialQuestion`.
- Do not infer SSH settings inside Electron IPC if the renderer already has the resolved project preference. IPC should receive explicit launch intent.

Expected outcome: the new IPC fields are exercised by the UI paths that actually launch agents.

### 4. Electron IPC and Server Terminal Settings

Update [terminal.ts](file:///Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/ipc/terminal.ts), [preload.ts](file:///Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/preload.ts), and [electron.d.ts](file:///Users/jake/Development/Cooperativ/Overlord/types/electron.d.ts).

Payload changes:

- Add `sshCommand?: string`.
- Add `remoteWorkingDirectory?: string`.

Settings behavior:

- Keep local terminal app selection in `getLocalTerminalSettingsProfile()`.
- Add `getServerMultiplexerConfig()` that reads existing `serverExternalTerminal*` settings.
- Use `serverExternalTerminalApp` to decide whether a remote server multiplexer is enabled.
- Use `serverExternalTerminalTmuxCommand` as the remote tmux template.
- Pass the resolved server multiplexer config into `prepareAgentLaunch()`.

Important distinction:

- The local terminal settings decide which macOS terminal opens the generated wrapper script.
- The server terminal settings decide whether the command inside the SSH session is wrapped in remote tmux.

Expected outcome: choosing a local terminal app does not accidentally control remote tmux behavior, and remote tmux settings do not affect the local terminal window.

### 5. Electron Launcher Remote Execution

Update [agent-launcher.ts](file:///Users/jake/Development/Cooperativ/Overlord/apps/desktop/electron/services/agent-launcher.ts).

Input changes:

- Add `sshCommand?: string`.
- Add `remoteWorkingDirectory?: string`.
- Add `serverMultiplexer?: { enabled: boolean; tmuxCommand?: string | null }`.

Context URL changes:

- Extend `buildAgentContextUrl()` to accept `workspace?: 'ssh'`.
- When `sshCommand` is present, request context with `workspace=ssh`.
- Preserve existing `context=electron`, `agent`, `instructionMode`, `sessionId`, `mode=ask`, `feedPostId`, and `initialQuestion` behavior.

Remote cwd behavior:

- Treat `input.remoteWorkingDirectory` as the preferred remote cwd.
- If it is absent, use `X-Working-Directory` from the context response only as a remote cwd fallback.
- Never use a remote cwd as the local `cwd` returned to `terminal.ts`.
- Skip `describeLocalCwdProblem()` for remote launches.
- Continue local cwd preflight checks for local launches.

Remote command construction:

- Fetch context in the Electron main process as it does today.
- Build the same agent-specific command shape used for local launches, including model, thinking, flags, bundle/plugin mode, and Codex expect handling where applicable.
- For remote launches, create a remote shell script that:
  - sets `OVERLORD_URL`, `OVERLORD_CONNECTOR_URL`, `OVERLORD_ACCESS_TOKEN`, `OVERLORD_ORGANIZATION_ID`, `TICKET_ID`, `AGENT_IDENTIFIER`, model env vars, `OVERLORD_LOCAL_SECRET`, and `OVERLORD_LAUNCH_SESSION_ID`;
  - writes the fetched context markdown to a remote `mktemp` file via base64 decoding;
  - registers a `trap` to remove the remote context file;
  - sources standard profile/PATH locations and NVM before invoking the agent;
  - changes to the remote working directory when configured;
  - runs the agent command with the remote context file or context text as appropriate.
- Wrap the remote command with the configured server tmux template when enabled.
- Wrap the final remote command in parsed SSH args with forced TTY allocation.
- Return the SSH wrapper command to `terminal.ts` with no local `cwd`.

Expected outcome: local launches keep current behavior, while SSH launches open a local terminal that immediately starts an interactive remote agent session.

### 6. CLI Parity

Review [launcher.mjs](file:///Users/jake/Development/Cooperativ/Overlord/packages/overlord-cli/bin/_cli/launcher.mjs) while implementing Electron SSH support.

- Reuse shared SSH parsing, escaping, TTY injection, and tmux helpers where practical.
- Keep `ovld launch --ssh-command`, `--remote-working-directory`, `--server-multiplexer`, and `--tmux-command` behavior compatible.
- If Electron intentionally differs from CLI behavior, document why in [CONNECTOR_SURFACES.md](file:///Users/jake/Development/Cooperativ/Overlord/ai/guidence/CONNECTOR_SURFACES.md).
- Do not regress copy/paste launch commands built by [launch-commands.ts](file:///Users/jake/Development/Cooperativ/Overlord/lib/overlord/launch-commands.ts).

Expected outcome: users get the same remote launch semantics whether they click Launch Agent in Desktop or copy an `ovld launch ... --ssh-command ...` command.

### 7. Connector Parity Documentation

Update [CONNECTOR_SURFACES.md](file:///Users/jake/Development/Cooperativ/Overlord/ai/guidence/CONNECTOR_SURFACES.md) after code changes.

Document:

- Desktop local launches remain direct Electron main-process launches.
- Desktop SSH launches wrap a remote command over system SSH from the Electron main process.
- CLI SSH launches remain the copy/paste and terminal-native remote launch surface.
- The shared SSH helper file, if added.
- Any deliberate agent asymmetries, especially Antigravity model/thinking flags.

No protocol matrix change is needed unless the implementation changes protocol operation parameters or adds a new operation.

## Verification Plan

### Automated Checks

- Unit-test `parseShellCommand()` with quotes, escaped spaces, empty strings, and malformed quoting.
- Unit-test `parseSshCommand()` with plain `ssh host`, existing `-t`, existing `-tt`, `-o` options, `-i` keys, ports, and forced TTY injection.
- Unit-test shell escaping and remote tmux wrapping.
- Unit-test `buildAgentContextUrl()` includes `workspace=ssh` only for remote launches.
- Unit-test `prepareAgentLaunch()` remote behavior with mocked context responses:
  - no local cwd validation;
  - no returned local `cwd`;
  - remote cwd from input;
  - remote cwd fallback from `X-Working-Directory`;
  - generated SSH command contains forced TTY allocation.
- Add renderer tests for Electron SSH workspace resolution.
- Add renderer tests that at least ticket launch and feed discuss pass `sshCommand` / `remoteWorkingDirectory` to `launchAgent()` when SSH workspace is active.
- Run the relevant TypeScript checks for web and desktop code.

### Manual Checks

- Local desktop launch still works for Claude and Codex.
- Desktop SSH launch works with `ssh localhost` and a valid remote directory.
- Desktop SSH launch works when the local project directory is missing but `remoteWorkingDirectory` is valid.
- Desktop SSH launch displays a useful failure when SSH authentication fails.
- Remote tmux launch uses `serverExternalTerminalTmuxCommand`.
- Local terminal selection still controls which macOS terminal opens.
- Copy/paste `ovld launch --ssh-command ... --remote-working-directory ...` still works after any shared helper changes.

## Rollout Notes

- Keep the first implementation focused on SSH terminal launching only.
- Ship with conservative error messages for missing SSH command, missing remote directory, failed SSH auth, and missing remote agent CLI.
- If users need remote file browsing or remote git operations later, handle that as a separate feature; this plan only restores agent launch over SSH.
