#!/usr/bin/env node

/**
 * install-agent-permissions.mjs
 *
 * One-time installer that pre-configures agent permissions for Overlord
 * protocol access so agents can call the local API without repeated approval
 * prompts.
 *
 * Usage:
 *   node scripts/install-agent-permissions.mjs [options]
 *
 * Options:
 *   --agent=claude|codex|opencode|all   Target agent runtime (default: all)
 *   --platform-url=<url>       Platform URL (default: http://localhost:3000)
 *   --dry-run                  Preview changes without writing
 *   --help                     Show usage
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Config
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
const CODEX_RULES_START = "# overlord:permissions:start";
const CODEX_RULES_END = "# overlord:permissions:end";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { agent: "all", platformUrl: "http://localhost:3000", dryRun: false, help: false };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--agent=")) opts.agent = arg.split("=")[1];
    else if (arg.startsWith("--platform-url=")) opts.platformUrl = arg.split("=").slice(1).join("=");
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!["claude", "codex", "opencode", "all"].includes(opts.agent)) {
    console.error(`Invalid --agent value: ${opts.agent}. Must be claude, codex, opencode, or all.`);
    process.exit(1);
  }

  return opts;
}

function printUsage() {
  console.log(`
Usage: node scripts/install-agent-permissions.mjs [options]

Options:
  --agent=claude|codex|opencode|all   Target agent runtime (default: all)
  --platform-url=<url>       Platform URL override (default: http://localhost:3000)
  --dry-run                  Preview changes without writing files
  --help                     Show this help message

Examples:
  node scripts/install-agent-permissions.mjs
  node scripts/install-agent-permissions.mjs --agent=claude --dry-run
  node scripts/install-agent-permissions.mjs --platform-url=http://localhost:4000
`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function mergeCodexRules(existingContent) {
  const managedBlock = [
    CODEX_RULES_START,
    "prefix_rule(",
    '  pattern = ["npx", "overlord", "protocol"],',
    '  decision = "allow",',
    '  justification = "Allow all Overlord protocol commands without prompts.",',
    ")",
    "",
    "prefix_rule(",
    '  pattern = ["ovld", "protocol"],',
    '  decision = "allow",',
    '  justification = "Allow all Overlord protocol commands without prompts.",',
    ")",
    "",
    "prefix_rule(",
    '  pattern = ["curl", "-sS", "-X", "POST"],',
    '  decision = "allow",',
    '  justification = "Allow curl protocol POST commands without prompts.",',
    ")",
    CODEX_RULES_END,
  ].join("\n");

  const startIndex = existingContent.indexOf(CODEX_RULES_START);
  const endIndex = existingContent.indexOf(CODEX_RULES_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = existingContent.slice(0, startIndex).trimEnd();
    const after = existingContent.slice(endIndex + CODEX_RULES_END.length).trimStart();
    if (!before && !after) return `${managedBlock}\n`;
    if (!before) return `${managedBlock}\n\n${after}`;
    if (!after) return `${before}\n\n${managedBlock}\n`;
    return `${before}\n\n${managedBlock}\n\n${after}`;
  }

  const trimmed = existingContent.trimEnd();
  if (!trimmed) return `${managedBlock}\n`;
  return `${trimmed}\n\n${managedBlock}\n`;
}

// ---------------------------------------------------------------------------
// Claude Code permissions
// ---------------------------------------------------------------------------

function claudeSettingsPath() {
  return path.join(process.cwd(), ".claude", "settings.local.json");
}

function buildClaudePermissions(platformUrl) {
  const entries = [];

  // POST endpoints — scoped to the exact protocol URL prefix.
  // Uses the curl format that agents produce when following the SKILL.md template.
  for (const endpoint of PROTOCOL_ENDPOINTS) {
    entries.push(`Bash(curl -s -X POST "${platformUrl}/api/protocol/${endpoint}":*)`);
  }

  // GET context endpoint (used at launch to fetch ticket prompt)
  entries.push(`Bash(curl -s -H 'Authorization::*)`);

  // Also allow the env-var form so the launch command works unmodified.
  for (const endpoint of PROTOCOL_ENDPOINTS) {
    entries.push(`Bash(curl -s -X POST "$OVERLORD_URL/api/protocol/${endpoint}":*)`);
  }
  entries.push(`Bash(curl -s -H "Authorization::*)`);

  return entries;
}

function installClaude(platformUrl, dryRun) {
  const settingsPath = claudeSettingsPath();
  console.log(`\n--- Claude Code ---`);
  console.log(`Settings file: ${settingsPath}`);

  let settings = { permissions: { allow: [] } };
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch (e) {
      console.error(`  ERROR: Could not parse ${settingsPath}: ${e.message}`);
      return false;
    }
    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
  }

  const required = buildClaudePermissions(platformUrl);
  const existing = new Set(settings.permissions.allow);
  const toAdd = required.filter((e) => !existing.has(e));

  if (toAdd.length === 0) {
    console.log("  All required permissions already present. Nothing to do.");
    return true;
  }

  console.log(`  Adding ${toAdd.length} permission entries:`);
  for (const entry of toAdd) {
    console.log(`    + ${entry}`);
  }

  if (dryRun) {
    console.log("  (dry-run — no files written)");
    return true;
  }

  // Backup
  if (fs.existsSync(settingsPath)) {
    const backupPath = `${settingsPath}.backup-${timestamp()}`;
    fs.copyFileSync(settingsPath, backupPath);
    console.log(`  Backup: ${backupPath}`);
  }

  settings.permissions.allow = [...settings.permissions.allow, ...toAdd];

  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("  Settings updated.");
  return true;
}

// ---------------------------------------------------------------------------
// Codex permissions
// ---------------------------------------------------------------------------

function installCodex(platformUrl, dryRun) {
  console.log(`\n--- Codex ---`);
  console.log(`Rules file: ${CODEX_TARGET_RULES}`);

  const nextRules = mergeCodexRules(readTextFile(CODEX_TARGET_RULES));

  if (dryRun) {
    console.log("  Would write Codex prefix rules for ovld protocol, npx overlord protocol, and curl POST.");
    return true;
  }

  if (fs.existsSync(CODEX_TARGET_RULES)) {
    const backupPath = `${CODEX_TARGET_RULES}.backup-${timestamp()}`;
    fs.copyFileSync(CODEX_TARGET_RULES, backupPath);
    console.log(`  Backup: ${backupPath}`);
  }

  const dir = path.dirname(CODEX_TARGET_RULES);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CODEX_TARGET_RULES, nextRules);
  console.log("  Rules updated.");
  return true;
}

function installOpenCode(_platformUrl, dryRun) {
  console.log(`\n--- OpenCode ---`);
  const configPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  console.log(`Config file: ${configPath}`);

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
      console.error(`  ERROR: Could not parse ${configPath}: ${e.message}`);
      return false;
    }
  }

  const existingPermission =
    config.permission && typeof config.permission === "object" ? config.permission : {};
  const existingBash =
    existingPermission.bash && typeof existingPermission.bash === "object"
      ? existingPermission.bash
      : {};

  const next = {
    ...config,
    $schema: "https://opencode.ai/config.json",
    permission: {
      ...existingPermission,
      bash: {
        "*": "ask",
        ...existingBash,
        "ovld protocol *": "allow",
        "curl -sS -X POST *": "allow",
        "curl -s -X POST *": "allow",
      },
    },
  };

  if (dryRun) {
    console.log("  Would write OpenCode permission rules for ovld protocol and curl POST.");
    return true;
  }

  if (fs.existsSync(configPath)) {
    const backupPath = `${configPath}.backup-${timestamp()}`;
    fs.copyFileSync(configPath, backupPath);
    console.log(`  Backup: ${backupPath}`);
  }

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n");
  console.log("  Config updated.");
  return true;
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

  console.log(`Overlord Agent Permission Installer`);
  console.log(`Platform URL: ${opts.platformUrl}`);
  console.log(`Target agent: ${opts.agent}`);
  if (opts.dryRun) console.log(`Mode: DRY RUN`);

  let ok = true;

  if (opts.agent === "claude" || opts.agent === "all") {
    ok = installClaude(opts.platformUrl, opts.dryRun) && ok;
  }

  if (opts.agent === "codex" || opts.agent === "all") {
    ok = installCodex(opts.platformUrl, opts.dryRun) && ok;
  }

  if (opts.agent === "opencode" || opts.agent === "all") {
    ok = installOpenCode(opts.platformUrl, opts.dryRun) && ok;
  }

  console.log();
  if (ok) {
    console.log("Done. Run `yarn verify-agent-permissions` to confirm readiness.");
  } else {
    console.log("Completed with errors. Review output above.");
    process.exit(1);
  }
}

main();
