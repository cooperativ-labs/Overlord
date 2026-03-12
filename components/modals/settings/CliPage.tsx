'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

type SlashCommandConfig = {
  label: string;
  description: string;
  supportNote?: string;
  filePaths: string[];
  fileContent: string;
  installCmd: string;
};

type SlashCommandFile = {
  path: string;
  content: string;
};

function parentDir(path: string): string | null {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : null;
}

function buildInstallCommand(files: SlashCommandFile[]): string {
  const directories = Array.from(
    new Set(
      files.map(file => parentDir(file.path)).filter((value): value is string => Boolean(value))
    )
  );

  return [
    ...directories.map(directory => `mkdir -p ${directory}`),
    ...files.map(file => `cat > ${file.path} << 'EOF'\n${file.content}\nEOF`)
  ].join('\n\n');
}

const CLAUDE_FILES: SlashCommandFile[] = [
  {
    path: '.claude/commands/connect.md',
    content: `---
description: Connect this session to another Overlord ticket by ticket ID
argument-hint: <ticket-id>
disable-model-invocation: true
---

Connect this session to another Overlord ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`npx overlord protocol connect --ticket-id <ticketId>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
  },
  {
    path: '.claude/commands/load.md',
    content: `---
description: Load Overlord ticket context without creating a new session
argument-hint: <ticket-id>
disable-model-invocation: true
---

Load Overlord ticket context without attaching to the ticket.

Treat \`$ARGUMENTS\` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`npx overlord protocol load-context --ticket-id <ticketId>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
  },
  {
    path: '.claude/commands/spawn.md',
    content: `---
description: Create a new Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

Create a new Overlord ticket from the user's request.

Use \`$ARGUMENTS\` as the input.
If it already contains flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`, pass those flags through after \`npx overlord protocol spawn\`.
Otherwise, treat \`$ARGUMENTS\` as the objective text and run:
\`npx overlord protocol spawn --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
  }
];

const CURSOR_FILES: SlashCommandFile[] = [
  {
    path: '.cursor/commands/connect.md',
    content: `Connect this session to another Overlord ticket.

The text after \`/connect\` is the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`npx overlord protocol connect --ticket-id <ticketId>\`

Rules:
- Use \`connect\`, not \`attach\`.
- Do not load extra ticket context unless the user explicitly asks for it.
- After the command succeeds, report the returned \`SESSION_KEY\` and confirm that future updates should use that ticket.`
  },
  {
    path: '.cursor/commands/load.md',
    content: `Load Overlord ticket context without creating a new session.

The text after \`/load\` is the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
\`npx overlord protocol load-context --ticket-id <ticketId>\`

Rules:
- Use \`load-context\`, not \`attach\`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.`
  },
  {
    path: '.cursor/commands/spawn.md',
    content: `Create a new Overlord ticket from the user's request.

The text after \`/spawn\` is the objective unless it already includes raw flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`.

If raw flags are present, run:
\`npx overlord protocol spawn <raw arguments>\`

Otherwise, run:
\`npx overlord protocol spawn --objective "<objective>"\`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new \`TICKET_ID\` and \`SESSION_KEY\`.`
  }
];

const GEMINI_FILES: SlashCommandFile[] = [
  {
    path: '.gemini/commands/connect.toml',
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
      '`npx overlord protocol connect --ticket-id <ticketId>`' +
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
    path: '.gemini/commands/load.toml',
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
      '`npx overlord protocol load-context --ticket-id <ticketId>`' +
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
    path: '.gemini/commands/spawn.toml',
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
      '`npx overlord protocol spawn`' +
      `.
Otherwise, treat ` +
      '`{{args}}`' +
      ` as the objective text and run:
` +
      '`npx overlord protocol spawn --objective "<objective>"`' +
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

const CODEX_APPENDIX = `## Overlord mid-session ticket commands

When the user types a slash-style command for Overlord work, interpret it as follows:

- \`/connect <ticket-id>\`:
  Run \`npx overlord protocol connect --ticket-id <ticket-id>\`.
  Use this instead of \`attach\` when the user wants to start updating another ticket without loading its full context.
  After success, report the returned \`SESSION_KEY\`.

- \`/load <ticket-id>\`:
  Run \`npx overlord protocol load-context --ticket-id <ticket-id>\`.
  Do not create a session.
  Summarize the returned ticket details, history, artifacts, and shared context.

- \`/spawn <objective>\`:
  If the text after \`/spawn\` already contains raw flags such as \`--title\`, \`--priority\`, \`--project-id\`, or \`--execution-target\`, run \`npx overlord protocol spawn <raw arguments>\`.
  Otherwise run \`npx overlord protocol spawn --objective "<objective>"\`.
  After success, report the new \`TICKET_ID\` and \`SESSION_KEY\`.

If a required argument is missing, ask the user for it before running any command.`;

const SLASH_COMMAND_CONFIGS: Record<string, SlashCommandConfig> = {
  claude: {
    label: 'Claude Code',
    description:
      'Installs native project slash commands for mid-session Overlord ticket operations.',
    supportNote: 'Creates `/connect`, `/load`, and `/spawn` in `.claude/commands/`.',
    filePaths: CLAUDE_FILES.map(file => file.path),
    fileContent: CLAUDE_FILES.map(file => `# ${file.path}\n\n${file.content}`).join('\n\n'),
    installCmd: buildInstallCommand(CLAUDE_FILES)
  },
  codex: {
    label: 'Codex CLI',
    description:
      'Adds slash-style Overlord command instructions to AGENTS.md so Codex can interpret `/connect`, `/load`, and `/spawn` during a session.',
    supportNote:
      'Uses AGENTS.md guidance instead of native project command files, so Codex understands the slash forms even when Overlord was not the original launcher.',
    filePaths: ['AGENTS.md'],
    fileContent: CODEX_APPENDIX,
    installCmd: `cat >> AGENTS.md << 'EOF'\n\n${CODEX_APPENDIX}\nEOF`
  },
  cursor: {
    label: 'Cursor',
    description:
      'Installs native project slash commands for mid-session Overlord ticket operations.',
    supportNote: 'Creates `/connect`, `/load`, and `/spawn` in `.cursor/commands/`.',
    filePaths: CURSOR_FILES.map(file => file.path),
    fileContent: CURSOR_FILES.map(file => `# ${file.path}\n\n${file.content}`).join('\n\n'),
    installCmd: buildInstallCommand(CURSOR_FILES)
  },
  gemini: {
    label: 'Gemini CLI',
    description:
      'Installs native project slash commands for mid-session Overlord ticket operations.',
    supportNote:
      'Creates `/connect`, `/load`, and `/spawn` in `.gemini/commands/`. Run `/commands reload` in Gemini CLI after installing.',
    filePaths: GEMINI_FILES.map(file => file.path),
    fileContent: GEMINI_FILES.map(file => `# ${file.path}\n\n${file.content}`).join('\n\n'),
    installCmd: buildInstallCommand(GEMINI_FILES)
  }
};

export function CliPage({ open }: { open: boolean }) {
  const { isElectron, api } = useElectron();

  const [selectedSlashAgent, setSelectedSlashAgent] = useState('claude');
  const [slashCommandCopied, setSlashCommandCopied] = useState(false);

  const [cliInstallButtonState, setCliInstallButtonState] = useState<ButtonLoadingState>('default');
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliInstallMessage, setCliInstallMessage] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliIsStale, setCliIsStale] = useState(false);

  useEffect(() => {
    if (!open || !isElectron || !api?.cli) return;
    void api.cli.getInstallStatus().then(({ installed, installPath, isStale, version }) => {
      setCliInstalled(installed);
      setCliInstallPath(installPath ?? null);
      setCliIsStale(isStale ?? false);
      setCliVersion(version);
    });
  }, [api, isElectron, open]);

  async function handleCopySlashInstall() {
    const config = SLASH_COMMAND_CONFIGS[selectedSlashAgent];
    if (!config) return;
    await navigator.clipboard.writeText(config.installCmd);
    setSlashCommandCopied(true);
    setTimeout(() => setSlashCommandCopied(false), 2000);
  }

  async function handleInstallCli() {
    if (!api?.cli) return;
    setCliInstallButtonState('loading');
    setCliInstallMessage(null);
    try {
      const result = await api.cli.install();
      if (result.ok) {
        setCliInstallButtonState('success');
        setCliInstalled(true);
        setCliInstallPath(result.installPath);
        setCliInstallMessage(result.pathInstruction);
        setCliIsStale(false);
      } else {
        setCliInstallButtonState('error');
        setCliInstallMessage(result.error);
      }
    } catch (error) {
      setCliInstallButtonState('error');
      setCliInstallMessage(error instanceof Error ? error.message : 'Install failed');
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Overlord CLI (ovld)</p>
        <p className="text-xs text-muted-foreground">
          The CLI lets agents in Claude Code, Codex, Cursor, and Gemini work with Overlord tickets.
          Available commands:
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <p className="mb-2 font-sans font-medium text-foreground">Top-level</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld attach [ticketId] [agent]</code>{' '}
            interactive ticket picker + agent launcher
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld auth</code> login, status, logout
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld tickets</code> create, list
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld ticket</code> context
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld run &lt;agent&gt;</code> launch
            agent (requires TICKET_ID)
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld resume &lt;agent&gt;</code>{' '}
            resume an agent session
          </li>
        </ul>
        <p className="mt-3 mb-2 font-sans font-medium text-foreground">Examples</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld attach</code> — interactive: search
            tickets, pick agent
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld attach &lt;ticketId&gt;</code> —
            skip search, pick agent
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld attach &lt;ticketId&gt; claude
            </code>{' '}
            — fully non-interactive
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld tickets create --objective &quot;...&quot; --execution-target agent
            </code>
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Run <code className="rounded bg-muted px-1 break-all">ovld &lt;command&gt; --help</code>{' '}
          for more detail.
        </p>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Agent ticket commands</p>
        <p className="text-xs text-muted-foreground">
          Install mid-session ticket commands so your agent can handle{' '}
          <code className="rounded bg-muted px-1">/connect</code>,{' '}
          <code className="rounded bg-muted px-1">/load</code>, and{' '}
          <code className="rounded bg-muted px-1">/spawn</code> without relying on Overlord launch
          context alone. Select your agent for setup instructions.
        </p>
        <Select value={selectedSlashAgent} onValueChange={setSelectedSlashAgent}>
          <SelectTrigger>
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SLASH_COMMAND_CONFIGS).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(() => {
          const cfg = SLASH_COMMAND_CONFIGS[selectedSlashAgent];
          if (!cfg) return null;
          return (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-sans text-muted-foreground">{cfg.description}</p>
              {cfg.supportNote ? (
                <p className="mb-2 font-sans text-muted-foreground">{cfg.supportNote}</p>
              ) : null}
              <p className="mb-2 break-all font-sans text-muted-foreground">
                Files: <code className="rounded bg-muted px-1">{cfg.filePaths.join(', ')}</code>
              </p>
              <pre className="mb-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-foreground">
                {cfg.fileContent}
              </pre>
              <div className="flex items-center gap-2">
                <p className="shrink-0 font-sans text-muted-foreground">Install command:</p>
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-1">
                  {cfg.installCmd}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopySlashInstall()}
                  className="shrink-0 rounded p-1 hover:bg-muted"
                  title="Copy install command"
                >
                  {slashCommandCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {isElectron && api?.cli ? (
        <>
          {cliInstalled && !cliIsStale ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                ovld {cliVersion ? `v${cliVersion}` : ''} installed at {cliInstallPath}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Automatically updated when the desktop app updates.
              </p>
              {cliInstallMessage ? (
                <p className="mt-1 text-xs text-muted-foreground">{cliInstallMessage}</p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-2">
              {cliIsStale ? (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-50/50 p-3 dark:bg-yellow-900/10">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    CLI wrapper is outdated
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The installed wrapper points to an old app location. Reinstall to link it to the
                    current version{cliVersion ? ` (v${cliVersion})` : ''}.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <LoadingButton
                  buttonState={cliInstallButtonState}
                  setButtonState={setCliInstallButtonState}
                  text={cliIsStale ? 'Reinstall CLI' : 'Install CLI'}
                  loadingText={cliIsStale ? 'Reinstalling...' : 'Installing...'}
                  successText={cliIsStale ? 'Reinstalled' : 'Installed'}
                  errorText="Retry"
                  reset
                  variant="default"
                  onClick={handleInstallCli}
                />
                {cliInstallMessage ? (
                  <p className="text-sm text-destructive">{cliInstallMessage}</p>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            Install the{' '}
            <Link href="/downloads" className="text-foreground underline underline-offset-4">
              desktop app
            </Link>{' '}
            to install the CLI with one click. Or run{' '}
            <code className="rounded bg-muted px-1">npx overlord</code> from the project directory.
          </p>
        </div>
      )}
    </div>
  );
}
