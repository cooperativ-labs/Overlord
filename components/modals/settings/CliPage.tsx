'use client';

import { Check, Copy, FolderOpen, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  AgentModelSelector,
  useAgentModelPreference
} from '@/components/features/AgentModelSelector';
import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';

type SlashCommandConfig = {
  label: string;
  description: string;
  supportNote?: string;
  filePaths: string[];
};

type BundleAgent = 'claude' | 'cursor' | 'opencode';
type SlashAgent = 'claude' | 'cursor' | 'gemini' | 'opencode';

type BundleStatusEntry = {
  agent: BundleAgent;
  status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
  version: string | null;
  installedVersion: string | null;
  details: string;
};

type SlashStatusEntry = {
  agent: SlashAgent;
  status: 'installed' | 'partial' | 'not_installed';
  details: string;
  managedFiles: string[];
  existingManagedFiles: string[];
  missingManagedFiles: string[];
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
      kind: 'service';
      serviceKey: 'overlord-plugin';
      supportNote?: string;
    }
  | {
      key: string;
      agentKey: string;
      label: string;
      description: string;
      kind: 'slash';
      slashAgent: SlashAgent;
      supportNote?: string;
    };

type PluginActionMeta = {
  label: 'Install' | 'Update' | 'Repair' | 'Remove';
  loadingText: string;
  successText: string;
  errorText: string;
};

type ServiceStatusEntry = {
  key: 'overlord-plugin';
  status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
  version: string | null;
  installedVersion: string | null;
  details: string;
  currentContentHash: string;
  managedFiles: string[];
  existingManagedFiles: string[];
  missingManagedFiles: string[];
};

const AGENTS = ['claude', 'cursor', 'codex', 'opencode'] as const;

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode'
};

function getAgentSelectorLabel(agentValue: AgentSelectorValue): string {
  if (agentValue === 'copy-local') return 'Copy Local';
  if (agentValue === 'copy-cloud') return 'Copy Cloud';
  return getAgentTypeByValue(agentValue).label;
}

const SLASH_COMMAND_CONFIGS: Record<string, SlashCommandConfig> = {
  claude: {
    label: 'Claude Code',
    description: 'Installs global slash commands for mid-session Overlord ticket operations.',
    supportNote: 'Creates `/connect`, `/load`, and `/spawn` in `~/.claude/commands/`.',
    filePaths: [
      '~/.claude/commands/connect.md',
      '~/.claude/commands/load.md',
      '~/.claude/commands/spawn.md'
    ]
  },
  cursor: {
    label: 'Cursor',
    description: 'Installs global slash commands for mid-session Overlord ticket operations.',
    supportNote: 'Creates `/connect`, `/load`, and `/spawn` in `~/.cursor/commands/`.',
    filePaths: [
      '~/.cursor/commands/connect.md',
      '~/.cursor/commands/load.md',
      '~/.cursor/commands/spawn.md'
    ]
  },
  gemini: {
    label: 'Gemini CLI',
    description: 'Installs global slash commands for mid-session Overlord ticket operations.',
    supportNote:
      'Creates `/connect`, `/load`, and `/spawn` in `~/.gemini/commands/`. Run `/commands reload` in Gemini CLI after installing.',
    filePaths: [
      '~/.gemini/commands/connect.toml',
      '~/.gemini/commands/load.toml',
      '~/.gemini/commands/spawn.toml'
    ]
  },
  opencode: {
    label: 'OpenCode',
    description: 'Installs global slash commands for mid-session Overlord ticket operations.',
    supportNote: 'Creates `/connect`, `/load`, and `/spawn` in `~/.config/opencode/commands/`.',
    filePaths: [
      '~/.config/opencode/commands/connect.md',
      '~/.config/opencode/commands/load.md',
      '~/.config/opencode/commands/spawn.md'
    ]
  }
};

const BUNDLE_FILE_PATHS: Record<BundleAgent, string[]> = {
  claude: [
    '~/.claude/skills/overlord-local/SKILL.md',
    '~/.claude/overlord-permission-hook.sh',
    '~/.claude/settings.json'
  ],
  cursor: ['~/.cursor/rules/overlord-local.mdc'],
  opencode: ['~/.config/opencode/AGENTS.md', '~/.config/opencode/opencode.json']
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
    key: 'codex:overlord-plugin',
    agentKey: 'codex',
    label: 'Chat plugin',
    description:
      'Installs the Overlord chat plugin into your home-local Codex plugin directories, migrates legacy Codex bundle config if present, and manages the local permission rules Codex needs for Overlord protocol commands.',
    kind: 'service',
    serviceKey: 'overlord-plugin',
    supportNote:
      'Managed by the desktop app in ~/.agents/plugins, ~/plugins, and ~/.codex/rules/default.rules. Requires ovld to be installed on PATH.'
  },
  {
    key: 'cursor:bundle',
    agentKey: 'cursor',
    label: 'Prompt / rules',
    description:
      'Installs the durable Overlord workflow bundle as a global Cursor rule (~/.cursor/rules/overlord-local.mdc) so ticket lifecycle rules live in local config.',
    kind: 'bundle',
    bundleAgent: 'cursor',
    supportNote: 'Managed by the desktop app in your local ~/.cursor/rules configuration.'
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
  },
  {
    key: 'opencode:bundle',
    agentKey: 'opencode',
    label: 'Prompt / skills',
    description:
      'Installs durable Overlord workflow instructions and OpenCode config so ticket lifecycle rules, permissions, and slash commands live in local config.',
    kind: 'bundle',
    bundleAgent: 'opencode',
    supportNote: 'Managed by the desktop app in your local ~/.config/opencode configuration.'
  },
  {
    key: 'opencode:slash',
    agentKey: 'opencode',
    label: '/connect /load /spawn',
    description: SLASH_COMMAND_CONFIGS.opencode.description,
    kind: 'slash',
    slashAgent: 'opencode',
    supportNote: SLASH_COMMAND_CONFIGS.opencode.supportNote
  }
];

const AGENT_PLUGIN_GROUPS = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex CLI' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'gemini', label: 'Gemini CLI' },
  { key: 'opencode', label: 'OpenCode' }
] as const;

function AgentNameWithLogo({
  agent,
  label,
  iconClassName = 'h-4 w-4'
}: {
  agent: BundleAgent | SlashAgent | AgentSelectorValue;
  label: string;
  iconClassName?: string;
}) {
  if (agent === 'copy-local' || agent === 'copy-cloud') {
    return <span>{label}</span>;
  }

  const agentType = getAgentTypeByValue(agent);

  return (
    <span className="flex items-center gap-2">
      <Image
        src={agentType.icon}
        alt={agentType.label}
        width={16}
        height={16}
        className={cn(iconClassName, agentType.invertDark ? 'dark:invert' : '')}
      />
      <span>{label}</span>
    </span>
  );
}

function getBundleActionMeta(status: BundleStatusEntry['status'] | undefined): PluginActionMeta {
  const label =
    status === 'installed'
      ? 'Remove'
      : status === 'partial' || status === 'error'
        ? 'Repair'
        : status === 'stale'
          ? 'Update'
          : 'Install';

  return {
    label,
    loadingText:
      label === 'Remove'
        ? 'Removing...'
        : label === 'Install'
          ? 'Installing...'
          : label === 'Update'
            ? 'Updating...'
            : 'Repairing...',
    successText:
      label === 'Remove'
        ? 'Removed'
        : label === 'Install'
          ? 'Installed'
          : label === 'Update'
            ? 'Updated'
            : 'Repaired',
    errorText: `${label} failed`
  };
}

function getSlashActionMeta(status: SlashStatusEntry['status'] | undefined): PluginActionMeta {
  const label = status === 'installed' || status === 'partial' ? 'Remove' : 'Install';

  return {
    label,
    loadingText: label === 'Remove' ? 'Removing...' : 'Installing...',
    successText: label === 'Remove' ? 'Removed' : 'Installed',
    errorText: `${label} failed`
  };
}

function DefaultAgentSelector() {
  const { selection, setSelection, selectAgent } = useAgentModelPreference();

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <AgentModelSelector
        value={selection}
        onChange={setSelection}
        onAgentSelect={selectAgent}
        inline
      />
    </div>
  );
}

export function CliPage({ open }: { open: boolean }) {
  const { isElectron, api } = useElectron();

  const [selectedDefaultAgentTrigger, setSelectedDefaultAgentTrigger] =
    useState<AgentSelectorValue>('claude');
  const [selectedLocalAgent, setSelectedLocalAgent] = useState<string>('claude');
  const [agentFlags, setAgentFlags] = useState<Record<string, string[]>>({});
  const [flagInput, setFlagInput] = useState('');
  const [commandCopied, setCommandCopied] = useState(false);

  const [slashStatuses, setSlashStatuses] = useState<SlashStatusEntry[]>([]);
  const [pluginActionButtonStates, setPluginActionButtonStates] = useState<
    Record<string, ButtonLoadingState>
  >({});
  const [pluginActionMessages, setPluginActionMessages] = useState<Record<string, string | null>>(
    {}
  );
  const [activePluginActionKey, setActivePluginActionKey] = useState<string | null>(null);

  const [cliInstallButtonState, setCliInstallButtonState] = useState<ButtonLoadingState>('default');
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliInstallMessage, setCliInstallMessage] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliIsStale, setCliIsStale] = useState(false);
  const [bundleStatuses, setBundleStatuses] = useState<BundleStatusEntry[]>([]);
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatusEntry[]>([]);
  const [installAllBundlesButtonState, setInstallAllBundlesButtonState] =
    useState<ButtonLoadingState>('default');

  const loadBundleStatuses = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.agentBundle) return;
    try {
      const statuses = await window.electronAPI.agentBundle.getAllStatuses();
      setBundleStatuses(statuses);
    } catch {
      // Agent bundle API not available
    }
  }, [isElectron]);

  const loadSlashStatuses = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.agentSlash) return;
    try {
      const statuses = await window.electronAPI.agentSlash.getAllStatuses();
      setSlashStatuses(statuses);
    } catch {
      // Slash command API not available
    }
  }, [isElectron]);

  const loadServiceStatuses = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.overlordPlugin) return;
    try {
      const status = await window.electronAPI.overlordPlugin.getStatus();
      setServiceStatuses([{ key: 'overlord-plugin', ...status }]);
    } catch {
      // Service API not available
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
    void loadSlashStatuses();
    void loadServiceStatuses();
  }, [open, loadBundleStatuses, loadSlashStatuses, loadServiceStatuses]);

  const setPluginActionButtonState = useCallback((key: string, state: ButtonLoadingState) => {
    setPluginActionButtonStates(current => ({ ...current, [key]: state }));
  }, []);

  const setPluginActionMessage = useCallback((key: string, message: string | null) => {
    setPluginActionMessages(current => ({ ...current, [key]: message }));
  }, []);

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
    const command = `ovld restart ${selectedLocalAgent}${flags ? ` ${flags}` : ''}`;
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

  async function handleInstallBundle(agent: BundleAgent, optionKey: string) {
    if (!window.electronAPI?.agentBundle) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    try {
      await window.electronAPI.agentBundle.install(agent);
      await loadBundleStatuses();
      if (agent === 'claude' || agent === 'opencode') {
        await loadSlashStatuses();
      }
      setPluginActionButtonState(optionKey, 'success');
    } catch {
      // Handled by status refresh
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleInstallAllBundles() {
    if (!window.electronAPI?.agentBundle) return;
    setInstallAllBundlesButtonState('loading');
    try {
      await window.electronAPI.agentBundle.installAll();
      await loadBundleStatuses();
      await loadSlashStatuses();
      setInstallAllBundlesButtonState('success');
    } catch {
      setInstallAllBundlesButtonState('error');
    }
  }

  async function handleRepairBundle(agent: BundleAgent, optionKey: string) {
    if (!window.electronAPI?.agentBundle) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    try {
      await window.electronAPI.agentBundle.repair(agent);
      await loadBundleStatuses();
      if (agent === 'claude' || agent === 'opencode') {
        await loadSlashStatuses();
      }
      setPluginActionButtonState(optionKey, 'success');
    } catch {
      // Handled by status refresh
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleUninstallBundle(agent: BundleAgent, optionKey: string) {
    if (!window.electronAPI?.agentBundle) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    try {
      await window.electronAPI.agentBundle.uninstall(agent);
      await loadBundleStatuses();
      if (agent === 'claude' || agent === 'opencode') {
        await loadSlashStatuses();
      }
      setPluginActionButtonState(optionKey, 'success');
    } catch {
      // Handled by status refresh
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleInstallSlashCommands(agent: SlashAgent, optionKey: string) {
    if (!window.electronAPI?.agentSlash) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    try {
      await window.electronAPI.agentSlash.install(agent);
      await loadSlashStatuses();
      setPluginActionButtonState(optionKey, 'success');
    } catch {
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleUninstallSlashCommands(agent: SlashAgent, optionKey: string) {
    if (!window.electronAPI?.agentSlash) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    try {
      await window.electronAPI.agentSlash.uninstall(agent);
      await loadSlashStatuses();
      setPluginActionButtonState(optionKey, 'success');
    } catch {
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleInstallService(optionKey: string) {
    if (!window.electronAPI?.overlordPlugin) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    setPluginActionMessage(optionKey, null);
    try {
      const result = await window.electronAPI.overlordPlugin.install();
      if (!result.ok) {
        throw new Error(result.error ?? 'Install failed');
      }
      await loadServiceStatuses();
      setPluginActionButtonState(optionKey, 'success');
    } catch (error) {
      setPluginActionMessage(optionKey, error instanceof Error ? error.message : 'Install failed');
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleRepairService(optionKey: string) {
    if (!window.electronAPI?.overlordPlugin) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    setPluginActionMessage(optionKey, null);
    try {
      const result = await window.electronAPI.overlordPlugin.repair();
      if (!result.ok) {
        throw new Error(result.error ?? 'Repair failed');
      }
      await loadServiceStatuses();
      setPluginActionButtonState(optionKey, 'success');
    } catch (error) {
      setPluginActionMessage(optionKey, error instanceof Error ? error.message : 'Repair failed');
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleUninstallService(optionKey: string) {
    if (!window.electronAPI?.overlordPlugin) return;
    setActivePluginActionKey(optionKey);
    setPluginActionButtonState(optionKey, 'loading');
    setPluginActionMessage(optionKey, null);
    try {
      const result = await window.electronAPI.overlordPlugin.uninstall();
      if (!result.ok) {
        throw new Error(result.error ?? 'Remove failed');
      }
      await loadServiceStatuses();
      setPluginActionButtonState(optionKey, 'success');
    } catch (error) {
      setPluginActionMessage(optionKey, error instanceof Error ? error.message : 'Remove failed');
      setPluginActionButtonState(optionKey, 'error');
    } finally {
      setActivePluginActionKey(null);
    }
  }

  async function handleRevealFile(filePath: string) {
    if (!window.electronAPI?.app?.revealFile) return;

    try {
      await window.electronAPI.app.revealFile(filePath);
    } catch (error) {
      console.error('Failed to reveal file in Finder:', error);
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

  const slashStatusBadge = (status: SlashStatusEntry['status']) => {
    switch (status) {
      case 'installed':
        return (
          <Badge variant="default" className="bg-green-600 text-xs">
            Installed
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="secondary" className="text-xs">
            Partial
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs">
            Not installed
          </Badge>
        );
    }
  };

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
          <Accordion type="multiple" className="grid gap-1">
            <AccordionItem value="default-agent" className="rounded-md border px-3">
              <AccordionTrigger className="hover:no-underline">
                <div className="grid gap-1">
                  <p className="text-sm font-medium">Default agent</p>
                  <p className="text-xs text-muted-foreground font-normal">
                    <AgentNameWithLogo
                      agent={selectedDefaultAgentTrigger}
                      label={getAgentSelectorLabel(selectedDefaultAgentTrigger)}
                    />
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-4">
                  <DefaultAgentSelector />
                  <div className="grid gap-2">
                    <p className="text-xs text-muted-foreground">
                      Default quick-launch target for the Run menu.
                    </p>
                    <Select
                      value={selectedDefaultAgentTrigger}
                      onValueChange={handleDefaultAgentTriggerChange}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select default agent" />
                      </SelectTrigger>
                      <SelectContent>
                        {AGENT_SELECTOR_VALUES.map(agentValue => (
                          <SelectItem key={agentValue} value={agentValue}>
                            <AgentNameWithLogo
                              agent={agentValue}
                              label={getAgentSelectorLabel(agentValue)}
                            />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="rounded-md border px-3 py-3 grid gap-4">
            <p className="text-sm font-medium">Local agent configuration</p>
            <div className="grid gap-4">
              <Select value={selectedLocalAgent} onValueChange={setSelectedLocalAgent}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {AGENTS.map(agent => (
                    <SelectItem key={agent} value={agent}>
                      <AgentNameWithLogo agent={agent} label={AGENT_LABELS[agent]} />
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
                    {`ovld restart ${selectedLocalAgent}${
                      (agentFlags[selectedLocalAgent] ?? []).length > 0
                        ? ` ${(agentFlags[selectedLocalAgent] ?? []).join(' ')}`
                        : ''
                    }`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

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
        <Accordion type="multiple" className="flex flex-col gap-2">
          {AGENT_PLUGIN_GROUPS.map(group => {
            const options = AGENT_PLUGIN_OPTIONS.filter(option => option.agentKey === group.key);

            const groupStatuses = options
              .map(option => {
                if (option.kind === 'bundle') {
                  const s = bundleStatuses.find(status => status.agent === option.bundleAgent);
                  return s ? { label: option.label, badge: bundleStatusBadge(s.status) } : null;
                }
                if (option.kind === 'service') {
                  const s = serviceStatuses.find(status => status.key === option.serviceKey);
                  return s ? { label: option.label, badge: bundleStatusBadge(s.status) } : null;
                }
                const s = slashStatuses.find(status => status.agent === option.slashAgent);
                return s ? { label: option.label, badge: slashStatusBadge(s.status) } : null;
              })
              .filter(Boolean);

            return (
              <AccordionItem
                key={group.key}
                value={group.key}
                className="rounded-md border bg-muted/30 px-3"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="grid gap-1">
                    <p className="text-xs font-medium">
                      <AgentNameWithLogo agent={group.key} label={group.label} />
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground font-normal">
                        {options.map(option => option.label).join(' · ')}
                      </p>
                      {groupStatuses.map((gs, i) => (
                        <span key={i}>{gs!.badge}</span>
                      ))}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-3">
                    {options.map(option => {
                      const bundleStatus =
                        option.kind === 'bundle'
                          ? bundleStatuses.find(status => status.agent === option.bundleAgent)
                          : null;
                      const slashStatus =
                        option.kind === 'slash'
                          ? slashStatuses.find(status => status.agent === option.slashAgent)
                          : null;
                      const serviceStatus =
                        option.kind === 'service'
                          ? serviceStatuses.find(status => status.key === option.serviceKey)
                          : null;
                      const actionMeta =
                        option.kind === 'bundle'
                          ? getBundleActionMeta(bundleStatus?.status)
                          : option.kind === 'service'
                            ? getBundleActionMeta(serviceStatus?.status)
                            : getSlashActionMeta(slashStatus?.status);
                      const managedFiles =
                        option.kind === 'bundle'
                          ? BUNDLE_FILE_PATHS[option.bundleAgent]
                          : option.kind === 'service'
                            ? (serviceStatus?.managedFiles ?? [])
                            : (slashStatus?.managedFiles ??
                              SLASH_COMMAND_CONFIGS[option.slashAgent].filePaths);
                      const details =
                        option.kind === 'bundle'
                          ? (bundleStatus?.details ??
                            'Prompt and skill bundle details are available in the desktop app.')
                          : option.kind === 'service'
                            ? (serviceStatus?.details ??
                              'Plugin installation details are available in the desktop app.')
                            : slashStatus?.details;
                      const canRunAction =
                        option.kind === 'bundle'
                          ? Boolean(bundleStatus)
                          : option.kind === 'service'
                            ? Boolean(serviceStatus)
                            : Boolean(slashStatus);
                      const buttonState = pluginActionButtonStates[option.key] ?? 'default';
                      const actionMessage = pluginActionMessages[option.key];

                      return (
                        <div key={option.key} className="rounded-md border bg-background p-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="grid gap-2">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-medium">{option.label}</p>
                                {option.kind === 'bundle'
                                  ? bundleStatus
                                    ? bundleStatusBadge(bundleStatus.status)
                                    : null
                                  : option.kind === 'service'
                                    ? serviceStatus
                                      ? bundleStatusBadge(serviceStatus.status)
                                      : null
                                    : slashStatus
                                      ? slashStatusBadge(slashStatus.status)
                                      : null}
                              </div>
                              <p className="text-xs text-muted-foreground">{option.description}</p>
                              {option.supportNote ? (
                                <p className="text-xs text-muted-foreground">
                                  {option.supportNote}
                                </p>
                              ) : null}
                              {details ? (
                                <p className="text-xs text-muted-foreground">{details}</p>
                              ) : null}
                              <div className="grid gap-2">
                                {managedFiles.map(filePath => (
                                  <div
                                    key={filePath}
                                    className="flex flex-col gap-2 rounded-md border bg-muted/20 p-2 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <code className="break-all text-xs text-muted-foreground">
                                      {filePath}
                                    </code>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="shrink-0 gap-2"
                                      onClick={() => void handleRevealFile(filePath)}
                                    >
                                      <FolderOpen className="h-3.5 w-3.5" />
                                      Open in Finder
                                    </Button>
                                  </div>
                                ))}
                                {managedFiles.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No managed files found yet.
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            {isElectron ? (
                              <LoadingButton
                                buttonState={buttonState}
                                setButtonState={state =>
                                  setPluginActionButtonState(option.key, state)
                                }
                                text={actionMeta.label}
                                loadingText={actionMeta.loadingText}
                                successText={actionMeta.successText}
                                errorText={actionMeta.errorText}
                                size="sm"
                                variant="outline"
                                reset={true}
                                onClick={() =>
                                  void (option.kind === 'bundle'
                                    ? bundleStatus?.status === 'installed'
                                      ? handleUninstallBundle(bundleStatus.agent, option.key)
                                      : bundleStatus?.status === 'partial' ||
                                          bundleStatus?.status === 'error'
                                        ? handleRepairBundle(bundleStatus.agent, option.key)
                                        : handleInstallBundle(option.bundleAgent, option.key)
                                    : option.kind === 'service'
                                      ? serviceStatus?.status === 'installed'
                                        ? handleUninstallService(option.key)
                                        : serviceStatus?.status === 'partial' ||
                                            serviceStatus?.status === 'error'
                                          ? handleRepairService(option.key)
                                          : handleInstallService(option.key)
                                      : !slashStatus || slashStatus.status === 'not_installed'
                                        ? handleInstallSlashCommands(option.slashAgent, option.key)
                                        : handleUninstallSlashCommands(
                                            option.slashAgent,
                                            option.key
                                          ))
                                }
                                disabled={!canRunAction || activePluginActionKey !== null}
                              />
                            ) : null}
                            {isElectron && actionMessage ? (
                              <p className="text-xs text-destructive">{actionMessage}</p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
        {isElectron && bundleStatuses.length > 0 ? (
          <LoadingButton
            buttonState={installAllBundlesButtonState}
            setButtonState={setInstallAllBundlesButtonState}
            text="Install all prompt / skills"
            loadingText="Installing..."
            successText="Installed"
            errorText="Retry"
            size="sm"
            variant="outline"
            reset
            onClick={() => void handleInstallAllBundles()}
            disabled={
              activePluginActionKey !== null ||
              installAllBundlesButtonState === 'loading' ||
              bundleStatuses.every(s => s.status === 'installed')
            }
          />
        ) : null}
      </div>

      <div className="grid gap-1">
        <p className="text-sm font-medium">Overlord CLI (ovld)</p>
        <p className="text-xs text-muted-foreground">
          The CLI lets agents in Claude Code, Codex, Cursor, Gemini, and OpenCode work with Overlord
          tickets. Available commands:
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
            <code className="rounded bg-muted px-1 break-all">ovld create &lt;objective&gt;</code>{' '}
            create a ticket after numbered project selection
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld prompt &lt;objective&gt;</code>{' '}
            create a ticket, then pick an agent by number and launch it
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
            <code className="rounded bg-muted px-1 break-all">
              ovld protocol &lt;subcommand&gt;
            </code>{' '}
            attach, connect, load-context, spawn, update, ask, read-context, write-context, deliver,
            artifact-upload-file
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld connect &lt;agent&gt;</code>{' '}
            launch agent on a ticket
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld restart &lt;agent&gt;</code>{' '}
            resume an agent session
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld context</code> print ticket context
            (requires TICKET_ID)
          </li>
        </ul>
        <p className="mt-3 mb-2 font-sans font-medium text-foreground">Examples</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld create &quot;Implement login page&quot;
            </code>{' '}
            — prompts for a numbered project choice, then creates the ticket
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld prompt &quot;Investigate flaky tests&quot;
            </code>{' '}
            — prompts for numbered project and agent choices, then launches the agent
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld attach</code> — interactive: search
            tickets, pick agent
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Run <code className="rounded bg-muted px-1 break-all">ovld &lt;command&gt; --help</code>{' '}
          for more detail.
        </p>
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
            <code className="rounded bg-muted px-1">ovld</code> from the project directory.
          </p>
        </div>
      )}
    </div>
  );
}
