import fs from 'fs';
import os from 'os';
import path from 'path';

import legacyGeminiConnector from '../../../../../lib/overlord/legacy-gemini-connector.cjs';

const { contentMatchesManagedGeminiCommand, geminiLegacyCommandFiles } = legacyGeminiConnector;
import { backupFile, writeTextFile } from './merge-helpers';

export type SlashCommandAgent = 'claude' | 'cursor' | 'gemini' | 'opencode';

export type SlashCommandStatus = 'installed' | 'partial' | 'not_installed';

export type SlashCommandStatusEntry = {
  agent: SlashCommandAgent;
  status: SlashCommandStatus;
  details: string;
  managedFiles: string[];
  existingManagedFiles: string[];
  missingManagedFiles: string[];
};

export type SlashCommandInstallResult = {
  ok: boolean;
  agent: SlashCommandAgent;
  managedFiles: string[];
  backups: string[];
  error?: string;
};

export type SlashCommandUninstallResult = {
  ok: boolean;
  agent: SlashCommandAgent;
  removedFiles: string[];
  error?: string;
};

type ManagedFile = {
  path: string;
  content: string;
};

function claudeCommandFiles(): ManagedFile[] {
  const base = path.join(os.homedir(), '.claude', 'commands');
  return [
    {
      path: path.join(base, 'connect.md'),
      content: `---
description: Connect this session to another Overlord ticket (requires: ticket-id)
argument-hint: <ticket_id>
disable-model-invocation: true
---

Connect this session to another Overlord ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol connect --ticket-id <ticket_id>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'load.md'),
      content: `---
description: Load Overlord ticket context (requires: ticket-id)
argument-hint: <ticket_id>
disable-model-invocation: true
---

Load Overlord ticket context without attaching to the ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol load-context --ticket-id <ticket_id>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
    },
    {
      path: path.join(base, 'attach.md'),
      content: `---
description: Attach this session to an Overlord ticket (requires: ticket-id)
argument-hint: <ticket_id>
disable-model-invocation: true
---

Attach this session to an Overlord ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol attach --ticket-id <ticket_id>\`

Rules:
- Use \`attach\` to establish a persistent session with a ticket.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'discuss-objective.md'),
      content: `---
description: Mark a ticket's draft objective as submitted (in discussion)
argument-hint: <ticket_id> [--objective-id <uuid>]
disable-model-invocation: true
---

Mark a draft objective as "submitted", indicating the ticket is in active discussion with an agent.

Treat \`$ARGUMENTS\` as the target ticket ID (optionally followed by \`--objective-id <uuid>\`).
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol discuss-objective --ticket-id <ticket_id>\`

Rules:
- This does NOT start execution. Use \`attach\` for that.
- After the command succeeds, confirm the objective was submitted.`
    },
    {
      path: path.join(base, 'add-objectives.md'),
      content: `---
description: Append ordered objectives to an existing Overlord ticket
argument-hint: <ticket_id> <ordered objective steps>
disable-model-invocation: true
---

Append ordered objectives to an existing ticket.

Use this when the prompts are sequential steps toward the same feature or goal. Create separate tickets when prompts represent different features or goals.

Treat the first token in \`$ARGUMENTS\` as the ticket ID and the remaining text as ordered objective steps unless raw \`--objectives-json\` or \`--objectives-file\` flags are provided.

Run:
\`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`

Rules:
- Index 0 is the first newly added objective to execute.
- Later indexes queue after it.
- After the command succeeds, report the appended objective IDs.`
    },
    {
      path: path.join(base, 'create.md'),
      content: `---
description: Create a draft Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

Create a draft Overlord ticket from the user's request.

Use \`$ARGUMENTS\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, \`--execution-target\`, \`--objectives-json\`, or \`--objectives-file\`, pass those flags through after \`ovld protocol create --agent claude-code\`.
Otherwise, treat \`$ARGUMENTS\` as the objective text and run:
\`ovld protocol create --agent claude-code --objective "<objective>"\`

Use \`--objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\` for ordered steps on one ticket. Create multiple tickets when prompts represent different features or goals.

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\`.`
    },
    {
      path: path.join(base, 'prompt.md'),
      content: `---
description: Create a new Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

Create a new Overlord ticket from the user's request.

Use \`$ARGUMENTS\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, \`--execution-target\`, \`--objectives-json\`, or \`--objectives-file\`, pass those flags through after \`ovld protocol prompt --agent claude-code\`.
Otherwise, treat \`$ARGUMENTS\` as the objective text and run:
\`ovld protocol prompt --agent claude-code --objective "<objective>"\`

Use \`--objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\` for ordered steps on one ticket. Create multiple tickets when prompts represent different features or goals.

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
    },
    {
      path: path.join(base, 'record-work.md'),
      content: `---
description: Record completed-from-chat work as a ticket in review + feed post (no attach)
argument-hint: [optional additional context]
disable-model-invocation: true
---

Immediately record the work you just completed in this chat as a new Overlord ticket via \`ovld protocol record-work\`. No agent session is opened — the work is already done.

Synthesize from the current conversation:
- \`objective\`: what was asked / what was done (1–3 sentences).
- \`summary\`: reviewer-friendly narrative of what changed and why.
- \`changeRationales\`: one entry per meaningful git-tracked file change (\`label\`, \`file_path\`, \`summary\`, \`why\`, \`impact\`, optional \`hunks\`). Use \`git status\` and \`git diff\` to enumerate changed files.
- \`artifacts\` (optional): \`next_steps\`, \`test_results\`, \`decision\`, \`note\`, \`url\`.

If \`$ARGUMENTS\` is non-empty, treat it as additional context to weave into the summary.

Run:
\`ovld protocol record-work --payload-file -\`

and stream a JSON object \`{ "objective": "...", "summary": "...", "artifacts": [...], "changeRationales": [...] }\` on stdin via a single-quoted heredoc (\`<<'EOF'\`).

After the command succeeds, report the new \`TICKET_ID\`.

Rules:
- Do NOT use this for in-progress work. Use \`/prompt\` for that.
- The CLI validates that every changed git-tracked file is represented in \`changeRationales\` unless \`--skip-file-change-check\` is passed.
- If project resolution fails, re-run with \`--project-id <id>\` or \`--personal\`.`
    }
  ];
}

function cursorCommandFiles(): ManagedFile[] {
  const base = path.join(os.homedir(), '.cursor', 'commands');
  return [
    {
      path: path.join(base, 'connect.md'),
      content: `Connect this session to another Overlord ticket (requires: ticket-id).

The text after \`/connect\` is the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol connect --ticket-id <ticket_id>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'load.md'),
      content: `Load Overlord ticket context (requires: ticket-id).

The text after \`/load\` is the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol load-context --ticket-id <ticket_id>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
    },
    {
      path: path.join(base, 'attach.md'),
      content: `Attach this session to an Overlord ticket (requires: ticket-id).

The text after \`/attach\` is the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol attach --ticket-id <ticket_id>\`

Rules:
- Use \`attach\` to establish a persistent session with a ticket.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'discuss-objective.md'),
      content: `Mark a ticket's draft objective as "submitted", indicating the ticket is in active discussion with an agent.

The text after \`/discuss-objective\` is the target ticket ID (optionally followed by \`--objective-id <uuid>\`).
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol discuss-objective --ticket-id <ticket_id>\`

Rules:
- This does NOT start execution. Use \`attach\` for that.
- After the command succeeds, confirm the objective was submitted.`
    },
    {
      path: path.join(base, 'add-objectives.md'),
      content: `Append ordered objectives to an existing Overlord ticket.

Use this when the prompts are sequential steps toward the same feature or goal. Create separate tickets when prompts represent different features or goals.

The first token after \`/add-objectives\` is the ticket ID and the remaining text is ordered objective steps unless raw \`--objectives-json\` or \`--objectives-file\` flags are present.

Run:
\`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`

Rules:
- Index 0 is the first newly added objective to execute.
- Later indexes queue after it.
- After the command succeeds, report the appended objective IDs.`
    },
    {
      path: path.join(base, 'create.md'),
      content: `Create a draft Overlord ticket from the user's request.

The text after \`/create\` is the objective unless it already includes raw flags such as \`--title\`, \`--priority\`, \`--project-id\`, \`--execution-target\`, \`--objectives-json\`, or \`--objectives-file\`.

If raw flags are present, run:
\`ovld protocol create --agent cursor <raw arguments>\`

Otherwise, run:
\`ovld protocol create --agent cursor --objective "<objective>"\`

Use \`--objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\` for ordered steps on one ticket. Create multiple tickets when prompts represent different features or goals.

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\`.`
    },
    {
      path: path.join(base, 'prompt.md'),
      content: `Create a new Overlord ticket from the user's request.

The text after \`/prompt\` is the objective unless it already includes raw flags such as \`--title\`, \`--priority\`, \`--project-id\`, \`--execution-target\`, \`--objectives-json\`, or \`--objectives-file\`.

If raw flags are present, run:
\`ovld protocol prompt --agent cursor <raw arguments>\`

Otherwise, run:
\`ovld protocol prompt --agent cursor --objective "<objective>"\`

Use \`--objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\` for ordered steps on one ticket. Create multiple tickets when prompts represent different features or goals.

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
    },
    {
      path: path.join(base, 'record-work.md'),
      content: `Record completed-from-chat work as a ticket in review + feed post (no attach).

Immediately record the work you just completed in this chat as a new Overlord ticket via \`ovld protocol record-work\`. No agent session is opened — the work is already done.

Synthesize from the current conversation:
- \`objective\`: what was asked / what was done.
- \`summary\`: reviewer-friendly narrative for the feed.
- \`changeRationales\`: one entry per meaningful git-tracked file change (\`label\`, \`file_path\`, \`summary\`, \`why\`, \`impact\`, optional \`hunks\`). Use \`git status\` and \`git diff\` to enumerate changed files.
- \`artifacts\` (optional): \`next_steps\`, \`test_results\`, \`decision\`, \`note\`, \`url\`.

If text was provided after \`/record-work\`, treat it as additional context for the summary.

Run \`ovld protocol record-work --payload-file -\` and stream the JSON payload \`{ "objective": "...", "summary": "...", "artifacts": [...], "changeRationales": [...] }\` on stdin via a single-quoted heredoc.

After the command succeeds, report the new TICKET_ID.

Rules:
- Do NOT use this for in-progress work. Use \`/prompt\` for that.
- The CLI validates that every changed git-tracked file is represented in \`changeRationales\` unless \`--skip-file-change-check\` is passed.
- If project resolution fails, re-run with \`--project-id <id>\` or \`--personal\`.`
    }
  ];
}

function geminiCommandFiles(): ManagedFile[] {
  return geminiLegacyCommandFiles();
}

function openCodeCommandFiles(): ManagedFile[] {
  const base = path.join(os.homedir(), '.config', 'opencode', 'commands');
  return [
    {
      path: path.join(base, 'connect.md'),
      content: `---
description: Connect this session to another Overlord ticket (requires: ticket-id)
agent: build
---

Connect this session to another Overlord ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol connect --ticket-id <ticket_id>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'load.md'),
      content: `---
description: Load Overlord ticket context (requires: ticket-id)
agent: build
---

Load Overlord ticket context without attaching to the ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol load-context --ticket-id <ticket_id>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
    },
    {
      path: path.join(base, 'attach.md'),
      content: `---
description: Attach this session to an Overlord ticket (requires: ticket-id)
agent: build
---

Attach this session to an Overlord ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol attach --ticket-id <ticket_id>\`

Rules:
- Use \`attach\` to establish a persistent session with a ticket.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'add-objectives.md'),
      content: `---
description: Append ordered objectives to an existing Overlord ticket
agent: build
---

Append ordered objectives to an existing ticket.

Use this when prompts are sequential steps toward the same feature or goal. Create separate tickets when prompts represent different features or goals.

Run:
\`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`

Index 0 is the first newly added objective to execute; later indexes queue after it.`
    },
    {
      path: path.join(base, 'discuss-objective.md'),
      content: `---
description: Mark a ticket's draft objective as submitted (in discussion)
agent: build
---

Mark a draft objective as "submitted", indicating the ticket is in active discussion with an agent.

Treat \`$ARGUMENTS\` as the target ticket ID (optionally followed by \`--objective-id <uuid>\`).
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol discuss-objective --ticket-id <ticket_id>\`

Rules:
- This does NOT start execution. Use \`attach\` for that.
- After the command succeeds, confirm the objective was submitted.`
    },
    {
      path: path.join(base, 'create.md'),
      content: `---
description: Create a draft Overlord ticket from the current conversation
agent: build
---

Create a draft Overlord ticket from the user's request.

Use \`$ARGUMENTS\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`, pass those flags through after \`ovld protocol create --agent opencode\`.
Otherwise, treat \`$ARGUMENTS\` as the objective text and run:
\`ovld protocol create --agent opencode --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\`.`
    },
    {
      path: path.join(base, 'prompt.md'),
      content: `---
description: Create a new Overlord ticket from the current conversation
agent: build
---

Create a new Overlord ticket from the user's request.

Use \`$ARGUMENTS\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`, pass those flags through after \`ovld protocol prompt --agent opencode\`.
Otherwise, treat \`$ARGUMENTS\` as the objective text and run:
\`ovld protocol prompt --agent opencode --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
    },
    {
      path: path.join(base, 'record-work.md'),
      content: `---
description: Record completed-from-chat work as a ticket in review + feed post (no attach)
agent: build
---

Immediately record the work you just completed in this chat as a new Overlord ticket via \`ovld protocol record-work\`. No agent session is opened — the work is already done.

Synthesize from the current conversation:
- \`objective\`: what was asked / what was done.
- \`summary\`: reviewer-friendly narrative for the feed.
- \`changeRationales\`: one entry per meaningful git-tracked file change (\`label\`, \`file_path\`, \`summary\`, \`why\`, \`impact\`, optional \`hunks\`). Use \`git status\` and \`git diff\` to enumerate changed files.
- \`artifacts\` (optional): \`next_steps\`, \`test_results\`, \`decision\`, \`note\`, \`url\`.

If \`$ARGUMENTS\` is non-empty, treat it as additional context to weave into the summary.

Run \`ovld protocol record-work --payload-file -\` and stream the JSON payload \`{ "objective": "...", "summary": "...", "artifacts": [...], "changeRationales": [...] }\` on stdin via a single-quoted heredoc.

After the command succeeds, report the new \`TICKET_ID\`.

Rules:
- Do NOT use this for in-progress work. Use \`/prompt\` for that.
- The CLI validates that every changed git-tracked file is represented in \`changeRationales\` unless \`--skip-file-change-check\` is passed.
- If project resolution fails, re-run with \`--project-id <id>\` or \`--personal\`.`
    }
  ];
}

function slashCommandFiles(agent: SlashCommandAgent): ManagedFile[] {
  if (agent === 'claude') return claudeCommandFiles();
  if (agent === 'cursor') return cursorCommandFiles();
  if (agent === 'gemini') return geminiCommandFiles();
  return openCodeCommandFiles();
}

function removeEmptyParents(filePath: string, stopAt: string): void {
  let currentDir = path.dirname(filePath);
  while (currentDir.startsWith(stopAt) && currentDir !== stopAt) {
    if (!fs.existsSync(currentDir)) break;
    if (fs.readdirSync(currentDir).length > 0) break;
    fs.rmdirSync(currentDir);
    currentDir = path.dirname(currentDir);
  }
}

function getCommandsRoot(agent: SlashCommandAgent): string {
  const files = slashCommandFiles(agent);
  return path.dirname(files[0]?.path ?? os.homedir());
}

export function getSlashCommandStatus(agent: SlashCommandAgent): SlashCommandStatusEntry {
  const managedFiles = slashCommandFiles(agent).map(file => file.path);
  const existingManagedFiles = managedFiles.filter(file => fs.existsSync(file));
  const missingManagedFiles = managedFiles.filter(file => !fs.existsSync(file));

  if (existingManagedFiles.length === 0) {
    return {
      agent,
      status: 'not_installed',
      details: 'Slash commands are not installed.',
      managedFiles,
      existingManagedFiles,
      missingManagedFiles
    };
  }

  if (missingManagedFiles.length > 0) {
    return {
      agent,
      status: 'partial',
      details: `Found ${existingManagedFiles.length}/${managedFiles.length} slash command files.`,
      managedFiles,
      existingManagedFiles,
      missingManagedFiles
    };
  }

  return {
    agent,
    status: 'installed',
    details: 'Slash commands are installed.',
    managedFiles,
    existingManagedFiles,
    missingManagedFiles
  };
}

export function getAllSlashCommandStatuses(): SlashCommandStatusEntry[] {
  return [
    getSlashCommandStatus('claude'),
    getSlashCommandStatus('cursor'),
    getSlashCommandStatus('opencode')
  ];
}

export function installSlashCommands(agent: SlashCommandAgent): SlashCommandInstallResult {
  const files = slashCommandFiles(agent);
  const backups: string[] = [];

  try {
    for (const file of files) {
      const backup = backupFile(file.path);
      if (backup) backups.push(backup);
      writeTextFile(file.path, `${file.content.trim()}\n`);
    }

    return {
      ok: true,
      agent,
      managedFiles: files.map(file => file.path),
      backups
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      agent,
      managedFiles: files.map(file => file.path),
      backups,
      error: message
    };
  }
}

export function uninstallSlashCommands(agent: SlashCommandAgent): SlashCommandUninstallResult {
  const files = slashCommandFiles(agent);
  const removedFiles: string[] = [];
  const commandsRoot = getCommandsRoot(agent);

  try {
    for (const file of files) {
      if (!fs.existsSync(file.path)) continue;
      if (agent === 'gemini') {
        const existing = fs.readFileSync(file.path, 'utf8');
        if (!contentMatchesManagedGeminiCommand(existing, file.content)) {
          continue;
        }
      }
      fs.unlinkSync(file.path);
      removedFiles.push(file.path);
      removeEmptyParents(file.path, commandsRoot);
    }

    return {
      ok: true,
      agent,
      removedFiles
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      agent,
      removedFiles,
      error: message
    };
  }
}

// version: 2.1.0
