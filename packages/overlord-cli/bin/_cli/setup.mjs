#!/usr/bin/env node

/**
 * Agent bundle setup commands (setup / doctor).
 *
 * Installs durable Overlord workflow configuration for Claude Code, Codex,
 * and OpenCode into their respective config directories.
 * into their respective config directories (~/.claude/, ~/.codex/).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUNDLE_VERSION = '1.5.0';
const MD_MARKER_START = '<!-- overlord:managed:start -->';
const MD_MARKER_END = '<!-- overlord:managed:end -->';
const MANIFEST_DIR = path.join(os.homedir(), '.ovld');
const MANIFEST_FILE = path.join(MANIFEST_DIR, 'bundle-manifest.json');

const supportedAgents = ['claude', 'codex', 'opencode'];

// ---------------------------------------------------------------------------
// Templates (same content as electron/services/agent-bundle/templates.ts)
// ---------------------------------------------------------------------------

const CLAUDE_SKILL_CONTENT = `---
name: overlord-local
description: Overlord local workflow protocol — attach, update, deliver lifecycle for ticket-driven work.
---

# Overlord Local Workflow

If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — Always call attach before doing any work:
   \`\`\`bash
   ovld protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` to publish a specific activity event (default: \`update\`):
   - \`update\` — standard progress update (default)
   - \`user_follow_up\` — a message or question from the human user (EXCLUDING THE INITIAL TICKET)
   - \`alert\` — surface a warning or non-blocking alert

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> \\\\
     --ticket-id $TICKET_ID \\\\
     --summary "Narrative: what you did, next steps." \\\\
     --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \\\\
     --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
   \`\`\`

## Change Rationales

Always include \`changeRationales\` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact.

These are structured protocol payloads that Overlord stores as first-class rows in the \`file_changes\` table. Prefer inline JSON or the dedicated command below. Use \`--change-rationales-file\` only when a large JSON payload is easier to pass by file. Ordinary deliver artifacts should use \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`, or \`decision\`.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\\\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\\\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

Record only meaningful behavioral changes — skip formatting-only noise. Prefer 1–5 concise rationales per ticket, each tied to a specific file and diff hunk.

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
\`\`\`

## Rules

- Always attach first; always deliver when done.
- Post at least one update before delivering.
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative, not a command list.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a \`user_follow_up\` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket.**
`;

const CODEX_AGENTS_SECTION = `# Overlord Local Workflow

If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — Always call attach before doing any work:
   \`\`\`bash
   ovld protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` for activity events: \`update\`, \`user_follow_up\`, \`alert\`.

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> \\\\
     --ticket-id $TICKET_ID \\\\
     --summary "Narrative: what you did, next steps." \\\\
     --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \\\\
     --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
   \`\`\`

## Change Rationales

Always include \`changeRationales\` when delivering. Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact. Record only meaningful behavioral changes. Overlord stores these as structured rows in the \`file_changes\` table.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\\\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\\\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
\`\`\`

## Rules

- Always attach first; always deliver when done.
- Post at least one update before delivering.
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a \`user_follow_up\` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket.**
`;

const OPENCODE_AGENTS_SECTION = `# Overlord Local Workflow

If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — Always call attach before doing any work:
   \`\`\`bash
   ovld protocol attach --ticket-id $TICKET_ID
   \`\`\`
   Store \`session.sessionKey\` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   \`\`\`bash
   ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   \`\`\`
   Phases: \`draft\`, \`execute\`, \`review\`, \`deliver\`, \`complete\`, \`blocked\`, \`cancelled\`.
   Use \`execute\` while working.

   Pass \`--event-type <type>\` for activity events: \`update\`, \`user_follow_up\`, \`alert\`.

3. **Ask when blocked** — Stop working after calling:
   \`\`\`bash
   ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   \`\`\`

4. **Deliver last** — Always deliver when done:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> \\\\
     --ticket-id $TICKET_ID \\\\
     --summary "Narrative: what you did, next steps." \\\\
     --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \\\\
     --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
   \`\`\`

## Change Rationales

Always include \`changeRationales\` when delivering. Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact. Record only meaningful behavioral changes. Overlord stores these as structured rows in the \`file_changes\` table.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\\\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\\\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
\`\`\`

## Rules

- Always attach first; always deliver when done.
- Post at least one update before delivering.
- If blocked on human-only work, call \`ask\` and request a follow-up human ticket.
- The \`summary\` in deliver is what the PM reads first — write it as a narrative.
- Use \`write-context\` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a \`user_follow_up\` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket.**
`;

const PERMISSION_HOOK_SCRIPT = `#!/bin/bash
# Overlord PermissionRequest notification hook (managed by Overlord)
BODY=$(cat -)
if [ -n "$OVERLORD_URL" ] && [ -n "$AGENT_TOKEN" ] && [ -n "$TICKET_ID" ]; then
  curl -sf -m 5 \\
    -X POST "$OVERLORD_URL/api/protocol/permission-request?ticketId=$TICKET_ID" \\
    -H "Authorization: Bearer $AGENT_TOKEN" \\
    -H "X-Overlord-Local-Secret: $OVERLORD_LOCAL_SECRET" \\
    -H "Content-Type: application/json" \\
    -d "$BODY" \\
    >/dev/null 2>&1 &
  disown
fi
exit 0
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `${base}.backup-${ts}${ext}`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function writeTextFile(filePath, content, mode) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const options = { encoding: 'utf-8' };
  if (mode !== undefined) options.mode = mode;
  fs.writeFileSync(filePath, content, options);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeMarkdownSection(existing, newContent) {
  const wrappedContent = `${MD_MARKER_START}\n${newContent.trim()}\n${MD_MARKER_END}`;
  const startIdx = existing.indexOf(MD_MARKER_START);
  const endIdx = existing.indexOf(MD_MARKER_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MD_MARKER_END.length);
    return `${before}${wrappedContent}${after}`;
  }
  const trimmed = existing.trimEnd();
  if (trimmed.length === 0) return wrappedContent + '\n';
  return `${trimmed}\n\n${wrappedContent}\n`;
}

function readManifest() {
  return readJsonFile(MANIFEST_FILE);
}
function writeManifest(manifest) {
  writeJsonFile(MANIFEST_FILE, manifest);
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

function claudePaths() {
  const base = path.join(os.homedir(), '.claude');
  return {
    skillDir: path.join(base, 'skills', 'overlord-local'),
    skillFile: path.join(base, 'skills', 'overlord-local', 'SKILL.md'),
    settingsFile: path.join(base, 'settings.json'),
    hookScript: path.join(base, 'overlord-permission-hook.sh')
  };
}

function codexPaths() {
  const base = path.join(os.homedir(), '.codex');
  return {
    agentsFile: path.join(base, 'AGENTS.md')
  };
}

function openCodePaths() {
  const base = path.join(os.homedir(), '.config', 'opencode');
  return {
    agentsFile: path.join(base, 'AGENTS.md'),
    configFile: path.join(base, 'opencode.json'),
    commandsDir: path.join(base, 'commands')
  };
}

function installClaude() {
  const paths = claudePaths();
  const backups = [];

  // 1. Install skill file
  writeTextFile(paths.skillFile, CLAUDE_SKILL_CONTENT);
  console.log(`  ✓ Installed skill: ${paths.skillFile}`);

  // 2. Install permission hook
  writeTextFile(paths.hookScript, PERMISSION_HOOK_SCRIPT, 0o755);
  console.log(`  ✓ Installed hook: ${paths.hookScript}`);

  // 3. Merge hook into settings.json
  const backup = backupFile(paths.settingsFile);
  if (backup) {
    backups.push(backup);
    console.log(`  ✓ Backed up: ${paths.settingsFile} → ${path.basename(backup)}`);
  }

  const existingSettings = readJsonFile(paths.settingsFile);
  const overlordHook = {
    matcher: '.*',
    hooks: [{ type: 'command', command: paths.hookScript }]
  };

  const existingHooks = existingSettings.hooks ?? {};
  const existingPermHooks = Array.isArray(existingHooks.PermissionRequest)
    ? existingHooks.PermissionRequest
    : [];

  // Remove existing Overlord hooks
  const filteredPermHooks = existingPermHooks.filter(hook => {
    if (hook && typeof hook === 'object' && hook.hooks) {
      return !hook.hooks.some(
        inner =>
          typeof inner.command === 'string' && inner.command.includes('overlord-permission-hook')
      );
    }
    return true;
  });

  const merged = deepClone(existingSettings);
  merged.hooks = { ...existingHooks, PermissionRequest: [...filteredPermHooks, overlordHook] };
  merged.__overlord_managed = {
    version: BUNDLE_VERSION,
    paths: ['hooks.PermissionRequest'],
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(paths.settingsFile, merged);
  console.log(`  ✓ Merged hook into: ${paths.settingsFile}`);

  // 4. Update manifest
  const manifest = readManifest();
  manifest.claude = {
    version: BUNDLE_VERSION,
    contentHash: contentHash(CLAUDE_SKILL_CONTENT),
    installedAt: new Date().toISOString(),
    files: [paths.skillFile, paths.hookScript, paths.settingsFile]
  };
  writeManifest(manifest);

  return { ok: true, backups };
}

function installCodex() {
  const paths = codexPaths();
  const backups = [];

  const backup = backupFile(paths.agentsFile);
  if (backup) {
    backups.push(backup);
    console.log(`  ✓ Backed up: ${paths.agentsFile} → ${path.basename(backup)}`);
  }

  const existing = readTextFile(paths.agentsFile);
  const merged = mergeMarkdownSection(existing, CODEX_AGENTS_SECTION);
  writeTextFile(paths.agentsFile, merged);
  console.log(`  ✓ Installed agents config: ${paths.agentsFile}`);

  const manifest = readManifest();
  manifest.codex = {
    version: BUNDLE_VERSION,
    contentHash: contentHash(CODEX_AGENTS_SECTION),
    installedAt: new Date().toISOString(),
    files: [paths.agentsFile]
  };
  writeManifest(manifest);

  return { ok: true, backups };
}

function installOpenCode() {
  const paths = openCodePaths();
  const backups = [];

  const agentsBackup = backupFile(paths.agentsFile);
  if (agentsBackup) {
    backups.push(agentsBackup);
    console.log(`  ✓ Backed up: ${paths.agentsFile} → ${path.basename(agentsBackup)}`);
  }

  const existingAgents = readTextFile(paths.agentsFile);
  const mergedAgents = mergeMarkdownSection(existingAgents, OPENCODE_AGENTS_SECTION);
  writeTextFile(paths.agentsFile, mergedAgents);
  console.log(`  ✓ Installed agents config: ${paths.agentsFile}`);

  const configBackup = backupFile(paths.configFile);
  if (configBackup) {
    backups.push(configBackup);
    console.log(`  ✓ Backed up: ${paths.configFile} → ${path.basename(configBackup)}`);
  }

  const existingConfig = readJsonFile(paths.configFile);
  const existingInstructions = Array.isArray(existingConfig.instructions)
    ? existingConfig.instructions.filter(v => typeof v === 'string' && v.trim())
    : [];
  const existingPermission =
    existingConfig.permission && typeof existingConfig.permission === 'object'
      ? existingConfig.permission
      : {};
  const existingBash =
    existingPermission.bash && typeof existingPermission.bash === 'object'
      ? existingPermission.bash
      : {};

  writeJsonFile(paths.configFile, {
    ...existingConfig,
    $schema: 'https://opencode.ai/config.json',
    instructions: Array.from(new Set([...existingInstructions, paths.agentsFile])),
    permission: {
      ...existingPermission,
      bash: {
        '*': 'ask',
        ...existingBash,
        'ovld protocol *': 'allow',
        'curl -sS -X POST *': 'allow',
        'curl -s -X POST *': 'allow'
      }
    }
  });
  console.log(`  ✓ Updated config: ${paths.configFile}`);

  const commandFiles = [
    {
      file: path.join(paths.commandsDir, 'connect.md'),
      content: `---
description: Connect this session to another Overlord ticket by ticket ID
agent: build
---

Run \`ovld protocol connect --ticket-id <ticketId>\` using \`$ARGUMENTS\` as the ticket ID. If no ticket ID was provided, ask the user for one and stop.`
    },
    {
      file: path.join(paths.commandsDir, 'load.md'),
      content: `---
description: Load Overlord ticket context without creating a new session
agent: build
---

Run \`ovld protocol load-context --ticket-id <ticketId>\` using \`$ARGUMENTS\` as the ticket ID. If no ticket ID was provided, ask the user for one and stop.`
    },
    {
      file: path.join(paths.commandsDir, 'spawn.md'),
      content: `---
description: Create a new Overlord ticket from the current conversation
agent: build
---

Run \`ovld protocol spawn\` with \`$ARGUMENTS\`. If no flags are present, treat the arguments as the objective and call \`ovld protocol spawn --objective "<objective>"\`.`
    }
  ];

  for (const commandFile of commandFiles) {
    const commandBackup = backupFile(commandFile.file);
    if (commandBackup) {
      backups.push(commandBackup);
      console.log(`  ✓ Backed up: ${commandFile.file} → ${path.basename(commandBackup)}`);
    }
    writeTextFile(commandFile.file, `${commandFile.content.trim()}\n`);
    console.log(`  ✓ Installed slash command: ${commandFile.file}`);
  }

  const manifest = readManifest();
  manifest.opencode = {
    version: BUNDLE_VERSION,
    contentHash: contentHash(OPENCODE_AGENTS_SECTION),
    installedAt: new Date().toISOString(),
    files: [paths.agentsFile, paths.configFile, ...commandFiles.map(entry => entry.file)]
  };
  writeManifest(manifest);

  return { ok: true, backups };
}

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

function doctorAgent(agent) {
  const manifest = readManifest();
  const entry = manifest[agent];

  if (!entry) {
    console.log(`  ✗ ${agent}: not installed`);
    return false;
  }

  if (entry.version !== BUNDLE_VERSION) {
    console.log(`  ⚠ ${agent}: stale (installed v${entry.version}, current v${BUNDLE_VERSION})`);
    return false;
  }

  const missingFiles = entry.files.filter(f => !fs.existsSync(f));
  if (missingFiles.length > 0) {
    console.log(`  ⚠ ${agent}: partial — missing files:`);
    for (const f of missingFiles) console.log(`      ${f}`);
    return false;
  }

  console.log(`  ✓ ${agent}: installed (v${entry.version})`);
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runSetupCommand(args) {
  const agent = args[0];

  if (agent === '--help' || agent === '-h' || agent === 'help') {
    console.log(`Usage:
  ovld setup claude    Install Overlord bundle for Claude Code
  ovld setup codex     Install Overlord bundle for Codex
  ovld setup opencode  Install Overlord connector for OpenCode
  ovld setup all       Install for all supported agents
  ovld doctor          Validate installed connectors`);
    return;
  }

  if (agent === 'all') {
    console.log('Installing Overlord agent bundle for all supported agents...\n');
    for (const a of supportedAgents) {
      console.log(`[${a}]`);
      try {
        if (a === 'claude') installClaude();
        else if (a === 'codex') installCodex();
        else installOpenCode();
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
      }
      console.log();
    }
    console.log('Done.');
    return;
  }

  if (!supportedAgents.includes(agent)) {
    console.error(
      `Unknown agent: ${agent ?? '(none)'}. Supported: ${supportedAgents.join(', ')}, all`
    );
    process.exit(1);
  }

  console.log(`Installing Overlord agent bundle for ${agent}...\n`);
  try {
    if (agent === 'claude') installClaude();
    else if (agent === 'codex') installCodex();
    else installOpenCode();
    console.log('\nDone.');
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
  }
}

export async function runDoctorCommand() {
  console.log('Overlord agent bundle status:\n');
  let allOk = true;
  for (const agent of supportedAgents) {
    if (!doctorAgent(agent)) allOk = false;
  }
  console.log();
  if (allOk) {
    console.log('All bundles are up to date.');
  } else {
    console.log('Run `ovld setup <agent>` or `ovld setup all` to install/repair.');
  }
}
