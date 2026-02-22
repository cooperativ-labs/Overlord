#!/usr/bin/env node

/**
 * Overlord Agent Launcher CLI
 *
 * Fetches ticket context from the Overlord platform and launches an AI agent
 * (Claude Code or Codex) with the correct environment and prompt.
 *
 * Usage:
 *   coop run <agent>           Launch an agent (claude or codex)
 *   coop context               Print the ticket context to stdout
 *   coop help                  Show this help message
 *
 * Environment variables (required):
 *   PLATFORM_URL               Base URL of the Overlord platform
 *   AGENT_TOKEN                Bearer token for the protocol API
 *   TICKET_ID                  UUID of the ticket to work on
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

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
      "\nSet them before running coop, e.g.:\n" +
        "  PLATFORM_URL=http://localhost:3000 AGENT_TOKEN=... TICKET_ID=... coop run claude"
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

async function runAgent(agent) {
  if (!agent || !["claude", "codex"].includes(agent)) {
    console.error('Usage: coop run <agent>  (agent must be "claude" or "codex")');
    process.exit(1);
  }

  const context = await fetchContext();

  // Write context to a temp file so we avoid shell quoting issues
  const contextFile = join(
    tmpdir(),
    `overlord-ctx-${TICKET_ID.slice(-8)}-${Date.now()}.md`
  );
  writeFileSync(contextFile, context, "utf-8");

  const cleanup = () => {
    try {
      unlinkSync(contextFile);
    } catch {
      // Already deleted — ignore
    }
  };

  // Clean up on exit
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  try {
    if (agent === "claude") {
      execFileSync(
        "claude",
        [
          "--append-system-prompt",
          context,
          "Begin working on this ticket. Start by calling the attach endpoint, then proceed with the objective described in your system prompt.",
        ],
        { stdio: "inherit", env: process.env }
      );
    } else {
      execFileSync("codex", [context], {
        stdio: "inherit",
        env: process.env,
      });
    }
  } finally {
    cleanup();
  }
}

async function printContext() {
  const context = await fetchContext();
  process.stdout.write(context);
}

function printHelp() {
  console.log(`Overlord Agent Launcher

Usage:
  coop run <agent>       Launch an agent (claude or codex)
  coop context           Print the ticket context to stdout
  coop help              Show this help message

Environment variables (required):
  PLATFORM_URL           Base URL of the Overlord platform
  AGENT_TOKEN            Bearer token for the protocol API
  TICKET_ID              UUID of the ticket to work on

Examples:
  # Launch Claude Code on a ticket
  PLATFORM_URL=http://localhost:3000 \\
  AGENT_TOKEN=my-token \\
  TICKET_ID=abc-123 \\
  coop run claude

  # Pipe ticket context to another tool
  coop context | pbcopy
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

  if (command === "context") {
    await printContext();
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
