import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CLAUDE_HOOKS_SERVER, isClaudePluginEnabled } from './claude-hook-health.js';

/**
 * The fail-closed Claude Code decision hook, registered per launch.
 *
 * `PermissionRequest` is the only Overlord Claude hook with `onFailure: "block"`: if the harness
 * cannot get an answer from the local hooks server (server not connected, tool error, timeout,
 * invalid output), Claude Code denies the request instead of approving it. It is deliberately NOT
 * in the plugin's static `hooks/hooks.json`. Plugin hooks run in every Claude Code session on the
 * machine, so a fail-closed hook there would turn any local fault (no `node`, the server disabled
 * in `/mcp`, `ovld` uninstalled) into a machine-wide denial of every permission prompt, including
 * in sessions Overlord never touched (planning/feature-plans/claude-mcp-tool-hooks.md §4.2).
 *
 * `ovld launch` therefore passes this registration through `claude --settings` only for sessions
 * it launched with a session channel, and only after checking that the plugin and its hooks
 * server are installed. Every no-decision outcome inside the tool (unbound, unresolved, backend
 * error, internal deadline) answers `{}`, which leaves Claude's native prompt in place; only the
 * harness → local-tool hop failing denies. No failure can manufacture an approval.
 */

export const CLAUDE_DECISION_HOOK_TOOL = 'overlord_hook_permission_request';
/** Hook timeout. The tool answers `{}` 5 s before it, so a slow backend degrades to the prompt. */
export const CLAUDE_DECISION_HOOK_TIMEOUT_SECONDS = 300;

/** The `--settings` JSON that registers the decision hook for one launched Claude session. */
export function claudeDecisionHookSettings(): {
  hooks: { PermissionRequest: Array<{ matcher: string; hooks: Array<Record<string, unknown>> }> };
} {
  return {
    hooks: {
      PermissionRequest: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'mcp_tool',
              server: CLAUDE_HOOKS_SERVER,
              tool: CLAUDE_DECISION_HOOK_TOOL,
              // `transcript_path` and `permission_suggestions` are never templated: paths and
              // suggestions must not cross the privacy boundary.
              input: {
                hook_event_name: '${hook_event_name}',
                session_id: '${session_id}',
                cwd: '${cwd}',
                permission_mode: '${permission_mode}',
                tool_name: '${tool_name}',
                tool_input: '${tool_input}',
                hookTimeoutSeconds: CLAUDE_DECISION_HOOK_TIMEOUT_SECONDS
              },
              onFailure: 'block',
              timeout: CLAUDE_DECISION_HOOK_TIMEOUT_SECONDS
            }
          ]
        }
      ]
    }
  };
}

/** Claude's config dir as the launched `claude` process will resolve it. */
export function claudeConfigDir({
  env = process.env,
  home = os.homedir()
}: {
  env?: NodeJS.ProcessEnv;
  home?: string;
} = {}): string {
  const override = env.CLAUDE_CONFIG_DIR?.trim();
  return override ? path.resolve(override) : path.join(home, '.claude');
}

/**
 * Whether the hooks server the decision hook calls is installed: the Overlord plugin is enabled
 * and the installed plugin declares `overlord-hooks`. File checks only, so launch stays fast;
 * `ovld doctor` performs the live connection check.
 */
export function claudeDecisionHookAvailability({
  configDir,
  ovldHome
}: {
  configDir: string;
  /** Home that holds `.ovld/connectors/claude.json` (the setup install record). */
  ovldHome: string;
}): { available: true } | { available: false; reason: string } {
  if (!isClaudePluginEnabled(configDir)) {
    return {
      available: false,
      reason: `the Overlord Claude plugin is not enabled in ${configDir}`
    };
  }
  let installPath: string | null = null;
  try {
    const state = JSON.parse(
      readFileSync(path.join(ovldHome, '.ovld', 'connectors', 'claude.json'), 'utf8')
    ) as { installPath?: unknown };
    installPath = typeof state.installPath === 'string' ? state.installPath : null;
  } catch {
    installPath = null;
  }
  const mcpConfigPath = installPath ? path.join(installPath, '.mcp.json') : null;
  let declaresServer = false;
  if (mcpConfigPath && existsSync(mcpConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(mcpConfigPath, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
      declaresServer = Boolean(config.mcpServers?.['overlord-hooks']);
    } catch {
      declaresServer = false;
    }
  }
  if (!declaresServer) {
    return {
      available: false,
      reason: 'the installed Overlord Claude plugin has no overlord-hooks server'
    };
  }
  return { available: true };
}

/** Warning printed when a channel-bound Claude launch cannot register the decision hook. */
export function claudeDecisionHookSkippedWarning(reason: string): string {
  return (
    `Remote permission decisions are off for this Claude session because ${reason}. ` +
    'Claude will show its own permission prompts. Run `ovld agent-setup claude` and ' +
    '`ovld doctor` to fix it.'
  );
}
