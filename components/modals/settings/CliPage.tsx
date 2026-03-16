'use client';

import { Check, Copy, Download, RefreshCw, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Badge } from '@/components/ui/badge';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { getAllAgentConfigsAction, updateAgentFlagsAction } from '@/lib/actions/agent-config';
import {
  DEFAULT_AGENT_TRIGGER_STORAGE_KEY,
  readDefaultAgentTriggerFromStorage
} from '@/lib/helpers/agent-trigger';
import {
  AGENT_SELECTOR_VALUES,
  type AgentSelectorValue,
  getAgentTypeByValue
} from '@/lib/helpers/agent-types';

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

type BundleAgent = 'claude' | 'codex';

type BundleStatusEntry = {
  agent: BundleAgent;
  status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
  version: string | null;
  installedVersion: string | null;
  details: string;
};

type AgentPluginInstallOption =
  | {
      key: string;
      agentKey: string;
      label: string;
      description: string;
      kind: 'bundle';
      bundleAgent: BundleAgent;
      supportNote?: string;
    }
  | {
      key: string;
      agentKey: string;
      label: string;
      description: string;
      kind: 'slash';
      slashAgent: string;
      supportNote?: string;
    };

const AGENTS = ['claude', 'cursor', 'codex'] as const;

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex'
};

function getAgentSelectorLabel(agentValue: AgentSelectorValue): string {
  if (agentValue === 'copy-local') return 'Copy Local';
  if (agentValue === 'copy-cloud') return 'Copy Cloud';
  return getAgentTypeByValue(agentValue).label;
}

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

const AGENT_PLUGIN_OPTIONS: AgentPluginInstallOption[] = [
  {
    key: 'claude:bundle',
    agentKey: 'claude',
    label: 'Prompt / skills',
    description:
      'Installs the durable Overlord workflow bundle, including the Claude skill and permission hook integration.',
    kind: 'bundle',
    bundleAgent: 'claude',
    supportNote: 'Managed by the desktop app in your local ~/.claude configuration.'
  },
  {
    key: 'claude:slash',
    agentKey: 'claude',
    label: '/connect /load /spawn',
    description: SLASH_COMMAND_CONFIGS.claude.description,
    kind: 'slash',
    slashAgent: 'claude',
    supportNote: SLASH_COMMAND_CONFIGS.claude.supportNote
  },
  {
    key: 'codex:bundle',
    agentKey: 'codex',
    label: 'Prompt / skills',
    description:
      'Installs durable Overlord workflow instructions into Codex so ticket lifecycle rules live in local config instead of repeated prompts.',
    kind: 'bundle',
    bundleAgent: 'codex',
    supportNote: 'Managed by the desktop app in your local ~/.codex configuration.'
  },
  {
    key: 'codex:slash',
    agentKey: 'codex',
    label: '/connect /load /spawn',
    description: SLASH_COMMAND_CONFIGS.codex.description,
    kind: 'slash',
    slashAgent: 'codex',
    supportNote: SLASH_COMMAND_CONFIGS.codex.supportNote
  },
  {
    key: 'cursor:slash',
    agentKey: 'cursor',
    label: '/connect /load /spawn',
    description: SLASH_COMMAND_CONFIGS.cursor.description,
    kind: 'slash',
    slashAgent: 'cursor',
    supportNote: SLASH_COMMAND_CONFIGS.cursor.supportNote
  },
  {
    key: 'gemini:slash',
    agentKey: 'gemini',
    label: '/connect /load /spawn',
    description: SLASH_COMMAND_CONFIGS.gemini.description,
    kind: 'slash',
    slashAgent: 'gemini',
    supportNote: SLASH_COMMAND_CONFIGS.gemini.supportNote
  }
];

const AGENT_PLUGIN_GROUPS = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex CLI' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'gemini', label: 'Gemini CLI' }
] as const;

export function CliPage({ open }: { open: boolean }) {
  const { isElectron, api } = useElectron();

  const [selectedDefaultAgentTrigger, setSelectedDefaultAgentTrigger] =
    useState<AgentSelectorValue>('claude');
  const [selectedLocalAgent, setSelectedLocalAgent] = useState<string>('claude');
  const [agentFlags, setAgentFlags] = useState<Record<string, string[]>>({});
  const [flagInput, setFlagInput] = useState('');
  const [commandCopied, setCommandCopied] = useState(false);

  const [selectedAgentPluginKey, setSelectedAgentPluginKey] = useState('claude:bundle');
  const [slashCommandCopied, setSlashCommandCopied] = useState(false);

  const [cliInstallButtonState, setCliInstallButtonState] = useState<ButtonLoadingState>('default');
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliInstallMessage, setCliInstallMessage] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliIsStale, setCliIsStale] = useState(false);
  const [bundleStatuses, setBundleStatuses] = useState<BundleStatusEntry[]>([]);
  const [bundleActionLoading, setBundleActionLoading] = useState<string | null>(null);

  const loadBundleStatuses = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.agentBundle) return;
    try {
      const statuses = await window.electronAPI.agentBundle.getAllStatuses();
      setBundleStatuses(statuses);
    } catch {
      // Agent bundle API not available
    }
  }, [isElectron]);

  useEffect(() => {
    if (!open) return;
    setSelectedDefaultAgentTrigger(readDefaultAgentTriggerFromStorage());
  }, [open]);

  useEffect(() => {
    if (!open || !isElectron) return;
    void (async () => {
      try {
        const configs = await getAllAgentConfigsAction();
        const flags: Record<string, string[]> = {};
        Object.entries(configs).forEach(([agentType, config]) => {
          flags[agentType] = config.flags ?? [];
        });
        setAgentFlags(flags);
      } catch (error) {
        console.error('Failed to load agent configs:', error);
      }
    })();
  }, [isElectron, open]);

  useEffect(() => {
    if (!open || !isElectron || !api?.cli) return;
    void api.cli.getInstallStatus().then(({ installed, installPath, isStale, version }) => {
      setCliInstalled(installed);
      setCliInstallPath(installPath ?? null);
      setCliIsStale(isStale ?? false);
      setCliVersion(version);
    });
  }, [api, isElectron, open]);

  useEffect(() => {
    if (!open) return;
    void loadBundleStatuses();
  }, [open, loadBundleStatuses]);

  async function handleCopySlashInstall(installCmd: string) {
    await navigator.clipboard.writeText(installCmd);
    setSlashCommandCopied(true);
    setTimeout(() => setSlashCommandCopied(false), 2000);
  }

  async function handleAddFlag() {
    if (!flagInput.trim()) return;

    const newFlags = { ...agentFlags };
    if (!newFlags[selectedLocalAgent]) {
      newFlags[selectedLocalAgent] = [];
    }

    const flag = flagInput.trim();
    if (!newFlags[selectedLocalAgent].includes(flag)) {
      newFlags[selectedLocalAgent].push(flag);
      setAgentFlags(newFlags);
      try {
        await updateAgentFlagsAction(selectedLocalAgent, newFlags[selectedLocalAgent]);
      } catch (error) {
        console.error('Failed to save agent flags:', error);
      }
    }
    setFlagInput('');
  }

  async function handleRemoveFlag(agent: string, index: number) {
    const newFlags = { ...agentFlags };
    newFlags[agent] = (newFlags[agent] ?? []).filter((_, i) => i !== index);
    setAgentFlags(newFlags);
    try {
      await updateAgentFlagsAction(agent, newFlags[agent]);
    } catch (error) {
      console.error('Failed to save agent flags:', error);
    }
  }

  async function handleCopyCommand() {
    const flags = (agentFlags[selectedLocalAgent] ?? []).join(' ');
    const command = `npx overlord resume ${selectedLocalAgent}${flags ? ` ${flags}` : ''}`;
    await navigator.clipboard.writeText(command);
    setCommandCopied(true);
    setTimeout(() => setCommandCopied(false), 2000);
  }

  function handleDefaultAgentTriggerChange(value: string) {
    const nextValue = value as AgentSelectorValue;
    if (!AGENT_SELECTOR_VALUES.includes(nextValue)) return;
    setSelectedDefaultAgentTrigger(nextValue);
    window.localStorage.setItem(DEFAULT_AGENT_TRIGGER_STORAGE_KEY, nextValue);
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

  async function handleInstallBundle(agent: 'claude' | 'codex') {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading(agent);
    try {
      await window.electronAPI.agentBundle.install(agent);
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

  async function handleInstallAllBundles() {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading('all');
    try {
      await window.electronAPI.agentBundle.installAll();
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

  async function handleRepairBundle(agent: 'claude' | 'codex') {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading(`repair-${agent}`);
    try {
      await window.electronAPI.agentBundle.repair(agent);
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

  async function handleUninstallBundle(agent: 'claude' | 'codex') {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading(`uninstall-${agent}`);
    try {
      await window.electronAPI.agentBundle.uninstall(agent);
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

  const bundleStatusBadge = (status: BundleStatusEntry['status']) => {
    switch (status) {
      case 'installed':
        return (
          <Badge variant="default" className="bg-green-600 text-xs">
            Installed
          </Badge>
        );
      case 'stale':
        return (
          <Badge variant="secondary" className="text-xs">
            Update available
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="secondary" className="text-xs">
            Partial
          </Badge>
        );
      case 'not_installed':
        return (
          <Badge variant="outline" className="text-xs">
            Not installed
          </Badge>
        );
      default:
        return (
          <Badge variant="destructive" className="text-xs">
            Error
          </Badge>
        );
    }
  };

  const selectedAgentPlugin =
    AGENT_PLUGIN_OPTIONS.find(option => option.key === selectedAgentPluginKey) ??
    AGENT_PLUGIN_OPTIONS[0];

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Terminal agents & CLI</p>
        <p className="text-xs text-muted-foreground">
          Agents running in your terminal communicate with the Overlord Desktop App via CLI.
        </p>
      </div>

      {!isElectron ? (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-50/50 p-3 dark:bg-yellow-900/10">
          <p className="text-sm text-muted-foreground">
            Terminal agent controls are only available in the Overlord desktop app.
          </p>
        </div>
      ) : null}

      {isElectron ? (
        <>
          <div className="grid gap-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium">Agent trigger</p>
              <p className="text-xs text-muted-foreground">
                Choose which action appears as the default option in the agent split button.
              </p>
            </div>
            <Select
              value={selectedDefaultAgentTrigger}
              onValueChange={handleDefaultAgentTriggerChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select default option" />
              </SelectTrigger>
              <SelectContent>
                {AGENT_SELECTOR_VALUES.map(agentValue => (
                  <SelectItem key={agentValue} value={agentValue}>
                    {getAgentSelectorLabel(agentValue)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-1">
              <p className="text-sm font-medium">Local agent configuration</p>
              <p className="text-xs text-muted-foreground">
                Add custom flags to the agent command when running locally. Claude has
                --enable-auto-mode enabled by default.
              </p>
            </div>
            <Select value={selectedLocalAgent} onValueChange={setSelectedLocalAgent}>
              <SelectTrigger>
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {AGENTS.map(agent => (
                  <SelectItem key={agent} value={agent}>
                    {AGENT_LABELS[agent]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Command flags</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g., --enable-auto-mode"
                    value={flagInput}
                    onChange={e => setFlagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAddFlag();
                      }
                    }}
                    className="flex-1 rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddFlag()}
                    className="rounded border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/80"
                  >
                    Add
                  </button>
                </div>
              </div>
              {(agentFlags[selectedLocalAgent] ?? []).length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {(agentFlags[selectedLocalAgent] ?? []).map((flag, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1"
                      >
                        <code className="text-xs font-medium">{flag}</code>
                        <button
                          type="button"
                          onClick={() => void handleRemoveFlag(selectedLocalAgent, index)}
                          className="rounded p-0.5 hover:bg-muted-foreground/20"
                          title="Remove flag"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">Command</p>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand()}
                    className="shrink-0 rounded p-1 hover:bg-muted"
                    title="Copy command"
                  >
                    {commandCopied ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                  {`npx overlord resume ${selectedLocalAgent}${
                    (agentFlags[selectedLocalAgent] ?? []).length > 0
                      ? ` ${(agentFlags[selectedLocalAgent] ?? []).join(' ')}`
                      : ''
                  }`}
                </pre>
              </div>
            </div>
          </div>
        </>
      ) : null}

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

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Agent plugins</p>
          <p className="text-xs text-muted-foreground">
            Install durable prompt and skill config where supported, plus mid-session ticket
            commands for agents that can handle{' '}
            <code className="rounded bg-muted px-1">/connect</code>,{' '}
            <code className="rounded bg-muted px-1">/load</code>, and{' '}
            <code className="rounded bg-muted px-1">/spawn</code>.
          </p>
        </div>
        <div className="space-y-2">
          {AGENT_PLUGIN_GROUPS.map(group => {
            const options = AGENT_PLUGIN_OPTIONS.filter(option => option.agentKey === group.key);
            const bundleOption = options.find(
              (option): option is Extract<AgentPluginInstallOption, { kind: 'bundle' }> =>
                option.kind === 'bundle'
            );
            const bundleStatus = bundleOption
              ? bundleStatuses.find(status => status.agent === bundleOption.bundleAgent)
              : null;

            return (
              <div
                key={group.key}
                className="flex flex-col gap-3 rounded-md border bg-muted/30 p-3 md:flex-row md:items-start md:justify-between"
              >
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">{group.label}</p>
                    {bundleStatus ? bundleStatusBadge(bundleStatus.status) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {options.map(option => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSelectedAgentPluginKey(option.key)}
                        className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                          selectedAgentPluginKey === option.key
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border bg-background text-foreground hover:bg-muted'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedAgentPlugin?.agentKey === group.key
                      ? selectedAgentPlugin.description
                      : options.map(option => option.label).join(' • ')}
                  </p>
                </div>
                {bundleStatus ? (
                  <div className="flex items-center gap-1.5 self-start">
                    {(bundleStatus.status === 'not_installed' ||
                      bundleStatus.status === 'stale') && (
                      <button
                        type="button"
                        disabled={bundleActionLoading !== null}
                        onClick={() => void handleInstallBundle(bundleStatus.agent)}
                        className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                        title={
                          bundleStatus.status === 'stale'
                            ? 'Update prompt / skills'
                            : 'Install prompt / skills'
                        }
                      >
                        <Download className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                    {(bundleStatus.status === 'partial' || bundleStatus.status === 'error') && (
                      <button
                        type="button"
                        disabled={bundleActionLoading !== null}
                        onClick={() => void handleRepairBundle(bundleStatus.agent)}
                        className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                        title="Repair prompt / skills"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                    {bundleStatus.status === 'installed' && (
                      <button
                        type="button"
                        disabled={bundleActionLoading !== null}
                        onClick={() => void handleUninstallBundle(bundleStatus.agent)}
                        className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                        title="Uninstall prompt / skills"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {selectedAgentPlugin?.kind === 'slash' ? (
          (() => {
            const cfg = SLASH_COMMAND_CONFIGS[selectedAgentPlugin.slashAgent];
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
                    onClick={() => void handleCopySlashInstall(cfg.installCmd)}
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
          })()
        ) : selectedAgentPlugin?.kind === 'bundle' ? (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <p className="mb-1 font-sans text-muted-foreground">
              {selectedAgentPlugin.description}
            </p>
            {selectedAgentPlugin.supportNote ? (
              <p className="mb-2 font-sans text-muted-foreground">
                {selectedAgentPlugin.supportNote}
              </p>
            ) : null}
            <p className="font-sans text-muted-foreground">
              {bundleStatuses.find(status => status.agent === selectedAgentPlugin.bundleAgent)
                ?.details ?? 'Prompt and skill bundle details are available in the desktop app.'}
            </p>
          </div>
        ) : null}
        {isElectron && bundleStatuses.length > 0 ? (
          <LoadingButton
            buttonState={bundleActionLoading === 'all' ? 'loading' : 'default'}
            setButtonState={() => {}}
            text="Install all prompt / skills"
            loadingText="Installing..."
            successText="Installed"
            errorText="Retry"
            size="sm"
            variant="outline"
            onClick={() => void handleInstallAllBundles()}
            disabled={
              bundleActionLoading !== null || bundleStatuses.every(s => s.status === 'installed')
            }
          />
        ) : null}
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
