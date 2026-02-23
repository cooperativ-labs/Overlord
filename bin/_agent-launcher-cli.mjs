#!/usr/bin/env node

/**
 * Overlord Agent Launcher CLI (shared implementation)
 *
 * This file is invoked via small wrappers (e.g. bin/ovld.mjs, bin/coop.mjs)
 * so we can keep a single implementation while supporting multiple command
 * aliases.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";

export async function runAgentLauncherCli({ primaryCommand }) {
  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  const PLATFORM_URL = process.env.PLATFORM_URL;
  const AGENT_TOKEN = process.env.AGENT_TOKEN;
  const TICKET_ID = process.env.TICKET_ID;

  function requireEnv() {
    const missing = [];
    if (!PLATFORM_URL) missing.push("PLATFORM_URL");
    if (!AGENT_TOKEN) missing.push("AGENT_TOKEN");
    if (!TICKET_ID) missing.push("TICKET_ID");

    if (missing.length > 0) {
      console.error(`Missing required environment variables: ${missing.join(", ")}`);
      console.error(
        "\nSet them before running, e.g.:\n" +
          `  PLATFORM_URL=http://localhost:3000 AGENT_TOKEN=... TICKET_ID=... ${primaryCommand} run claude`
      );
      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch context
  // ---------------------------------------------------------------------------

  async function fetchContext() {
    const url = `${PLATFORM_URL}/api/protocol/context/${TICKET_ID}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ticket context (${response.status}): ${await response.text()}`
      );
    }

    return response.text();
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async function runAgent(agent, mode = "run") {
    if (!agent || !["claude", "codex"].includes(agent)) {
      console.error(
        `Usage: ${primaryCommand} run <agent> | ${primaryCommand} resume <agent>  (agent must be "claude" or "codex")`
      );
      process.exit(1);
    }

    const context = await fetchContext();

    try {
      if (agent === "claude") {
        if (mode === "resume") {
          const claudeSessionId = process.env.CLAUDE_SESSION_ID?.trim();
          const args = claudeSessionId
            ? ["--resume", claudeSessionId, context]
            : ["--continue", context];
          execFileSync("claude", args, { stdio: "inherit", env: process.env });
        } else {
          execFileSync(
            "claude",
            [
              "--append-system-prompt",
              context,
              "Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt.",
            ],
            { stdio: "inherit", env: process.env }
          );
        }
      } else {
        if (mode === "resume") {
          const codexSessionId = process.env.CODEX_SESSION_ID?.trim();
          const args = codexSessionId
            ? ["resume", codexSessionId, context]
            : ["resume", "--last", context];
          execFileSync("codex", args, { stdio: "inherit", env: process.env });
        } else {
          execFileSync("codex", [context], {
            stdio: "inherit",
            env: process.env,
          });
        }
      }
    } catch (error) {
      const isResume = mode === "resume";
      const noSessionHint =
        agent === "claude"
          ? `No prior Claude session was found for this workspace. Start one with \`${primaryCommand} run claude\` first.`
          : `No prior Codex session was found for this workspace. Start one with \`${primaryCommand} run codex\` first.`;
      const message = error instanceof Error ? error.message : String(error);

      if (isResume) {
        console.error(`${message}\n${noSessionHint}`);
      } else {
        console.error(message);
      }
      process.exit(1);
    }
  }

  async function printContext() {
    const context = await fetchContext();
    process.stdout.write(context);
  }

  function printHelp() {
    console.log(`Overlord Agent Launcher

Primary command:
  ${primaryCommand}

Aliases (compat):
  coop, overlord, cooperativ

Usage:
  ${primaryCommand} run <agent>       Launch an agent (claude or codex)
  ${primaryCommand} resume <agent>    Resume using native agent resume commands
  ${primaryCommand} context           Print the ticket context to stdout
  ${primaryCommand} help              Show this help message

Environment variables (required for now):
  PLATFORM_URL           Base URL of the Overlord platform
  AGENT_TOKEN            Bearer token for the protocol API
  TICKET_ID              UUID of the ticket to work on

Examples:
  # Launch Claude Code on a ticket
  PLATFORM_URL=http://localhost:3000 \\
  AGENT_TOKEN=my-token \\
  TICKET_ID=abc-123 \\
  ${primaryCommand} run claude

  # Resume latest Claude session for this workspace with fresh ticket context
  PLATFORM_URL=http://localhost:3000 \\
  AGENT_TOKEN=my-token \\
  TICKET_ID=abc-123 \\
  ${primaryCommand} resume claude

  # Resume a specific native session id
  PLATFORM_URL=http://localhost:3000 \\
  AGENT_TOKEN=my-token \\
  TICKET_ID=abc-123 \\
  CLAUDE_SESSION_ID=<session-id> \\
  ${primaryCommand} resume claude

  # Pipe ticket context to another tool
  ${primaryCommand} context | pbcopy
`);
  }

  // ---------------------------------------------------------------------------
  // Main
  // ---------------------------------------------------------------------------

  async function main() {
    const [command, ...args] = process.argv.slice(2);

    if (!command || command === "help" || command === "--help") {
      printHelp();
      return;
    }

    requireEnv();

    if (command === "run") {
      await runAgent(args[0]);
      return;
    }

    if (command === "resume") {
      await runAgent(args[0], "resume");
      return;
    }

    if (command === "context") {
      await printContext();
      return;
    }

    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
  }

  await main();
}

