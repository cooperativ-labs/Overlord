#!/usr/bin/env node

/**
 * Agent bundle setup commands (setup / doctor).
 *
 * Installs durable Overlord workflow configuration for Claude Code and OpenCode
 * into their respective config directories.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE_VERSION = '1.8.0';
const MD_MARKER_START = '<!-- overlord:managed:start -->';
const MD_MARKER_END = '<!-- overlord:managed:end -->';
const MANIFEST_DIR = path.join(os.homedir(), '.ovld');
const MANIFEST_FILE = path.join(MANIFEST_DIR, 'bundle-manifest.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', 'plugins', 'overlord');
const REPO_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'overlord');
const CODEX_TARGET_PLUGIN_DIR = path.join(os.homedir(), '.codex', 'plugins', 'overlord');
const CODEX_TARGET_PLUGIN_MANIFEST = path.join(
  CODEX_TARGET_PLUGIN_DIR,
  '.codex-plugin',
  'plugin.json'
);
const CODEX_TARGET_MARKETPLACE = path.join(os.homedir(), '.agents', 'plugins', 'marketplace.json');
const CODEX_TARGET_RULES = path.join(os.homedir(), '.codex', 'rules', 'default.rules');
const CODEX_LEGACY_AGENTS = path.join(os.homedir(), '.codex', 'AGENTS.md');
const CODEX_RULES_START = '# overlord:permissions:start';
const CODEX_RULES_END = '# overlord:permissions:end';
const REQUIRED_NODE_MAJOR = 20;

const supportedAgents = ['claude', 'codex', 'cursor', 'gemini', 'opencode'];

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

   For larger or quote-sensitive deliveries, prefer a single JSON file:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> --ticket-id $TICKET_ID --payload-file ./deliver.json
   \`\`\`
   Treat \`deliver.json\` as ephemeral scratch data only. Create it outside the repository when practical, never commit it, and remove it after delivery.

## Change Rationales

Always include \`changeRationales\` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact.

These are structured protocol payloads that Overlord stores as first-class rows in the \`file_changes\` table. Prefer inline JSON or the dedicated command below. For quote-sensitive deliveries, prefer \`--payload-file\` so summary, artifacts, and change rationales stay in one JSON document, but treat that JSON as ephemeral scratch data rather than a repository artifact. Ordinary deliver artifacts should use \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`, or \`decision\`.

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
   If you use \`--payload-file\`, \`--artifacts-file\`, or \`--change-rationales-file\` for larger JSON, treat that file as ephemeral scratch data outside the repository and remove it after delivery. Do not leave delivery JSON checked into the worktree.

## Change Rationales

Always include \`changeRationales\` when delivering. Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact. Record only meaningful behavioral changes. Overlord stores these as structured rows in the \`file_changes\` table. If you need a JSON file for transport, keep it ephemeral and out of the repository.

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

const CURSOR_RULES_CONTENT = `---
description: Overlord local workflow protocol — attach, update, deliver lifecycle for ticket-driven work.
globs:
alwaysApply: true
---

# Overlord Local Workflow

If a prompt includes a TICKET_ID, attach first with:
\`\`\`bash
ovld protocol attach --ticket-id $TICKET_ID
\`\`\`

During work, post progress updates with:
\`\`\`bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
\`\`\`

If blocked on human input, ask with:
\`\`\`bash
ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
\`\`\`

When done, deliver with artifacts and change rationales:
\`\`\`bash
ovld protocol deliver --session-key <sessionKey> --ticket-id $TICKET_ID --summary "Narrative: what you did, next steps." --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
\`\`\`
If you use a JSON file for delivery transport, keep it ephemeral scratch data outside the repository and remove it after the protocol call.

Rules:
- Always attach first and deliver last.
- Use \`ovld protocol\` commands instead of ad hoc repo scripts for ticket lifecycle work.
- If the user sends a new message during an active ticket session, publish a \`user_follow_up\` event before doing anything else.
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

function readJsonFileOrNull(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function localCliVersion() {
  const cliPackage = readJsonFileOrNull(path.resolve(__dirname, '..', '..', 'package.json'));
  return typeof cliPackage?.version === 'string' ? cliPackage.version : null;
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

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => typeof entry === 'string');
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

function slashCommandFiles(agent) {
  if (agent === 'claude') {
    const base = path.join(os.homedir(), '.claude', 'commands');
    return [
      {
        path: path.join(base, 'connect.md'),
        content: `---
description: Connect this session to another Overlord ticket by ticket ID
argument-hint: <ticket-id>
disable-model-invocation: true
---

Run \`ovld protocol connect --ticket-id <ticketId>\` using \`$ARGUMENTS\` as the ticket ID.`
      },
      {
        path: path.join(base, 'load.md'),
        content: `---
description: Load Overlord ticket context without creating a new session
argument-hint: <ticket-id>
disable-model-invocation: true
---

Run \`ovld protocol load-context --ticket-id <ticketId>\` using \`$ARGUMENTS\` as the ticket ID.`
      },
      {
        path: path.join(base, 'spawn.md'),
        content: `---
description: Create a new Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

Run \`ovld protocol spawn\` with \`$ARGUMENTS\`. If no flags are present, treat the arguments as the objective and call \`ovld protocol spawn --objective "<objective>"\`.`
      }
    ];
  }

  if (agent === 'cursor') {
    const base = path.join(os.homedir(), '.cursor', 'commands');
    return [
      {
        path: path.join(base, 'connect.md'),
        content:
          'Connect this session to another Overlord ticket.\n\nRun `ovld protocol connect --ticket-id <ticketId>` using the text after `/connect` as the ticket ID.\n'
      },
      {
        path: path.join(base, 'load.md'),
        content:
          'Load Overlord ticket context without attaching.\n\nRun `ovld protocol load-context --ticket-id <ticketId>` using the text after `/load` as the ticket ID.\n'
      },
      {
        path: path.join(base, 'spawn.md'),
        content:
          'Create a new Overlord ticket.\n\nRun `ovld protocol spawn --objective "<objective>"` using the text after `/spawn` unless raw flags were provided.\n'
      }
    ];
  }

  if (agent === 'gemini') {
    const base = path.join(os.homedir(), '.gemini', 'commands');
    return [
      {
        path: path.join(base, 'connect.toml'),
        content:
          'description = "Connect this session to another Overlord ticket by ticket ID."\nprompt = """\nRun `ovld protocol connect --ticket-id <ticketId>` using `{{args}}` as the ticket ID.\n"""\n'
      },
      {
        path: path.join(base, 'load.toml'),
        content:
          'description = "Load Overlord ticket context without creating a new session."\nprompt = """\nRun `ovld protocol load-context --ticket-id <ticketId>` using `{{args}}` as the ticket ID.\n"""\n'
      },
      {
        path: path.join(base, 'spawn.toml'),
        content:
          'description = "Create a new Overlord ticket from the current conversation."\nprompt = """\nRun `ovld protocol spawn --objective "<objective>"` using `{{args}}` as the objective unless raw flags were provided.\n"""\n'
      }
    ];
  }

  const base = path.join(os.homedir(), '.config', 'opencode', 'commands');
  return [
    {
      path: path.join(base, 'connect.md'),
      content: `---
description: Connect this session to another Overlord ticket by ticket ID
agent: build
---

Run \`ovld protocol connect --ticket-id <ticketId>\` using \`$ARGUMENTS\` as the ticket ID. If no ticket ID was provided, ask the user for one and stop.`
    },
    {
      path: path.join(base, 'load.md'),
      content: `---
description: Load Overlord ticket context without creating a new session
agent: build
---

Run \`ovld protocol load-context --ticket-id <ticketId>\` using \`$ARGUMENTS\` as the ticket ID. If no ticket ID was provided, ask the user for one and stop.`
    },
    {
      path: path.join(base, 'spawn.md'),
      content: `---
description: Create a new Overlord ticket from the current conversation
agent: build
---

Run \`ovld protocol spawn\` with \`$ARGUMENTS\`. If no flags are present, treat the arguments as the objective and call \`ovld protocol spawn --objective "<objective>"\`.`
    }
  ];
}

function installSlashCommands(agent) {
  const backups = [];
  const files = slashCommandFiles(agent);
  for (const file of files) {
    const backup = backupFile(file.path);
    if (backup) backups.push(backup);
    writeTextFile(file.path, `${file.content.trim()}\n`);
    console.log(`  ✓ Installed slash command: ${file.path}`);
  }
  return {
    backups,
    managedFiles: files.map(file => file.path)
  };
}

function currentContentHashForAgent(agent) {
  if (agent === 'claude') {
    return contentHash(
      [CLAUDE_SKILL_CONTENT, PERMISSION_HOOK_SCRIPT, ...slashCommandFiles('claude').map(file => file.content)].join('\n')
    );
  }
  if (agent === 'cursor') {
    return contentHash(
      [CURSOR_RULES_CONTENT, ...slashCommandFiles('cursor').map(file => file.content)].join('\n')
    );
  }
  if (agent === 'gemini') {
    return contentHash(slashCommandFiles('gemini').map(file => file.content).join('\n'));
  }
  if (agent === 'codex') return codexContentHash();
  return contentHash(
    [OPENCODE_AGENTS_SECTION, ...slashCommandFiles('opencode').map(file => file.content)].join('\n')
  );
}

async function checkForCliUpdate() {
  const currentVersion = localCliVersion();
  if (!currentVersion) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch('https://registry.npmjs.org/overlord-cli/latest', {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const latestVersion = typeof payload?.version === 'string' ? payload.version : null;
    if (!latestVersion) return null;
    return latestVersion === currentVersion ? null : latestVersion;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function codexSourcePluginDir() {
  if (fs.existsSync(PACKAGE_PLUGIN_DIR)) return PACKAGE_PLUGIN_DIR;
  if (fs.existsSync(REPO_PLUGIN_DIR)) return REPO_PLUGIN_DIR;
  throw new Error(
    `Codex plugin bundle not found. Checked ${PACKAGE_PLUGIN_DIR} and ${REPO_PLUGIN_DIR}.`
  );
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(resolved);
    return [resolved];
  });
}

function codexContentHash() {
  const sourceDir = codexSourcePluginDir();
  const hash = crypto.createHash('sha256');

  for (const filePath of listFilesRecursive(sourceDir).sort()) {
    hash.update(path.relative(sourceDir, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  return hash.digest('hex').slice(0, 16);
}

function mergeCodexRules(existingContent) {
  const managedBlock = [
    CODEX_RULES_START,
    'prefix_rule(',
    '  pattern = ["npx", "overlord", "protocol"],',
    '  decision = "allow",',
    '  justification = "Allow all Overlord protocol commands without prompts.",',
    ')',
    '',
    'prefix_rule(',
    '  pattern = ["ovld", "protocol"],',
    '  decision = "allow",',
    '  justification = "Allow all Overlord protocol commands without prompts.",',
    ')',
    '',
    'prefix_rule(',
    '  pattern = ["curl", "-sS", "-X", "POST"],',
    '  decision = "allow",',
    '  justification = "Allow curl protocol POST commands without prompts.",',
    ')',
    CODEX_RULES_END
  ].join('\n');

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

function pluginVersion(filePath) {
  const parsed = readJsonFileOrNull(filePath);
  return typeof parsed?.version === 'string' ? parsed.version : null;
}

function upsertCodexMarketplaceEntry() {
  const current = readJsonFileOrNull(CODEX_TARGET_MARKETPLACE) ?? {
    name: 'overlord-local',
    interface: { displayName: 'Overlord Local Plugins' },
    plugins: []
  };

  const nextPlugins = Array.isArray(current.plugins) ? [...current.plugins] : [];
  const entry = {
    name: 'overlord',
    source: {
      source: 'local',
      path: './.codex/plugins/overlord'
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL'
    },
    category: 'Productivity'
  };

  const existingIndex = nextPlugins.findIndex(plugin => plugin?.name === 'overlord');
  if (existingIndex === -1) nextPlugins.push(entry);
  else nextPlugins[existingIndex] = entry;

  writeJsonFile(CODEX_TARGET_MARKETPLACE, {
    name: current.name ?? 'overlord-local',
    interface: {
      displayName: current.interface?.displayName ?? 'Overlord Local Plugins'
    },
    plugins: nextPlugins
  });
}

function removeLegacyCodexBundle() {
  if (fs.existsSync(CODEX_LEGACY_AGENTS)) {
    const existing = readTextFile(CODEX_LEGACY_AGENTS);
    const startIndex = existing.indexOf(MD_MARKER_START);
    const endIndex = existing.indexOf(MD_MARKER_END);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      const before = existing.slice(0, startIndex).trimEnd();
      const after = existing.slice(endIndex + MD_MARKER_END.length).trimStart();
      const cleaned =
        !before && !after
          ? ''
          : !before
            ? `${after}\n`
            : !after
              ? `${before}\n`
              : `${before}\n\n${after}\n`;

      if (cleaned.trim().length > 0) {
        writeTextFile(CODEX_LEGACY_AGENTS, cleaned);
      } else {
        fs.rmSync(CODEX_LEGACY_AGENTS, { force: true });
      }
    }
  }

  const manifest = readManifest();
  if (!manifest.codex) return;
  delete manifest.codex;
  writeManifest(manifest);
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

function openCodePaths() {
  const base = path.join(os.homedir(), '.config', 'opencode');
  return {
    agentsFile: path.join(base, 'AGENTS.md'),
    configFile: path.join(base, 'opencode.json'),
    commandsDir: path.join(base, 'commands')
  };
}

function cursorPaths() {
  const base = path.join(os.homedir(), '.cursor');
  return {
    rulesFile: path.join(base, 'rules', 'overlord-local.mdc'),
    settingsFile: path.join(base, 'settings.json')
  };
}

function geminiPaths() {
  const base = path.join(os.homedir(), '.gemini');
  return {
    policyFile: path.join(base, 'policies', 'overlord-protocol.toml')
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
  const existingPermissions =
    existingSettings.permissions && typeof existingSettings.permissions === 'object'
      ? existingSettings.permissions
      : {};
  const mergedAllow = Array.from(
    new Set([
      ...asStringArray(existingPermissions.allow),
      'Bash(ovld protocol:*)',
      'Bash(curl -sS -X POST:*)'
    ])
  );

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
  merged.permissions = { ...existingPermissions, allow: mergedAllow };
  merged.__overlord_managed = {
    version: BUNDLE_VERSION,
    paths: ['hooks.PermissionRequest', 'permissions.allow'],
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(paths.settingsFile, merged);
  console.log(`  ✓ Merged hook into: ${paths.settingsFile}`);

  const slashResult = installSlashCommands('claude');
  backups.push(...slashResult.backups);

  // 4. Update manifest
  const manifest = readManifest();
  manifest.claude = {
    version: BUNDLE_VERSION,
    contentHash: currentContentHashForAgent('claude'),
    installedAt: new Date().toISOString(),
    files: [paths.skillFile, paths.hookScript, paths.settingsFile, ...slashResult.managedFiles]
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

  const slashResult = installSlashCommands('opencode');
  backups.push(...slashResult.backups);

  const manifest = readManifest();
  manifest.opencode = {
    version: BUNDLE_VERSION,
    contentHash: currentContentHashForAgent('opencode'),
    installedAt: new Date().toISOString(),
    files: [paths.agentsFile, paths.configFile, ...slashResult.managedFiles]
  };
  writeManifest(manifest);

  return { ok: true, backups };
}

function installCodex() {
  const sourceDir = codexSourcePluginDir();
  fs.mkdirSync(path.dirname(CODEX_TARGET_PLUGIN_DIR), { recursive: true });
  fs.rmSync(CODEX_TARGET_PLUGIN_DIR, { recursive: true, force: true });
  fs.cpSync(sourceDir, CODEX_TARGET_PLUGIN_DIR, { recursive: true });
  console.log(`  ✓ Installed plugin: ${CODEX_TARGET_PLUGIN_DIR}`);

  writeTextFile(CODEX_TARGET_RULES, mergeCodexRules(readTextFile(CODEX_TARGET_RULES)));
  console.log(`  ✓ Updated rules: ${CODEX_TARGET_RULES}`);

  upsertCodexMarketplaceEntry();
  console.log(`  ✓ Updated marketplace: ${CODEX_TARGET_MARKETPLACE}`);

  removeLegacyCodexBundle();

  const installedFiles = [
    ...listFilesRecursive(CODEX_TARGET_PLUGIN_DIR),
    CODEX_TARGET_MARKETPLACE,
    CODEX_TARGET_RULES
  ];
  const manifest = readManifest();
  manifest.codex = {
    version: pluginVersion(CODEX_TARGET_PLUGIN_MANIFEST) ?? '0.0.0',
    contentHash: codexContentHash(),
    installedAt: new Date().toISOString(),
    files: installedFiles
  };
  writeManifest(manifest);

  return { ok: true, installedFiles };
}

function installCursor() {
  const paths = cursorPaths();
  writeTextFile(paths.rulesFile, CURSOR_RULES_CONTENT);
  console.log(`  ✓ Installed rules: ${paths.rulesFile}`);

  const slashResult = installSlashCommands('cursor');

  const existingSettings = readJsonFile(paths.settingsFile);
  const permissions =
    existingSettings.permissions && typeof existingSettings.permissions === 'object'
      ? existingSettings.permissions
      : {};
  const mergedAllow = Array.from(
    new Set([
      ...asStringArray(permissions.allow),
      'Shell(ovld protocol:*)',
      'Shell(curl -sS -X POST:*)'
    ])
  );
  writeJsonFile(paths.settingsFile, {
    ...existingSettings,
    permissions: {
      ...permissions,
      allow: mergedAllow
    }
  });
  console.log(`  ✓ Updated permissions: ${paths.settingsFile}`);

  const manifest = readManifest();
  manifest.cursor = {
    version: BUNDLE_VERSION,
    contentHash: currentContentHashForAgent('cursor'),
    installedAt: new Date().toISOString(),
    files: [paths.rulesFile, paths.settingsFile, ...slashResult.managedFiles]
  };
  writeManifest(manifest);

  return { ok: true };
}

function installGemini() {
  const slashResult = installSlashCommands('gemini');
  const paths = geminiPaths();
  const policyContent = [
    '# Managed by Overlord onboarding',
    '[[rule]]',
    'toolName = "run_shell_command"',
    'commandPrefix = "ovld protocol"',
    'decision = "allow"',
    'priority = 900',
    '',
    '[[rule]]',
    'toolName = "run_shell_command"',
    'commandPrefix = "curl -sS -X POST"',
    'decision = "allow"',
    'priority = 900',
    ''
  ].join('\n');
  writeTextFile(paths.policyFile, policyContent);
  console.log(`  ✓ Installed policy: ${paths.policyFile}`);

  const manifest = readManifest();
  manifest.gemini = {
    version: BUNDLE_VERSION,
    contentHash: currentContentHashForAgent('gemini'),
    installedAt: new Date().toISOString(),
    files: [paths.policyFile, ...slashResult.managedFiles]
  };
  writeManifest(manifest);

  return { ok: true };
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

  const currentVersion =
    agent === 'codex'
      ? pluginVersion(path.join(codexSourcePluginDir(), '.codex-plugin', 'plugin.json'))
      : BUNDLE_VERSION;
  const currentHash = currentContentHashForAgent(agent);

  if (entry.version !== currentVersion || entry.contentHash !== currentHash) {
    console.log(
      `  ⚠ ${agent}: stale (installed v${entry.version}, current v${currentVersion ?? 'unknown'})`
    );
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

function currentNodeMajor() {
  return Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runSetupCommand(args) {
  const agent = args[0];

  if (agent === '--help' || agent === '-h' || agent === 'help') {
    console.log(`Usage:
  ovld setup claude    Install Overlord bundle for Claude Code
  ovld setup codex     Install Overlord Codex plugin bundle
  ovld setup cursor    Install Overlord rules, slash commands, and permissions for Cursor
  ovld setup gemini    Install Overlord slash commands and policy rules for Gemini CLI
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
        else if (a === 'cursor') installCursor();
        else if (a === 'gemini') installGemini();
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
    else if (agent === 'cursor') installCursor();
    else if (agent === 'gemini') installGemini();
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
  const nodeMajor = currentNodeMajor();
  if (Number.isNaN(nodeMajor) || nodeMajor < REQUIRED_NODE_MAJOR) {
    console.log(
      `  ✗ node: unsupported runtime (${process.version}; requires Node.js ${REQUIRED_NODE_MAJOR}+)`
    );
    allOk = false;
  } else {
    console.log(`  ✓ node: ${process.version}`);
  }
  console.log();
  for (const agent of supportedAgents) {
    if (!doctorAgent(agent)) allOk = false;
  }
  const latestCliVersion = await checkForCliUpdate();
  console.log();
  if (allOk) {
    console.log('All bundles are up to date.');
  } else {
    console.log('Run `ovld setup <agent>` or `ovld setup all` to install/repair.');
  }
  if (latestCliVersion) {
    console.log();
    console.log(`CLI update available: ${latestCliVersion}`);
    console.log(
      `Update with Node.js ${REQUIRED_NODE_MAJOR}+ and reinstall the installed CLI wrapper if needed.`
    );
  }
}
