#!/usr/bin/env node

/**
 * verify-agent-permissions.mjs
 *
 * Validates that all required Overlord protocol permissions are present
 * in the agent's configuration file.
 *
 * Usage:
 *   node scripts/verify-agent-permissions.mjs [options]
 *
 * Options:
 *   --agent=claude|codex|opencode|all   Target agent runtime (default: claude)
 *   --platform-url=<url>       Platform URL (default: http://localhost:3000)
 *   --help                     Show usage
 *
 * Exit codes:
 *   0 — all permissions present
 *   1 — missing permissions (prints remediation)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Config — must stay in sync with install-agent-permissions.mjs
// ---------------------------------------------------------------------------

const PROTOCOL_ENDPOINTS = [
  "attach",
  "update",
  "ask",
  "read-context",
  "write-context",
  "deliver",
  "create-ticket",
  "search-tickets",
];

const CODEX_TARGET_RULES = path.join(os.homedir(), ".codex", "rules", "default.rules");
const CODEX_EXPECTED_RULES = [
  'pattern = ["npx", "overlord", "protocol"]',
  'pattern = ["ovld", "protocol"]',
  'pattern = ["curl", "-sS", "-X", "POST"]'
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { agent: "claude", platformUrl: "http://localhost:3000", help: false };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg.startsWith("--agent=")) opts.agent = arg.split("=")[1];
    else if (arg.startsWith("--platform-url=")) opts.platformUrl = arg.split("=").slice(1).join("=");
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return opts;
}

function printUsage() {
  console.log(`
Usage: node scripts/verify-agent-permissions.mjs [options]

Options:
  --agent=claude|codex|opencode|all   Target agent runtime (default: claude)
  --platform-url=<url>       Platform URL (default: http://localhost:3000)
  --help                     Show this help message
`);
}

// ---------------------------------------------------------------------------
// Claude Code verification
// ---------------------------------------------------------------------------

function buildExpectedClaudePermissions(platformUrl) {
  const entries = [];
  for (const endpoint of PROTOCOL_ENDPOINTS) {
    entries.push(`Bash(curl -s -X POST "${platformUrl}/api/protocol/${endpoint}":*)`);
  }
  entries.push(`Bash(curl -s -H 'Authorization::*)`);
  for (const endpoint of PROTOCOL_ENDPOINTS) {
    entries.push(`Bash(curl -s -X POST "$OVERLORD_URL/api/protocol/${endpoint}":*)`);
  }
  entries.push(`Bash(curl -s -H "Authorization::*)`);
  return entries;
}

function verifyClaude(platformUrl) {
  const settingsPath = path.join(process.cwd(), ".claude", "settings.local.json");
  console.log(`\n--- Claude Code ---`);
  console.log(`Settings file: ${settingsPath}`);

  if (!fs.existsSync(settingsPath)) {
    console.log("  FAIL: Settings file not found.");
    console.log("  Run: node scripts/install-agent-permissions.mjs --agent=claude");
    return false;
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (e) {
    console.log(`  FAIL: Could not parse settings file: ${e.message}`);
    return false;
  }

  const existing = new Set(settings?.permissions?.allow ?? []);

  // Check for broad curl wildcard (legacy but functional)
  if (existing.has("Bash(curl:*)")) {
    console.log("  OK: Broad curl wildcard found (Bash(curl:*)). All protocol calls are permitted.");
    console.log("  Note: Consider running the installer to replace with scoped entries.");
    return true;
  }

  const expected = buildExpectedClaudePermissions(platformUrl);
  const missing = expected.filter((e) => !existing.has(e));

  if (missing.length === 0) {
    console.log(`  OK: All ${expected.length} required permissions are present.`);
    return true;
  }

  console.log(`  FAIL: ${missing.length} of ${expected.length} required permissions are missing:`);
  for (const entry of missing) {
    console.log(`    - ${entry}`);
  }
  console.log(`\n  Run: node scripts/install-agent-permissions.mjs --agent=claude`);
  return false;
}

// ---------------------------------------------------------------------------
// Codex verification
// ---------------------------------------------------------------------------

function verifyCodex() {
  console.log(`\n--- Codex ---`);
  console.log(`Rules file: ${CODEX_TARGET_RULES}`);

  if (!fs.existsSync(CODEX_TARGET_RULES)) {
    console.log("  FAIL: Rules file not found.");
    console.log("  Run: node scripts/install-agent-permissions.mjs --agent=codex");
    return false;
  }

  let rulesContent = "";
  try {
    rulesContent = fs.readFileSync(CODEX_TARGET_RULES, "utf-8");
  } catch (e) {
    console.log(`  FAIL: Could not read rules file: ${e.message}`);
    return false;
  }

  const missing = CODEX_EXPECTED_RULES.filter((entry) => !rulesContent.includes(entry));
  if (missing.length === 0) {
    console.log(`  OK: All ${CODEX_EXPECTED_RULES.length} required Codex prefix rules are present.`);
    return true;
  }

  console.log(`  FAIL: Missing ${missing.length} required Codex prefix rules:`);
  for (const entry of missing) {
    console.log(`    - ${entry}`);
  }
  console.log(`\n  Run: node scripts/install-agent-permissions.mjs --agent=codex`);
  return false;
}

function verifyOpenCode() {
  console.log(`\n--- OpenCode ---`);
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  console.log(`Config file: ${configPath}`);

  if (!fs.existsSync(configPath)) {
    console.log("  FAIL: Config file not found.");
    console.log("  Run: node scripts/install-agent-permissions.mjs --agent=opencode");
    return false;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (e) {
    console.log(`  FAIL: Could not parse config file: ${e.message}`);
    return false;
  }

  const bash = config?.permission?.bash ?? {};
  const expected = ["ovld protocol *", "curl -sS -X POST *", "curl -s -X POST *"];
  const missing = expected.filter((entry) => bash[entry] !== "allow");

  if (missing.length === 0) {
    console.log(`  OK: All ${expected.length} required bash permissions are present.`);
    return true;
  }

  console.log(`  FAIL: Missing ${missing.length} required OpenCode bash permissions:`);
  for (const entry of missing) {
    console.log(`    - ${entry}`);
  }
  console.log(`\n  Run: node scripts/install-agent-permissions.mjs --agent=opencode`);
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();

  if (opts.help) {
    printUsage();
    return;
  }

  console.log("Overlord Agent Permission Verifier");
  console.log(`Platform URL: ${opts.platformUrl}`);

  let ok = true;

  if (opts.agent === "claude" || opts.agent === "all") {
    ok = verifyClaude(opts.platformUrl) && ok;
  }

  if (opts.agent === "codex" || opts.agent === "all") {
    ok = verifyCodex() && ok;
  }

  if (opts.agent === "opencode" || opts.agent === "all") {
    ok = verifyOpenCode() && ok;
  }

  console.log();
  if (ok) {
    console.log("All checks passed.");
  } else {
    console.log("Some checks failed. See remediation steps above.");
    process.exit(1);
  }
}

main();
