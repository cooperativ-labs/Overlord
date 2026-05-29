#!/usr/bin/env node

/**
 * Agent bundle setup commands (setup / doctor).
 *
 * Installs durable Overlord workflow configuration for Claude Code and OpenCode
 * into their respective config directories.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkForCliUpdate, getCurrentCliVersion, printCliUpdateNotice } from './cli-update.mjs';

// ---------------------------------------------------------------------------
// Legacy Gemini connector (inlined — the lib/ directory is not published with
// the npm package, so the old relative import broke on global installs)
// ---------------------------------------------------------------------------

const GEMINI_LEGACY_COMMANDS_DIR = path.join(os.homedir(), '.gemini', 'commands');

function geminiLegacyCommandFiles() {
  const base = GEMINI_LEGACY_COMMANDS_DIR;
  return [
    {
      path: path.join(base, 'connect.toml'),
      content: `description = "Connect this session to another Overlord ticket (requires: ticket-id)."\nprompt = """\nConnect this session to another Overlord ticket.\n\nTreat \`{{args}}\` as the target ticket ID.\nIf no ticket ID was provided, ask the user for one and stop.\n\nRun:\n\`ovld protocol connect --ticket-id <ticket_id>\`\n\nRules:\n- Use \`connect\`, not \`attach\`.\n- Do not load extra ticket context unless the user explicitly asks for it.\n- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.\n"""`
    },
    {
      path: path.join(base, 'load.toml'),
      content: `description = "Load Overlord ticket context (requires: ticket-id)."\nprompt = """\nLoad Overlord ticket context without attaching to the ticket.\n\nTreat \`{{args}}\` as the target ticket ID.\nIf no ticket ID was provided, ask the user for one and stop.\n\nRun:\n\`ovld protocol load-context --ticket-id <ticket_id>\`\n\nRules:\n- Use \`load-context\`, not \`attach\`.\n- Do not create or switch sessions.\n- Summarize the returned ticket details, history, artifacts, and shared context for the user.\n"""`
    },
    {
      path: path.join(base, 'attach.toml'),
      content: `description = "Attach this session to an Overlord ticket (requires: ticket-id)."\nprompt = """\nAttach this session to an Overlord ticket.\n\nTreat \`{{args}}\` as the target ticket ID.\nIf no ticket ID was provided, ask the user for one and stop.\n\nRun:\n\`ovld protocol attach --ticket-id <ticket_id>\`\n\nRules:\n- Use \`attach\` to establish a persistent session with a ticket.\n- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.\n"""`
    },
    {
      path: path.join(base, 'discuss-objective.toml'),
      content: `description = "Mark a ticket's draft objective as submitted (in discussion)."\nprompt = """\nMark a draft objective as "submitted", indicating the ticket is in active discussion with an agent.\n\nTreat \`{{args}}\` as the target ticket ID.\nIf no ticket ID was provided, ask the user for one and stop.\n\nRun:\n\`ovld protocol discuss-objective --ticket-id <ticket_id>\`\n\nRules:\n- This does NOT start execution. Use \`attach\` for that.\n- After the command succeeds, confirm the objective was submitted.\n"""`
    },
    {
      path: path.join(base, 'add-objectives.toml'),
      content: `description = "Append ordered objectives to an existing Overlord ticket."\nprompt = """\nAppend ordered objectives to an existing ticket.\n\nUse this when prompts are sequential steps toward the same feature or goal. Create separate tickets when prompts represent different features or goals.\n\nRun:\n\`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`\n\nIndex 0 is the first newly added objective to execute; later indexes queue after it.\n"""`
    },
    {
      path: path.join(base, 'create.toml'),
      content: `description = "Create a draft Overlord ticket from the current conversation."\nprompt = """\nCreate a draft Overlord ticket from the user's request.\n\nUse \`{{args}}\` as the input.\nIf it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--for-human\`, pass those flags through after \`ovld protocol create --agent gemini\`.\nOtherwise, treat \`{{args}}\` as the objective text and run:\n\`ovld protocol create --agent gemini --objective "<objective>"\`\n\nIf no objective was provided, ask the user for one and stop.\n\nAfter the command succeeds, report the new \`TICKET_ID\`.\n"""`
    },
    {
      path: path.join(base, 'prompt.toml'),
      content: `description = "Create a new Overlord ticket from the current conversation."\nprompt = """\nCreate a new Overlord ticket from the user's request.\n\nUse \`{{args}}\` as the input.\nIf it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--for-human\`, pass those flags through after \`ovld protocol prompt --agent gemini\`.\nOtherwise, treat \`{{args}}\` as the objective text and run:\n\`ovld protocol prompt --agent gemini --objective "<objective>"\`\n\nIf no objective was provided, ask the user for one and stop.\n\nAfter the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.\n"""`
    },
    {
      path: path.join(base, 'record-work.toml'),
      content: `description = "Record completed-from-chat work as a ticket in review + feed post (no attach)."\nprompt = """\nImmediately record the work you just completed in this chat as a new Overlord ticket via \`ovld protocol record-work\`. No agent session is opened — the work is already done.\n\nSynthesize from the current conversation:\n- \`objective\`: what was asked / what was done.\n- \`summary\`: reviewer-friendly narrative for the feed.\n- \`changeRationales\`: one entry per meaningful git-tracked file change (\`label\`, \`file_path\`, \`summary\`, \`why\`, \`impact\`, optional \`hunks\`). Use \`git status\` and \`git diff\` to enumerate changed files.\n- \`artifacts\` (optional): \`next_steps\`, \`test_results\`, \`decision\`, \`note\`, \`url\`.\n\nIf \`{{args}}\` is non-empty, treat it as additional context to weave into the summary.\n\nRun \`ovld protocol record-work --payload-file -\` and stream a JSON object \`{ "objective": "...", "summary": "...", "artifacts": [...], "changeRationales": [...] }\` on stdin via a single-quoted heredoc.\n\nAfter the command succeeds, report the new \`TICKET_ID\`.\n\nRules:\n- Do NOT use this for in-progress work. Use \`/prompt\` for that.\n- The CLI validates that every changed git-tracked file is represented in \`changeRationales\` unless \`--skip-file-change-check\` is passed.\n- If project resolution fails, re-run with \`--project-id <id>\` or \`--personal\`.\n"""`
    }
  ];
}

function isRemovableLegacyGeminiCommandFile({ filePath, content, manifestFiles }) {
  if (manifestFiles.has(filePath)) return true;
  const managed = geminiLegacyCommandFiles().find(file => file.path === filePath);
  if (!managed) return false;
  return content.trim() === managed.content.trim();
}

function removeLegacyGeminiConnectorFiles({ readManifest, writeManifest, readTextFile, existsSync = fs.existsSync.bind(fs), rmSync = fs.rmSync.bind(fs) }) {
  const removed = [];
  const manifest = readManifest();
  const manifestFiles = new Set(manifest.gemini?.files ?? []);

  for (const file of geminiLegacyCommandFiles()) {
    if (!existsSync(file.path)) continue;
    const existing = readTextFile(file.path);
    if (!isRemovableLegacyGeminiCommandFile({ filePath: file.path, content: existing, manifestFiles })) continue;
    rmSync(file.path, { force: true });
    removed.push(file.path);
  }

  for (const filePath of manifestFiles) {
    if (removed.includes(filePath) || !existsSync(filePath)) continue;
    if (!filePath.includes('.gemini/commands') || !filePath.endsWith('.toml')) continue;
    rmSync(filePath, { force: true });
    removed.push(filePath);
  }

  if (manifest.gemini) {
    delete manifest.gemini;
    writeManifest(manifest);
  }

  return removed;
}

const BUNDLE_VERSION = '1.12.0';
const MD_MARKER_START = '<!-- overlord:managed:start -->';
const MD_MARKER_END = '<!-- overlord:managed:end -->';
const MANIFEST_DIR = path.join(os.homedir(), '.ovld');
const MANIFEST_FILE = path.join(MANIFEST_DIR, 'bundle-manifest.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', 'plugins', 'overlord');
const REPO_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'overlord');
const PACKAGE_CLAUDE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', 'plugins', 'claude');
const REPO_CLAUDE_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'claude');
const PACKAGE_CURSOR_PLUGIN_DIR = path.resolve(__dirname, '..', '..', 'plugins', 'cursor');
const REPO_CURSOR_PLUGIN_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'plugins', 'cursor');
const PACKAGE_ANTIGRAVITY_PLUGIN_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'plugins',
  'antigravity'
);
const REPO_ANTIGRAVITY_PLUGIN_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'plugins',
  'antigravity'
);
const ANTIGRAVITY_RUNTIME_SCRIPTS_DIR = path.join(os.homedir(), '.ovld', 'antigravity', 'scripts');
const ANTIGRAVITY_INSTALLED_PLUGINS_DIR = path.join(
  os.homedir(),
  '.gemini',
  'antigravity-cli',
  'plugins'
);
const ANTIGRAVITY_MCP_PATH_PLACEHOLDER = '__OVERLORD_MCP_SCRIPT_PATH__';
const CODEX_TARGET_PLUGIN_DIR = path.join(os.homedir(), '.codex', 'plugins', 'overlord');
const CODEX_TARGET_PLUGIN_MANIFEST = path.join(
  CODEX_TARGET_PLUGIN_DIR,
  '.codex-plugin',
  'plugin.json'
);
const CODEX_TARGET_PLUGIN_HOOKS = path.join(CODEX_TARGET_PLUGIN_DIR, '.codex-plugin', 'hooks.json');
const CODEX_TARGET_USER_PROMPT_HOOK = path.join(
  CODEX_TARGET_PLUGIN_DIR,
  'scripts',
  'user-prompt-submit-hook.sh'
);
const CODEX_TARGET_PERMISSION_HOOK = path.join(
  CODEX_TARGET_PLUGIN_DIR,
  'scripts',
  'permission-hook.sh'
);
const CODEX_TARGET_MARKETPLACE = path.join(os.homedir(), '.agents', 'plugins', 'marketplace.json');
const CODEX_TARGET_RULES = path.join(os.homedir(), '.codex', 'rules', 'default.rules');
const CODEX_LEGACY_AGENTS = path.join(os.homedir(), '.codex', 'AGENTS.md');
const CODEX_RULES_START = '# overlord:permissions:start';
const CODEX_RULES_END = '# overlord:permissions:end';
const REQUIRED_NODE_MAJOR = 20;

const supportedAgents = ['claude', 'codex', 'cursor', 'antigravity', 'opencode'];

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

   Use \`--payload-json\` when the full delivery object fits comfortably inline. For larger or quote-sensitive deliveries, prefer a single JSON payload on stdin:
   \`\`\`bash
   ovld protocol deliver --session-key <sessionKey> --ticket-id $TICKET_ID --payload-file -
   \`\`\`
   This avoids creating a scratch delivery file that needs cleanup. If your runtime cannot provide stdin directly, \`--payload-file .overlord/tmp/deliver.json\` remains supported; treat that file as ephemeral scratch data under \`.overlord/tmp\`, never commit it, and remove it after delivery.

## Change Rationales

Always include \`changeRationales\` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact.

These are structured protocol payloads that Overlord stores as first-class rows in the \`file_changes\` table. Prefer inline JSON or the dedicated command below. For larger full delivery payloads, prefer \`--payload-file -\` so summary, artifacts, and change rationales stay in one JSON document without creating a temporary file. Ordinary deliver artifacts should use \`next_steps\`, \`test_results\`, \`migration\`, \`note\`, \`url\`, or \`decision\`.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\\\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\\\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

Record only meaningful behavioral changes — skip formatting-only noise. Prefer 1–5 concise rationales per ticket, each tied to a specific file and diff hunk.

## Project Discovery & Ticket Creation

When creating tickets from within a repository:
- Prefer \`ovld protocol create --agent claude-code\` by default for draft ticket creation.
- Use \`ovld protocol prompt --agent claude-code\` only when the user explicitly asks to create and execute immediately.
- Both commands can resolve the project from the current working directory; use \`--working-directory\` to override.
- Create multiple tickets when prompts represent different features or goals.
- Add objectives to the same ticket when prompts are sequential steps toward the same feature or goal: \`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`.

\`\`\`bash
ovld protocol create --agent claude-code --objective "Capture follow-up work from this repository"
\`\`\`

\`\`\`bash
ovld protocol prompt --agent claude-code --objective "Implement feature X" --priority medium
\`\`\`

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol attachment-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
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
   For larger delivery JSON, prefer \`--payload-file -\` and stream the full payload on stdin so no scratch file needs to be created or removed. If you use \`--payload-file\`, \`--artifacts-file\`, or \`--change-rationales-file\` with a real path, treat that file as ephemeral scratch data under \`.overlord/tmp\` and remove it after delivery. Do not leave delivery JSON checked into the worktree.

## Change Rationales

Always include \`changeRationales\` when delivering. Before delivering, make sure every meaningful git-tracked file change is represented in \`changeRationales\`; do not send \`file_changes\` as an artifact. Record only meaningful behavioral changes. Overlord stores these as structured rows in the \`file_changes\` table. For larger delivery payloads, prefer \`--payload-file -\` with stdin. If you need a JSON file for transport, keep it ephemeral and out of the repository.

\`\`\`bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \\\\
  --summary "Recorded rationale details for the latest code changes." --phase execute \\\\
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
\`\`\`

## Project Discovery & Ticket Creation

When creating tickets from within a repository:
- Prefer \`ovld protocol create --agent opencode\` by default for draft ticket creation.
- Use \`ovld protocol prompt --agent opencode\` only when the user explicitly asks to create and execute immediately.
- Both commands can resolve the project from the current working directory; use \`--working-directory\` to override.
- Create multiple tickets when prompts represent different features or goals.
- Add objectives to the same ticket when prompts are sequential steps toward the same feature or goal: \`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`.

\`\`\`bash
ovld protocol create --agent opencode --objective "Capture follow-up work from this repository"
\`\`\`

\`\`\`bash
ovld protocol prompt --agent opencode --objective "Implement feature X" --priority medium
\`\`\`

## Context & Artifacts

\`\`\`bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol attachment-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
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
if [ -n "$TICKET_ID" ] && command -v ovld >/dev/null 2>&1; then
  { if [ -n "$BODY" ]; then printf '%s' "$BODY"; else printf '{}'; fi; } \\
    | ovld protocol permission-request --ticket-id "$TICKET_ID" --payload-file - \\
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
Use \`--payload-json\` for compact inline delivery objects. For larger delivery JSON, prefer \`--payload-file -\` with stdin so no scratch file needs to be created or removed. If you use a JSON file for delivery transport, keep it under \`.overlord/tmp\` and remove it after the protocol call.

Rules:
- Always attach first and deliver last.
- Use \`ovld protocol\` commands instead of ad hoc repo scripts for ticket lifecycle work.
- Prefer \`ovld protocol create --agent cursor\` for draft ticket creation; use \`prompt --agent cursor\` only for create-and-execute requests.
- Create multiple tickets when prompts represent different features/goals; add objectives to the same ticket when prompts are sequential steps toward one feature/goal.
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

/**
 * Quietly report whether an agent connector is installed: present in the bundle
 * manifest with all of its recorded files still on disk. Unlike `doctorAgent`,
 * this logs nothing and ignores version/hash staleness — a stale-but-present
 * connector can still launch. Used to gate `ovld <agent>` direct launches.
 */
export function isAgentConnectorInstalled(agent) {
  const manifest = readManifest();
  const entry = manifest[agent];
  if (!entry || !Array.isArray(entry.files)) return false;
  return entry.files.every(file => fs.existsSync(file));
}

/** The built-in agents whose connectors are currently installed. */
export function listInstalledConnectors() {
  return supportedAgents.filter(agent => isAgentConnectorInstalled(agent));
}

function slashCommandFiles(agent) {
  if (agent === 'claude') {
    const base = path.join(os.homedir(), '.claude', 'commands');
    return [
      {
        path: path.join(base, 'connect.md'),
        content: `---
description: Connect this session to another Overlord ticket by ticket identifier
argument-hint: <ticket_id>
disable-model-invocation: true
---

Run \`ovld protocol connect --ticket-id <ticket_id>\` using \`$ARGUMENTS\` as the ticket ID.`
      },
      {
        path: path.join(base, 'load.md'),
        content: `---
description: Load Overlord ticket context without creating a new session
argument-hint: <ticket_id>
disable-model-invocation: true
---

Run \`ovld protocol load-context --ticket-id <ticket_id>\` using \`$ARGUMENTS\` as the ticket ID.`
      },
      {
        path: path.join(base, 'create.md'),
        content: `---
description: Create a draft Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

Run \`ovld protocol create --agent claude-code\` with \`$ARGUMENTS\`. If no flags are present, treat the arguments as the objective and call \`ovld protocol create --agent claude-code --objective "<objective>"\`.`
      },
      {
        path: path.join(base, 'prompt.md'),
        content: `---
description: Create a new Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

Run \`ovld protocol prompt --agent claude-code\` with \`$ARGUMENTS\`. If no flags are present, treat the arguments as the objective and call \`ovld protocol prompt --agent claude-code --objective "<objective>"\`.`
      },
      {
        path: path.join(base, 'record-work.md'),
        content: `---
description: Record completed-from-chat work as a ticket in review + feed post (no attach)
argument-hint: [optional additional context]
disable-model-invocation: true
---

Immediately record the work you just completed in this chat as a new Overlord ticket via \`ovld protocol record-work\`. No agent session is opened — the work is already done.

Synthesize from the current conversation: \`objective\` (what was asked/done), \`summary\` (reviewer-friendly narrative), \`changeRationales\` (one entry per meaningful git-tracked file change — \`label\`, \`file_path\`, \`summary\`, \`why\`, \`impact\`, optional \`hunks\`; use \`git status\`/\`git diff\` to enumerate), and optional \`artifacts\` (\`next_steps\`, \`test_results\`, \`decision\`, \`note\`, \`url\`).

If \`$ARGUMENTS\` is non-empty, treat it as additional context for the summary.

Run \`ovld protocol record-work --payload-file -\` and stream the JSON payload \`{ "objective": "...", "summary": "...", "artifacts": [...], "changeRationales": [...] }\` on stdin via a single-quoted heredoc. Report the new \`TICKET_ID\`.

Do NOT use this for in-progress work — use \`/prompt\` for that. The CLI validates that every changed git-tracked file is represented in \`changeRationales\` unless \`--skip-file-change-check\` is passed. If project resolution fails, re-run with \`--project-id <id>\` or \`--personal\`.`
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
        path: path.join(base, 'create.md'),
        content:
          'Create a draft Overlord ticket.\n\nRun `ovld protocol create --agent cursor --objective "<objective>"` using the text after `/create` unless raw flags were provided. If raw flags were provided, pass them after `ovld protocol create --agent cursor`.\n'
      },
      {
        path: path.join(base, 'prompt.md'),
        content:
          'Create a new Overlord ticket.\n\nRun `ovld protocol prompt --agent cursor --objective "<objective>"` using the text after `/prompt` unless raw flags were provided. If raw flags were provided, pass them after `ovld protocol prompt --agent cursor`.\n'
      },
      {
        path: path.join(base, 'record-work.md'),
        content:
          'Record completed-from-chat work as a ticket in review + feed post (no attach).\n\nImmediately record the work you just completed in this chat as a new Overlord ticket via `ovld protocol record-work`. No agent session is opened — the work is already done.\n\nSynthesize from the current conversation: `objective` (what was asked/done), `summary` (reviewer-friendly narrative), `changeRationales` (one entry per meaningful git-tracked file change — `label`, `file_path`, `summary`, `why`, `impact`, optional `hunks`; use `git status`/`git diff` to enumerate), and optional `artifacts` (`next_steps`, `test_results`, `decision`, `note`, `url`).\n\nIf text was provided after `/record-work`, treat it as additional context for the summary.\n\nRun `ovld protocol record-work --payload-file -` and stream the JSON payload on stdin via a single-quoted heredoc. Report the new TICKET_ID.\n\nDo NOT use for in-progress work — use `/prompt` for that. The CLI validates that every changed git-tracked file is represented in `changeRationales` unless `--skip-file-change-check` is passed. If project resolution fails, re-run with `--project-id <id>` or `--personal`.\n'
      }
    ];
  }

  if (agent === 'gemini') {
    return geminiLegacyCommandFiles();
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
      path: path.join(base, 'create.md'),
      content: `---
description: Create a draft Overlord ticket from the current conversation
agent: build
---

Run \`ovld protocol create --agent opencode\` with \`$ARGUMENTS\`. If no flags are present, treat the arguments as the objective and call \`ovld protocol create --agent opencode --objective "<objective>"\`.`
    },
    {
      path: path.join(base, 'prompt.md'),
      content: `---
description: Create a new Overlord ticket from the current conversation
agent: build
---

Run \`ovld protocol prompt --agent opencode\` with \`$ARGUMENTS\`. If no flags are present, treat the arguments as the objective and call \`ovld protocol prompt --agent opencode --objective "<objective>"\`.`
    },
    {
      path: path.join(base, 'record-work.md'),
      content: `---
description: Record completed-from-chat work as a ticket in review + feed post (no attach)
agent: build
---

Immediately record the work you just completed in this chat as a new Overlord ticket via \`ovld protocol record-work\`. No agent session is opened — the work is already done.

Synthesize from the current conversation: \`objective\` (what was asked/done), \`summary\` (reviewer-friendly narrative), \`changeRationales\` (one entry per meaningful git-tracked file change — \`label\`, \`file_path\`, \`summary\`, \`why\`, \`impact\`, optional \`hunks\`; use \`git status\`/\`git diff\` to enumerate), and optional \`artifacts\` (\`next_steps\`, \`test_results\`, \`decision\`, \`note\`, \`url\`).

If \`$ARGUMENTS\` is non-empty, treat it as additional context for the summary.

Run \`ovld protocol record-work --payload-file -\` and stream the JSON payload on stdin via a single-quoted heredoc. Report the new \`TICKET_ID\`.

Do NOT use for in-progress work — use \`/prompt\` for that. The CLI validates that every changed git-tracked file is represented in \`changeRationales\` unless \`--skip-file-change-check\` is passed. If project resolution fails, re-run with \`--project-id <id>\` or \`--personal\`.`
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

function uninstallSlashCommands(agent) {
  const removedFiles = [];
  const files = slashCommandFiles(agent);
  for (const file of files) {
    if (!fs.existsSync(file.path)) continue;
    const existing = readTextFile(file.path);
    if (existing.trim() !== file.content.trim()) continue;
    fs.rmSync(file.path, { force: true });
    removedFiles.push(file.path);
  }
  return { removedFiles };
}

function currentContentHashForAgent(agent) {
  if (agent === 'claude') {
    return claudeContentHash();
  }
  if (agent === 'cursor') {
    return contentHashForDirectory(cursorSourcePluginDir());
  }
  if (agent === 'antigravity') {
    return antigravityContentHash();
  }
  if (agent === 'codex') return codexContentHash();
  return contentHash(
    [OPENCODE_AGENTS_SECTION, ...slashCommandFiles('opencode').map(file => file.content)].join('\n')
  );
}

function codexSourcePluginDir() {
  if (fs.existsSync(PACKAGE_PLUGIN_DIR)) return PACKAGE_PLUGIN_DIR;
  if (fs.existsSync(REPO_PLUGIN_DIR)) return REPO_PLUGIN_DIR;
  throw new Error(
    `Codex plugin bundle not found. Checked ${PACKAGE_PLUGIN_DIR} and ${REPO_PLUGIN_DIR}.`
  );
}

function claudeSourcePluginDir() {
  if (fs.existsSync(PACKAGE_CLAUDE_PLUGIN_DIR)) return PACKAGE_CLAUDE_PLUGIN_DIR;
  if (fs.existsSync(REPO_CLAUDE_PLUGIN_DIR)) return REPO_CLAUDE_PLUGIN_DIR;
  throw new Error(
    `Claude plugin bundle not found. Checked ${PACKAGE_CLAUDE_PLUGIN_DIR} and ${REPO_CLAUDE_PLUGIN_DIR}.`
  );
}

function cursorSourcePluginDir() {
  if (fs.existsSync(PACKAGE_CURSOR_PLUGIN_DIR)) return PACKAGE_CURSOR_PLUGIN_DIR;
  if (fs.existsSync(REPO_CURSOR_PLUGIN_DIR)) return REPO_CURSOR_PLUGIN_DIR;
  throw new Error(
    `Cursor plugin bundle not found. Checked ${PACKAGE_CURSOR_PLUGIN_DIR} and ${REPO_CURSOR_PLUGIN_DIR}.`
  );
}

function antigravitySourcePluginDir() {
  if (fs.existsSync(PACKAGE_ANTIGRAVITY_PLUGIN_DIR)) return PACKAGE_ANTIGRAVITY_PLUGIN_DIR;
  if (fs.existsSync(REPO_ANTIGRAVITY_PLUGIN_DIR)) return REPO_ANTIGRAVITY_PLUGIN_DIR;
  throw new Error(
    `Antigravity plugin bundle not found. Checked ${PACKAGE_ANTIGRAVITY_PLUGIN_DIR} and ${REPO_ANTIGRAVITY_PLUGIN_DIR}.`
  );
}

function antigravityContentHash() {
  return contentHashForDirectory(antigravitySourcePluginDir());
}

function antigravityPaths() {
  return {
    policyFile: path.join(os.homedir(), '.gemini', 'policies', 'overlord-protocol.toml'),
    installedPluginJson: path.join(ANTIGRAVITY_INSTALLED_PLUGINS_DIR, 'plugin.json'),
    installedHooks: path.join(ANTIGRAVITY_INSTALLED_PLUGINS_DIR, 'hooks.json'),
    installedMcp: path.join(ANTIGRAVITY_INSTALLED_PLUGINS_DIR, 'mcp_config.json'),
    runtimeMcp: path.join(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, 'overlord-mcp.mjs'),
    runtimeHook: path.join(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, 'user-prompt-submit-hook.sh')
  };
}

function ensureAntigravityRuntimeScripts(sourceDir) {
  const scriptNames = ['overlord-mcp.mjs', 'user-prompt-submit-hook.sh'];
  fs.mkdirSync(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, { recursive: true });

  for (const scriptName of scriptNames) {
    const sourcePath = path.join(sourceDir, 'scripts', scriptName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Antigravity runtime script missing: ${sourcePath}`);
    }
    const targetPath = path.join(ANTIGRAVITY_RUNTIME_SCRIPTS_DIR, scriptName);
    fs.copyFileSync(sourcePath, targetPath);
    if (scriptName.endsWith('.sh')) {
      fs.chmodSync(targetPath, 0o755);
    }
  }
}

function patchAntigravityMcpServers(servers, mcpScriptPath) {
  if (!servers || typeof servers !== 'object') return;
  for (const entry of Object.values(servers)) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.args)) continue;
    const referencesOverlordMcp = entry.args.some(
      arg =>
        arg === ANTIGRAVITY_MCP_PATH_PLACEHOLDER ||
        (typeof arg === 'string' && arg.includes('overlord-mcp'))
    );
    if (referencesOverlordMcp) {
      entry.args = [mcpScriptPath];
      entry.command = entry.command ?? 'node';
    }
  }
}

function patchAntigravityInstalledPaths({ mcpScriptPath, hookScriptPath }) {
  const paths = antigravityPaths();

  if (fs.existsSync(paths.installedHooks)) {
    const hooks = readJsonFile(paths.installedHooks);
    const groups = hooks.hooks && typeof hooks.hooks === 'object' ? hooks.hooks : null;
    if (groups) {
      for (const eventHooks of Object.values(groups)) {
        if (!Array.isArray(eventHooks)) continue;
        for (const group of eventHooks) {
          if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) continue;
          for (const hook of group.hooks) {
            if (hook?.type !== 'command') continue;
            hook.command = hookScriptPath;
          }
        }
      }
      writeJsonFile(paths.installedHooks, hooks);
    }
  }

  if (fs.existsSync(paths.installedMcp)) {
    const mcpConfig = readJsonFile(paths.installedMcp);
    patchAntigravityMcpServers(mcpConfig.mcpServers, mcpScriptPath);
    writeJsonFile(paths.installedMcp, mcpConfig);
  }

  if (fs.existsSync(paths.installedPluginJson)) {
    const pluginJson = readJsonFile(paths.installedPluginJson);
    patchAntigravityMcpServers(pluginJson.mcpServers, mcpScriptPath);
    writeJsonFile(paths.installedPluginJson, pluginJson);
  }
}

function runAgyPluginInstall(sourceDir) {
  try {
    execFileSync('agy', ['plugin', 'install', sourceDir], { stdio: 'inherit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already') || message.includes('imported')) {
      execFileSync('agy', ['plugin', 'import', '--force', sourceDir], { stdio: 'inherit' });
      return;
    }
    throw error;
  }
}

function removeLegacyGeminiConnector() {
  return removeLegacyGeminiConnectorFiles({
    readManifest,
    writeManifest,
    readTextFile
  });
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFilesRecursive(resolved);
    return [resolved];
  });
}

function contentHashForDirectory(sourceDir) {
  const hash = crypto.createHash('sha256');

  for (const filePath of listFilesRecursive(sourceDir).sort()) {
    hash.update(path.relative(sourceDir, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  return hash.digest('hex').slice(0, 16);
}

function codexContentHash() {
  return contentHashForDirectory(codexSourcePluginDir());
}

function claudeContentHash() {
  return contentHashForDirectory(claudeSourcePluginDir());
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

function removeLegacyClaudeBundle() {
  const paths = claudePaths();
  const removed = [];

  if (fs.existsSync(paths.skillDir)) {
    fs.rmSync(paths.skillDir, { recursive: true, force: true });
    removed.push(paths.skillDir);
  }

  if (fs.existsSync(paths.hookScript)) {
    fs.rmSync(paths.hookScript, { force: true });
    removed.push(paths.hookScript);
  }

  const slashResult = uninstallSlashCommands('claude');
  removed.push(...slashResult.removedFiles);

  if (fs.existsSync(paths.settingsFile)) {
    const settings = readJsonFile(paths.settingsFile);
    let changed = false;

    if (settings.__overlord_managed) {
      delete settings.__overlord_managed;
      changed = true;
    }

    const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
    if (Array.isArray(hooks.PermissionRequest)) {
      const nextPermissionHooks = hooks.PermissionRequest.filter(hook => {
        if (hook && typeof hook === 'object' && Array.isArray(hook.hooks)) {
          return !hook.hooks.some(
            inner =>
              typeof inner?.command === 'string' &&
              inner.command.includes('overlord-permission-hook')
          );
        }
        return true;
      });
      if (nextPermissionHooks.length !== hooks.PermissionRequest.length) {
        changed = true;
        if (nextPermissionHooks.length > 0) hooks.PermissionRequest = nextPermissionHooks;
        else delete hooks.PermissionRequest;
      }
    }

    if (changed) {
      if (Object.keys(hooks).length > 0) settings.hooks = hooks;
      else delete settings.hooks;
      writeJsonFile(paths.settingsFile, settings);
      removed.push(paths.settingsFile);
    }
  }

  return removed;
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
    pluginDir: path.join(base, 'plugins', 'local', 'overlord'),
    pluginManifest: path.join(
      base,
      'plugins',
      'local',
      'overlord',
      '.cursor-plugin',
      'plugin.json'
    ),
    rulesFile: path.join(base, 'rules', 'overlord-local.mdc'),
    settingsFile: path.join(base, 'settings.json'),
    hooksFile: path.join(base, 'hooks.json')
  };
}

const CURSOR_USER_PROMPT_HOOK_RELATIVE = 'plugins/local/overlord/hooks/overlord-user-prompt-submit.sh';

function isOverlordCursorBeforeSubmitHook(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const cmd = typeof entry.command === 'string' ? entry.command : '';
  return cmd.includes('overlord-user-prompt-submit');
}

function mergeCursorBeforeSubmitHook(paths) {
  const hooksFile = paths.hooksFile;
  const base = fs.existsSync(hooksFile)
    ? readJsonFile(hooksFile)
    : { version: 1, hooks: {} };
  const hooks = base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks) ? base.hooks : {};
  const existing = Array.isArray(hooks.beforeSubmitPrompt) ? hooks.beforeSubmitPrompt : [];
  hooks.beforeSubmitPrompt = [
    ...existing.filter(entry => !isOverlordCursorBeforeSubmitHook(entry)),
    { command: CURSOR_USER_PROMPT_HOOK_RELATIVE }
  ];
  writeJsonFile(hooksFile, {
    ...base,
    version: typeof base.version === 'number' ? base.version : 1,
    hooks
  });
}

function removeCursorBeforeSubmitHook(paths) {
  const hooksFile = paths.hooksFile;
  if (!fs.existsSync(hooksFile)) return;
  const base = readJsonFile(hooksFile);
  const hooks = base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks) ? base.hooks : {};
  if (!Array.isArray(hooks.beforeSubmitPrompt)) return;
  hooks.beforeSubmitPrompt = hooks.beforeSubmitPrompt.filter(
    entry => !isOverlordCursorBeforeSubmitHook(entry)
  );
  if (hooks.beforeSubmitPrompt.length === 0) {
    delete hooks.beforeSubmitPrompt;
  }
  if (Object.keys(hooks).length === 0) {
    delete base.hooks;
  } else {
    base.hooks = hooks;
  }
  writeJsonFile(hooksFile, base);
}


function installClaude() {
  const sourceDir = claudeSourcePluginDir();
  const sourceManifest = path.join(sourceDir, '.claude-plugin', 'plugin.json');
  const sourceVersion = pluginVersion(sourceManifest) ?? '0.0.0';
  const removed = removeLegacyClaudeBundle();

  console.log(`  ✓ Found Claude plugin source: ${sourceDir}`);
  if (removed.length > 0) {
    console.log('  ✓ Migrated v3.25 Claude connector files:');
    for (const filePath of removed) console.log(`      ${filePath}`);
  } else {
    console.log('  ✓ No v3.25 Claude connector files needed migration.');
  }
  console.log('  ✓ `ovld launch claude` now loads this plugin with `claude --plugin-dir`.');

  const manifest = readManifest();
  manifest.claude = {
    version: sourceVersion,
    contentHash: currentContentHashForAgent('claude'),
    installedAt: new Date().toISOString(),
    files: listFilesRecursive(sourceDir)
  };
  writeManifest(manifest);

  return { ok: true, backups: [] };
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
        'ovld protocol *': 'allow'
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
  installCodexHookCommand();
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

function rewriteCodexHookCommands({ hooks, eventName, targetCommand }) {
  const groups = hooks.hooks?.[eventName];
  if (!Array.isArray(groups)) {
    throw new Error(`Codex ${eventName} hook missing in ${CODEX_TARGET_PLUGIN_HOOKS}`);
  }

  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) continue;
    for (const hook of group.hooks) {
      if (hook?.type === 'command') {
        hook.command = targetCommand;
      }
    }
  }
}

function installCodexHookCommand() {
  const hooks = readJsonFile(CODEX_TARGET_PLUGIN_HOOKS);
  if (!hooks || typeof hooks !== 'object') {
    throw new Error(`Codex hook manifest missing or invalid at ${CODEX_TARGET_PLUGIN_HOOKS}`);
  }

  rewriteCodexHookCommands({
    hooks,
    eventName: 'PermissionRequest',
    targetCommand: CODEX_TARGET_PERMISSION_HOOK
  });
  rewriteCodexHookCommands({
    hooks,
    eventName: 'UserPromptSubmit',
    targetCommand: CODEX_TARGET_USER_PROMPT_HOOK
  });

  writeJsonFile(CODEX_TARGET_PLUGIN_HOOKS, hooks);
}

function installCursor() {
  const paths = cursorPaths();
  const backups = [];
  const sourceDir = cursorSourcePluginDir();
  fs.mkdirSync(path.dirname(paths.pluginDir), { recursive: true });
  fs.rmSync(paths.pluginDir, { recursive: true, force: true });
  fs.cpSync(sourceDir, paths.pluginDir, { recursive: true });
  console.log(`  ✓ Installed plugin: ${paths.pluginDir}`);

  if (fs.existsSync(paths.rulesFile)) {
    fs.rmSync(paths.rulesFile, { force: true });
    console.log(`  ✓ Removed legacy rules file: ${paths.rulesFile}`);
  }
  const removedLegacySlash = uninstallSlashCommands('cursor');
  if (removedLegacySlash.removedFiles.length > 0) {
    console.log('  ✓ Removed legacy slash commands:');
    for (const filePath of removedLegacySlash.removedFiles) console.log(`      ${filePath}`);
  }

  const hooksBackup = backupFile(paths.hooksFile);
  if (hooksBackup) {
    backups.push(hooksBackup);
    console.log(`  ✓ Backed up: ${paths.hooksFile} → ${path.basename(hooksBackup)}`);
  }
  mergeCursorBeforeSubmitHook(paths);
  console.log(`  ✓ Registered Cursor beforeSubmitPrompt hook: ${paths.hooksFile}`);

  const existingSettings = readJsonFile(paths.settingsFile);
  const permissions =
    existingSettings.permissions && typeof existingSettings.permissions === 'object'
      ? existingSettings.permissions
      : {};
  const mergedAllow = Array.from(
    new Set([...asStringArray(permissions.allow), 'Shell(ovld protocol:*)'])
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
    version: pluginVersion(paths.pluginManifest) ?? '0.0.0',
    contentHash: currentContentHashForAgent('cursor'),
    installedAt: new Date().toISOString(),
    files: [...listFilesRecursive(paths.pluginDir), paths.settingsFile, paths.hooksFile]
  };
  writeManifest(manifest);

  return { ok: true, backups };
}

function installAntigravity() {
  const sourceDir = antigravitySourcePluginDir();
  const paths = antigravityPaths();
  const removed = removeLegacyGeminiConnector();

  if (removed.length > 0) {
    console.log('  ✓ Migrated legacy Gemini connector files:');
    for (const filePath of removed) console.log(`      ${filePath}`);
  }

  ensureAntigravityRuntimeScripts(sourceDir);
  console.log(`  ✓ Staged runtime scripts: ${ANTIGRAVITY_RUNTIME_SCRIPTS_DIR}`);

  runAgyPluginInstall(sourceDir);
  console.log(`  ✓ Installed Antigravity plugin via agy: ${ANTIGRAVITY_INSTALLED_PLUGINS_DIR}`);

  patchAntigravityInstalledPaths({
    mcpScriptPath: paths.runtimeMcp,
    hookScriptPath: paths.runtimeHook
  });
  console.log('  ✓ Patched installed MCP and hook paths');

  const policyContent = [
    '# Managed by Overlord onboarding',
    '[[rule]]',
    'toolName = "run_shell_command"',
    'commandPrefix = "ovld protocol"',
    'decision = "allow"',
    'priority = 900',
    ''
  ].join('\n');
  writeTextFile(paths.policyFile, policyContent);
  console.log(`  ✓ Installed policy: ${paths.policyFile}`);

  const installedFiles = [
    paths.policyFile,
    paths.runtimeMcp,
    paths.runtimeHook,
    paths.installedPluginJson,
    paths.installedHooks,
    paths.installedMcp
  ].filter(filePath => fs.existsSync(filePath));

  const manifest = readManifest();
  manifest.antigravity = {
    version: pluginVersion(path.join(sourceDir, 'plugin.json')) ?? '0.0.0',
    contentHash: currentContentHashForAgent('antigravity'),
    installedAt: new Date().toISOString(),
    files: installedFiles
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
    agent === 'claude'
      ? pluginVersion(path.join(claudeSourcePluginDir(), '.claude-plugin', 'plugin.json'))
      : agent === 'codex'
        ? pluginVersion(path.join(codexSourcePluginDir(), '.codex-plugin', 'plugin.json'))
        : agent === 'cursor'
          ? pluginVersion(path.join(cursorSourcePluginDir(), '.cursor-plugin', 'plugin.json'))
          : agent === 'antigravity'
            ? pluginVersion(path.join(antigravitySourcePluginDir(), 'plugin.json'))
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
// Interactive checkbox prompt
// ---------------------------------------------------------------------------

/**
 * Run an interactive checkbox list (multiselect with spacebar).
 *
 * @param {object}   opts
 * @param {string}   opts.message    - Prompt message shown above the list
 * @param {string[]} opts.choices    - List of choice labels
 * @param {string[]} [opts.defaults] - Initially selected choices
 * @returns {Promise<string[]>} - Array of selected choice labels
 */
function runCheckboxPrompt({ message, choices, defaults = [] }) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.resolve(defaults);
  }

  return new Promise(resolve => {
    const hide = '\x1b[?25l';
    const show = '\x1b[?25h';
    const saveCursor = '\x1b7';
    const restoreCursor = '\x1b8';
    const eraseBelow = '\x1b[J';
    const cyan = s => `\x1b[36m${s}\x1b[0m`;
    const bold = s => `\x1b[1m${s}\x1b[0m`;
    const dim = s => `\x1b[2m${s}\x1b[0m`;

    let cursorIdx = 0;
    let selected = new Set(defaults);
    let hasRendered = false;

    function render() {
      const lines = [];
      lines.push(bold(message));
      lines.push(dim('  ↑↓ navigate · Space toggle · Enter confirm · Esc cancel'));
      lines.push('');

      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        const isSelected = selected.has(choice);
        const isCursor = i === cursorIdx;
        const checkbox = isSelected ? '[✓]' : '[ ]';
        const marker = isCursor ? cyan('▶') : ' ';
        const label = isCursor ? bold(choice) : choice;
        lines.push(`  ${marker} ${checkbox} ${label}`);
      }

      if (hasRendered) {
        process.stdout.write(restoreCursor + eraseBelow);
      }
      process.stdout.write(saveCursor + lines.join('\n'));
      hasRendered = true;
    }

    function cleanup() {
      if (hasRendered) {
        process.stdout.write(restoreCursor + eraseBelow);
      }
      process.stdin.setRawMode(false);
      process.stdin.removeAllListeners('data');
      process.stdout.write(show);
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write(hide);
    render();

    process.stdin.on('data', key => {
      // Ctrl-C / Ctrl-D → exit
      if (key === '\x03' || key === '\x04') {
        cleanup();
        process.exit(0);
      }

      // Escape → cancel
      if (key === '\x1b') {
        cleanup();
        resolve([]);
        return;
      }

      // Enter → confirm selection
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(Array.from(selected));
        return;
      }

      // Arrow up
      if (key === '\x1b[A') {
        cursorIdx = (cursorIdx - 1 + choices.length) % choices.length;
        render();
        return;
      }

      // Arrow down
      if (key === '\x1b[B') {
        cursorIdx = (cursorIdx + 1) % choices.length;
        render();
        return;
      }

      // Spacebar → toggle selection
      if (key === ' ') {
        const choice = choices[cursorIdx];
        if (selected.has(choice)) {
          selected.delete(choice);
        } else {
          selected.add(choice);
        }
        render();
        return;
      }
    });
  });
}

/**
 * Ask a yes/no question interactively.
 *
 * @param {string} question - The question to ask
 * @param {boolean} defaultYes - Default answer if user just presses Enter
 * @returns {Promise<boolean>} - true if yes, false if no
 */
function askYesNo(question, defaultYes = true) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.resolve(defaultYes);
  }

  return new Promise(resolve => {
    const hide = '\x1b[?25l';
    const show = '\x1b[?25h';
    const saveCursor = '\x1b7';
    const restoreCursor = '\x1b8';
    const eraseBelow = '\x1b[J';
    const cyan = s => `\x1b[36m${s}\x1b[0m`;
    const bold = s => `\x1b[1m${s}\x1b[0m`;
    const dim = s => `\x1b[2m${s}\x1b[0m`;

    const choices = ['Yes', 'No'];
    let cursorIdx = defaultYes ? 0 : 1;
    let hasRendered = false;

    function render() {
      const lines = [];
      lines.push(bold(question));
      lines.push('');

      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        const isCursor = i === cursorIdx;
        const marker = isCursor ? cyan('▶') : ' ';
        const label = isCursor ? bold(choice) : choice;
        lines.push(`  ${marker} ${label}`);
      }

      lines.push('');
      lines.push(dim('  ↑↓ navigate · Enter confirm · Esc cancel'));

      if (hasRendered) {
        process.stdout.write(restoreCursor + eraseBelow);
      }
      process.stdout.write(saveCursor + lines.join('\n'));
      hasRendered = true;
    }

    function cleanup() {
      if (hasRendered) {
        process.stdout.write(restoreCursor + eraseBelow);
      }
      process.stdin.setRawMode(false);
      process.stdin.removeAllListeners('data');
      process.stdout.write(show);
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdout.write(hide);
    render();

    process.stdin.on('data', key => {
      // Ctrl-C / Ctrl-D → exit
      if (key === '\x03' || key === '\x04') {
        cleanup();
        process.exit(0);
      }

      // Escape → cancel (default to No)
      if (key === '\x1b') {
        cleanup();
        resolve(false);
        return;
      }

      // Enter → confirm selection
      if (key === '\r' || key === '\n') {
        cleanup();
        resolve(cursorIdx === 0);
        return;
      }

      // Arrow up
      if (key === '\x1b[A') {
        cursorIdx = (cursorIdx - 1 + choices.length) % choices.length;
        render();
        return;
      }

      // Arrow down
      if (key === '\x1b[B') {
        cursorIdx = (cursorIdx + 1) % choices.length;
        render();
        return;
      }

      // y/Y → yes
      if (key === 'y' || key === 'Y') {
        cleanup();
        resolve(true);
        return;
      }

      // n/N → no
      if (key === 'n' || key === 'N') {
        cleanup();
        resolve(false);
        return;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Agent permissions installation
// ---------------------------------------------------------------------------

function getPlatformUrl() {
  // Check for OVERLORD_URL env var first, otherwise default to localhost
  return process.env.OVERLORD_URL || 'http://localhost:3000';
}

function printAgentPermissionsDescription() {
  console.log('Agent permissions pre-approve the `ovld protocol` commands your coding');
  console.log('agent runs to drive Overlord tickets (attach, update, deliver, etc.) so');
  console.log('you aren\'t prompted to approve each call mid-task. Without this, the');
  console.log('agent stalls on permission prompts for every protocol step.');
  console.log('');
  console.log('Where each agent\'s permission is written:');
  console.log('  • Claude Code — ./.claude/settings.local.json (this directory only)');
  console.log('  • OpenCode    — ~/.config/opencode/opencode.json (global)');
  console.log('  • Codex       — prints a one-time command to run inside Codex');
  console.log('Each entry is plain JSON you can review or remove at any time.\n');
}

function installAgentPermissions(agents, platformUrl) {
  console.log(`\nInstalling agent permissions for: ${agents.join(', ')}`);
  console.log(`Platform URL: ${platformUrl}\n`);

  for (const agent of agents) {
    if (agent === 'claude') {
      installClaudePermissions(platformUrl);
    } else if (agent === 'opencode') {
      installOpenCodePermissions(platformUrl);
    } else if (agent === 'codex') {
      installCodexPermissions(platformUrl);
    }
    // cursor and antigravity use global policy files instead of project-local permission JSON
  }
}

function installClaudePermissions(platformUrl) {
  const settingsPath = path.join(process.cwd(), '.claude', 'settings.local.json');
  console.log(`--- Claude Code ---`);
  console.log(`Settings file: ${settingsPath}`);

  let settings = { permissions: { allow: [] } };
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch (e) {
      console.error(`  ERROR: Could not parse ${settingsPath}: ${e.message}`);
      return false;
    }
    if (!settings.permissions) settings.permissions = {};
    if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
  }

  const entries = ['Bash(ovld protocol:*)'];

  const existing = new Set(settings.permissions.allow);
  const toAdd = entries.filter(e => !existing.has(e));

  if (toAdd.length === 0) {
    console.log('  All required permissions already present. Nothing to do.\n');
    return true;
  }

  console.log(`  Adding ${toAdd.length} permission entries:`);
  for (const entry of toAdd) {
    console.log(`    + ${entry}`);
  }

  // Backup
  if (fs.existsSync(settingsPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${settingsPath}.backup-${ts}`;
    fs.copyFileSync(settingsPath, backupPath);
    console.log(`  Backup: ${backupPath}`);
  }

  settings.permissions.allow = [...settings.permissions.allow, ...toAdd];

  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('  Settings updated.\n');
  return true;
}

function installOpenCodePermissions(_platformUrl) {
  console.log(`--- OpenCode ---`);
  const configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  console.log(`Config file: ${configPath}`);

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      console.error(`  ERROR: Could not parse ${configPath}: ${e.message}`);
      return false;
    }
  }

  const existingPermission =
    config.permission && typeof config.permission === 'object' ? config.permission : {};
  const existingBash =
    existingPermission.bash && typeof existingPermission.bash === 'object'
      ? existingPermission.bash
      : {};

  const next = {
    ...config,
    $schema: 'https://opencode.ai/config.json',
    permission: {
      ...existingPermission,
      bash: {
        '*': 'ask',
        ...existingBash,
        'ovld protocol *': 'allow'
      }
    }
  };

  if (fs.existsSync(configPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${configPath}.backup-${ts}`;
    fs.copyFileSync(configPath, backupPath);
    console.log(`  Backup: ${backupPath}`);
  }

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n');
  console.log('  Config updated.\n');
  return true;
}

function installCodexPermissions() {
  console.log(`--- Codex ---`);
  console.log('  Codex does not support file-based permission configuration.');
  console.log('  To warm up permissions, run the following command once inside a Codex session:');
  console.log('  (Codex will prompt for approval; approve it to persist the prefix.)\n');
  console.log('  ovld protocol help');
  console.log();
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runSetupCommand(args) {
  const agent = args[0];

  if (agent === '--help' || agent === '-h' || agent === 'help') {
    console.log(`Usage:
  ovld setup           Interactive setup (select agents and configure permissions)
  ovld setup claude    Prepare the Overlord Claude plugin and migrate v3.25 connector files
  ovld setup codex     Install Overlord Codex plugin bundle
  ovld setup cursor    Install Overlord Cursor local plugin and permissions
  ovld setup antigravity  Install Overlord Antigravity plugin (agy) and protocol policy rules
  ovld setup opencode  Install Overlord connector for OpenCode
  ovld setup all       Prepare all supported agents
  ovld doctor          Validate installed connectors and check for CLI updates`);
    return;
  }

  // Interactive mode when called without arguments
  if (!agent) {
    console.log('Welcome to Overlord agent setup!\n');

    // Step 1: Select agents to install
    const agentLabels = supportedAgents.map(a => {
      const descriptions = {
        claude: 'Claude Code',
        codex: 'Codex',
        cursor: 'Cursor',
        antigravity: 'Antigravity CLI',
        opencode: 'OpenCode'
      };
      return `${a.padEnd(10)} - ${descriptions[a] || a}`;
    });

    const selectedLabels = await runCheckboxPrompt({
      message: 'Select agent plugins/connectors to prepare (Space to toggle, Enter to confirm):',
      choices: agentLabels,
      defaults: []
    });

    if (selectedLabels.length === 0) {
      console.log('\nNo agents selected. Setup cancelled.');
      return;
    }

    // Extract agent names from selected labels
    const selectedAgents = selectedLabels.map(label => label.split('-')[0].trim());

    // Step 2: Install selected agents
    console.log(
      `\nPreparing Overlord agent plugins/connectors for: ${selectedAgents.join(', ')}...\n`
    );

    const installedAgents = [];
    for (const a of selectedAgents) {
      console.log(`[${a}]`);
      try {
        if (a === 'claude') installClaude();
        else if (a === 'codex') installCodex();
        else if (a === 'cursor') installCursor();
        else if (a === 'antigravity') installAntigravity();
        else installOpenCode();
        installedAgents.push(a);
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
      }
      console.log();
    }

    if (installedAgents.length === 0) {
      console.log('No agents were successfully installed.');
      return;
    }

    // Step 3: Offer to configure agent permissions
    const agentsThatNeedPermissions = installedAgents.filter(a =>
      ['claude', 'codex', 'opencode'].includes(a)
    );

    if (agentsThatNeedPermissions.length > 0) {
      console.log('Agent plugins/connectors prepared successfully!\n');

      printAgentPermissionsDescription();
      const shouldInstallPermissions = await askYesNo(
        'Would you like to configure agent permissions for Overlord protocol access?',
        true
      );

      if (shouldInstallPermissions) {
        const platformUrl = getPlatformUrl();
        installAgentPermissions(agentsThatNeedPermissions, platformUrl);
        console.log('✓ Agent permissions configured.\n');
      } else {
        console.log('\nSkipped agent permissions configuration.');
        console.log('You can run the permission installer later with:');
        console.log('  node scripts/install-agent-permissions.mjs\n');
      }
    }

    console.log('Setup complete! Run `ovld doctor` to verify your installation.');
    return;
  }

  if (agent === 'all') {
    console.log('Preparing Overlord agent plugins/connectors for all supported agents...\n');
    const installedAgents = [];

    for (const a of supportedAgents) {
      console.log(`[${a}]`);
      try {
        if (a === 'claude') installClaude();
        else if (a === 'codex') installCodex();
        else if (a === 'cursor') installCursor();
        else if (a === 'antigravity') installAntigravity();
        else installOpenCode();
        installedAgents.push(a);
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
      }
      console.log();
    }

    // Offer permissions setup for 'all' command too
    const agentsThatNeedPermissions = installedAgents.filter(a =>
      ['claude', 'codex', 'opencode'].includes(a)
    );

    if (agentsThatNeedPermissions.length > 0) {
      console.log();
      printAgentPermissionsDescription();
      const shouldInstallPermissions = await askYesNo(
        'Would you like to configure agent permissions for Overlord protocol access?',
        true
      );

      if (shouldInstallPermissions) {
        const platformUrl = getPlatformUrl();
        installAgentPermissions(agentsThatNeedPermissions, platformUrl);
      }
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

  console.log(`Preparing Overlord agent plugin/connector for ${agent}...\n`);
  try {
    if (agent === 'claude') installClaude();
    else if (agent === 'codex') installCodex();
    else if (agent === 'cursor') installCursor();
    else if (agent === 'antigravity') installAntigravity();
    else installOpenCode();
    console.log('\nDone.');

    // Offer permissions setup for single agent install too
    if (['claude', 'codex', 'opencode'].includes(agent)) {
      console.log();
      printAgentPermissionsDescription();
      const shouldInstallPermissions = await askYesNo(
        'Would you like to configure agent permissions for Overlord protocol access?',
        true
      );

      if (shouldInstallPermissions) {
        const platformUrl = getPlatformUrl();
        installAgentPermissions([agent], platformUrl);
      }
    }
  } catch (err) {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
  }
}

export async function runDoctorCommand({ latestCliVersion = null } = {}) {
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
  const updateVersion = latestCliVersion ?? (await checkForCliUpdate());
  console.log();
  if (allOk) {
    console.log('All bundles are up to date.');
  } else {
    console.log('Run `ovld setup <agent>` or `ovld setup all` to install/repair.');
  }
  if (updateVersion) {
    console.log();
    printCliUpdateNotice(updateVersion, {
      currentVersion: getCurrentCliVersion(),
      stream: process.stdout
    });
  }
}
