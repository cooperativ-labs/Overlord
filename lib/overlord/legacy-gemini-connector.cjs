const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GEMINI_LEGACY_COMMANDS_DIR = path.join(os.homedir(), '.gemini', 'commands');

function normalizeManagedSlashContent(content) {
  return content.trim();
}

function contentMatchesManagedGeminiCommand(existing, expected) {
  return normalizeManagedSlashContent(existing) === normalizeManagedSlashContent(expected);
}

function geminiLegacyCommandFiles() {
  const base = GEMINI_LEGACY_COMMANDS_DIR;
  return [
    {
      path: path.join(base, 'connect.toml'),
      content: `description = "Connect this session to another Overlord ticket (requires: ticket-id)."
prompt = """
Connect this session to another Overlord ticket.

Treat \`{{args}}\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol connect --ticket-id <ticket_id>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.
"""`
    },
    {
      path: path.join(base, 'load.toml'),
      content: `description = "Load Overlord ticket context (requires: ticket-id)."
prompt = """
Load Overlord ticket context without attaching to the ticket.

Treat \`{{args}}\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol load-context --ticket-id <ticket_id>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.
"""`
    },
    {
      path: path.join(base, 'attach.toml'),
      content: `description = "Attach this session to an Overlord ticket (requires: ticket-id)."
prompt = """
Attach this session to an Overlord ticket.

Treat \`{{args}}\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol attach --ticket-id <ticket_id>\`

Rules:
- Use \`attach\` to establish a persistent session with a ticket.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.
"""`
    },
    {
      path: path.join(base, 'discuss-objective.toml'),
      content: `description = "Mark a ticket's draft objective as submitted (in discussion)."
prompt = """
Mark a draft objective as "submitted", indicating the ticket is in active discussion with an agent.

Treat \`{{args}}\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`ovld protocol discuss-objective --ticket-id <ticket_id>\`

Rules:
- This does NOT start execution. Use \`attach\` for that.
- After the command succeeds, confirm the objective was submitted.
"""`
    },
    {
      path: path.join(base, 'add-objectives.toml'),
      content: `description = "Append ordered objectives to an existing Overlord ticket."
prompt = """
Append ordered objectives to an existing ticket.

Use this when prompts are sequential steps toward the same feature or goal. Create separate tickets when prompts represent different features or goals.

Run:
\`ovld protocol add-objectives --ticket-id <ticket_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'\`

Index 0 is the first newly added objective to execute; later indexes queue after it.
"""`
    },
    {
      path: path.join(base, 'create.toml'),
      content: `description = "Create a draft Overlord ticket from the current conversation."
prompt = """
Create a draft Overlord ticket from the user's request.

Use \`{{args}}\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--for-human\`, pass those flags through after \`ovld protocol create --agent gemini\`.
Otherwise, treat \`{{args}}\` as the objective text and run:
\`ovld protocol create --agent gemini --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\`.
"""`
    },
    {
      path: path.join(base, 'prompt.toml'),
      content: `description = "Create a new Overlord ticket from the current conversation."
prompt = """
Create a new Overlord ticket from the user's request.

Use \`{{args}}\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--for-human\`, pass those flags through after \`ovld protocol prompt --agent gemini\`.
Otherwise, treat \`{{args}}\` as the objective text and run:
\`ovld protocol prompt --agent gemini --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.
"""`
    },
    {
      path: path.join(base, 'record-work.toml'),
      content: `description = "Record completed-from-chat work as a ticket in review + feed post (no attach)."
prompt = """
Immediately record the work you just completed in this chat as a new Overlord ticket via \`ovld protocol record-work\`. No agent session is opened — the work is already done.

Synthesize from the current conversation:
- \`objective\`: what was asked / what was done.
- \`summary\`: reviewer-friendly narrative for the feed.
- \`changeRationales\`: one entry per meaningful git-tracked file change (\`label\`, \`file_path\`, \`summary\`, \`why\`, \`impact\`, optional \`hunks\`). Use \`git status\` and \`git diff\` to enumerate changed files.
- \`artifacts\` (optional): \`next_steps\`, \`test_results\`, \`decision\`, \`note\`, \`url\`.

If \`{{args}}\` is non-empty, treat it as additional context to weave into the summary.

Run \`ovld protocol record-work --payload-file -\` and stream a JSON object \`{ "objective": "...", "summary": "...", "artifacts": [...], "changeRationales": [...] }\` on stdin via a single-quoted heredoc.

After the command succeeds, report the new \`TICKET_ID\`.

Rules:
- Do NOT use this for in-progress work. Use \`/prompt\` for that.
- The CLI validates that every changed git-tracked file is represented in \`changeRationales\` unless \`--skip-file-change-check\` is passed.
- If project resolution fails, re-run with \`--project-id <id>\` or \`--personal\`.
"""`
    }
  ];
}

function isRemovableLegacyGeminiCommandFile({ filePath, content, manifestFiles }) {
  if (manifestFiles.has(filePath)) {
    return true;
  }

  const managed = geminiLegacyCommandFiles().find(file => file.path === filePath);
  if (!managed) {
    return false;
  }

  return contentMatchesManagedGeminiCommand(content, managed.content);
}

function removeLegacyGeminiConnector({
  readManifest,
  writeManifest,
  readTextFile,
  existsSync = fs.existsSync.bind(fs),
  rmSync = fs.rmSync.bind(fs)
}) {
  const removed = [];
  const manifest = readManifest();
  const manifestFiles = new Set(manifest.gemini?.files ?? []);

  for (const file of geminiLegacyCommandFiles()) {
    if (!existsSync(file.path)) continue;
    const existing = readTextFile(file.path);
    if (
      !isRemovableLegacyGeminiCommandFile({
        filePath: file.path,
        content: existing,
        manifestFiles
      })
    ) {
      continue;
    }
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

module.exports = {
  GEMINI_LEGACY_COMMANDS_DIR,
  normalizeManagedSlashContent,
  contentMatchesManagedGeminiCommand,
  geminiLegacyCommandFiles,
  isRemovableLegacyGeminiCommandFile,
  removeLegacyGeminiConnector
};
