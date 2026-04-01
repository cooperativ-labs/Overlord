import fs from 'fs';
import os from 'os';
import path from 'path';

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
description: Connect this session to another Overlord ticket by ticket ID
argument-hint: <ticket-id>
disable-model-invocation: true
---

Connect this session to another Overlord ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol connect --ticket-id <ticketId>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'load.md'),
      content: `---
description: Load Overlord ticket context without creating a new session
argument-hint: <ticket-id>
disable-model-invocation: true
---

Load Overlord ticket context without attaching to the ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol load-context --ticket-id <ticketId>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
    },
    {
      path: path.join(base, 'spawn.md'),
      content: `---
description: Create a new Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

Create a new Overlord ticket from the user's request.

Use \`$ARGUMENTS\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`, pass those flags through after \`ovld protocol spawn\`.
Otherwise, treat \`$ARGUMENTS\` as the objective text and run:
\`ovld protocol spawn --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
    }
  ];
}

function cursorCommandFiles(): ManagedFile[] {
  const base = path.join(os.homedir(), '.cursor', 'commands');
  return [
    {
      path: path.join(base, 'connect.md'),
      content: `Connect this session to another Overlord ticket.

The text after \`/connect\` is the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol connect --ticket-id <ticketId>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'load.md'),
      content: `Load Overlord ticket context without creating a new session.

The text after \`/load\` is the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol load-context --ticket-id <ticketId>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
    },
    {
      path: path.join(base, 'spawn.md'),
      content: `Create a new Overlord ticket from the user's request.

The text after \`/spawn\` is the objective unless it already includes raw flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`.

If raw flags are present, run:
\`ovld protocol spawn <raw arguments>\`

Otherwise, run:
\`ovld protocol spawn --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
    }
  ];
}

function geminiCommandFiles(): ManagedFile[] {
  const base = path.join(os.homedir(), '.gemini', 'commands');
  return [
    {
      path: path.join(base, 'connect.toml'),
      content:
        `description = "Connect this session to another Overlord ticket by ticket ID."
prompt = """
Connect this session to another Overlord ticket.

Treat ` +
        '`{{args}}`' +
        ` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
` +
        '`ovld protocol connect --ticket-id <ticketId>`' +
        `

Rules:
- Use ` +
        '`connect`' +
        `, not ` +
        '`attach`' +
        `.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned ` +
        '`SESSION_KEY`' +
        ` and confirm that future updates should use that ticket.
"""`
    },
    {
      path: path.join(base, 'load.toml'),
      content:
        `description = "Load Overlord ticket context without creating a new session."
prompt = """
Load Overlord ticket context without attaching to the ticket.

Treat ` +
        '`{{args}}`' +
        ` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
` +
        '`ovld protocol load-context --ticket-id <ticketId>`' +
        `

Rules:
- Use ` +
        '`load-context`' +
        `, not ` +
        '`attach`' +
        `.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.
"""`
    },
    {
      path: path.join(base, 'spawn.toml'),
      content:
        `description = "Create a new Overlord ticket from the current conversation."
prompt = """
Create a new Overlord ticket from the user's request.

Use ` +
        '`{{args}}`' +
        ` as the input.
If it already contains flags such as ` +
        '`--title`' +
        `, ` +
        '`--priority`' +
        `, ` +
        '`--project-id`' +
        `, or ` +
        '`--execution-target`' +
        `, pass those flags through after ` +
        '`ovld protocol spawn`' +
        `.
Otherwise, treat ` +
        '`{{args}}`' +
        ` as the objective text and run:
` +
        '`ovld protocol spawn --objective "<objective>"`' +
        `

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new ` +
        '`TICKET_ID`' +
        ` and ` +
        '`SESSION_KEY`' +
        `.
"""`
    }
  ];
}

function openCodeCommandFiles(): ManagedFile[] {
  const base = path.join(os.homedir(), '.config', 'opencode', 'commands');
  return [
    {
      path: path.join(base, 'connect.md'),
      content: `---
description: Connect this session to another Overlord ticket by ticket ID
agent: build
---

Connect this session to another Overlord ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol connect --ticket-id <ticketId>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
    },
    {
      path: path.join(base, 'load.md'),
      content: `---
description: Load Overlord ticket context without creating a new session
agent: build
---

Load Overlord ticket context without attaching to the ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol load-context --ticket-id <ticketId>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
    },
    {
      path: path.join(base, 'spawn.md'),
      content: `---
description: Create a new Overlord ticket from the current conversation
agent: build
---

Create a new Overlord ticket from the user's request.

Use \`$ARGUMENTS\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`, pass those flags through after \`ovld protocol spawn\`.
Otherwise, treat \`$ARGUMENTS\` as the objective text and run:
\`ovld protocol spawn --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
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
    getSlashCommandStatus('gemini'),
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
