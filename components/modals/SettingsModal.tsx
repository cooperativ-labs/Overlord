'use client';

import {
  Bot,
  Check,
  Copy,
  Edit3,
  Link2,
  Monitor,
  Palette,
  RefreshCcw,
  Terminal
} from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';

import { EverhourSettings } from '@/components/features/everhour/EverhourSettings';
import { MarkdownContent } from '@/components/features/MarkdownContent';
import { useTerminal } from '@/components/features/terminal/TerminalProvider';
import { useElectron } from '@/components/features/terminal/useElectron';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from '@/components/ui/sidebar';
import { Textarea } from '@/components/ui/textarea';
import {
  getRunningAgentSessionCountAction,
  getRunningAgentSessionsAction,
  type RunningAgentSession,
  stopRunningAgentSessionAction
} from '@/lib/actions/agent-sessions';
import { getAgentTokenAction, rotateAgentTokenAction } from '@/lib/actions/agent-tokens';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';
import {
  getCustomInstructionsAction,
  saveCustomInstructionsAction
} from '@/lib/actions/profile-settings';
import { buildTicketPath } from '@/lib/helpers/ticket-path';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const terminalModeOptions = [
  { value: 'embedded', label: 'Embedded' },
  { value: 'external', label: 'External' }
] as const;

const externalTerminalAppOptions = [
  { value: 'default', label: 'System Default' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm2' },
  { value: 'warp', label: 'Warp' },
  { value: 'ghostty', label: 'Ghostty' },
  { value: 'alacritty', label: 'Alacritty' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'hyper', label: 'Hyper' },
  { value: 'cmux', label: 'cmux' },
  { value: 'custom', label: 'Custom…' }
] as const;

const externalTerminalLaunchModeOptions = [
  { value: 'window', label: 'New window' },
  { value: 'tab', label: 'New tab' },
  { value: 'custom', label: 'Custom' }
] as const;

type ElectronAppUpdateStatus = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['appUpdate']['getStatus']>
>;

type NavItem = {
  name: string;
  icon: React.ElementType;
  electronOnly?: boolean;
};

const navItems: NavItem[] = [
  { name: 'Integrations', icon: Link2 },
  { name: 'Agents & MCP', icon: Bot },
  { name: 'Customization', icon: Edit3 },
  { name: 'CLI', icon: Terminal },
  { name: 'Appearance', icon: Palette },
  { name: 'Terminal', icon: Monitor, electronOnly: true },
  { name: 'Updates', icon: RefreshCcw, electronOnly: true }
];

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
] as const;

type SlashCommandConfig = {
  label: string;
  filePath: string;
  description: string;
  fileContent: string;
  installCmd: string;
};

const SLASH_COMMAND_CONFIGS: Record<string, SlashCommandConfig> = {
  claude: {
    label: 'Claude Code',
    filePath: '.claude/commands/switch-ticket.md',
    description:
      'Creates a /switch-ticket slash command for Claude Code in your project directory.',
    fileContent: `The user wants to switch to a different Overlord ticket.

Run \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once the user picks a ticket, run \`ovld attach <ticketId> claude\` to launch a new agent session on that ticket.`,
    installCmd: `mkdir -p .claude/commands && cat > .claude/commands/switch-ticket.md << 'EOF'\nThe user wants to switch to a different Overlord ticket.\n\nRun \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once the user picks a ticket, run \`ovld attach <ticketId> claude\` to launch a new agent session on that ticket.\nEOF`
  },
  codex: {
    label: 'Codex CLI',
    filePath: 'AGENTS.md',
    description:
      'Appends switch-ticket instructions to your AGENTS.md so Codex knows how to switch tickets.',
    fileContent: `## Switching Overlord tickets

To switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> codex\` to go directly to a specific ticket.`,
    installCmd: `cat >> AGENTS.md << 'EOF'\n\n## Switching Overlord tickets\n\nTo switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> codex\` to go directly to a specific ticket.\nEOF`
  },
  cursor: {
    label: 'Cursor',
    filePath: '.cursor/rules/switch-ticket.mdc',
    description:
      'Creates a Cursor rule that teaches the agent how to switch Overlord tickets on request.',
    fileContent: `---
description: Switch to a different Overlord ticket
globs:
alwaysApply: false
---

The user wants to switch to a different Overlord ticket.

Run \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once confirmed, run \`ovld attach <ticketId> cursor\` to start a new session on that ticket.`,
    installCmd: `mkdir -p .cursor/rules && cat > .cursor/rules/switch-ticket.mdc << 'EOF'\n---\ndescription: Switch to a different Overlord ticket\nglobs:\nalwaysApply: false\n---\n\nThe user wants to switch to a different Overlord ticket.\n\nRun \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once confirmed, run \`ovld attach <ticketId> cursor\` to start a new session on that ticket.\nEOF`
  },
  gemini: {
    label: 'Gemini CLI',
    filePath: 'GEMINI.md',
    description:
      'Appends switch-ticket instructions to your GEMINI.md so Gemini knows how to switch tickets.',
    fileContent: `## Switching Overlord tickets

To switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> gemini\` to go directly to a specific ticket.`,
    installCmd: `cat >> GEMINI.md << 'EOF'\n\n## Switching Overlord tickets\n\nTo switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> gemini\` to go directly to a specific ticket.\nEOF`
  }
};

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { isElectron, api } = useElectron();
  const { terminalMode, setTerminalMode } = useTerminal();
  const { theme, setTheme } = useTheme();
  const [terminalApp, setTerminalApp] = useState('default');
  const [terminalLaunchMode, setTerminalLaunchMode] = useState('window');
  const [terminalCustomHotkey, setTerminalCustomHotkey] = useState('');
  const [customTerminalApp, setCustomTerminalApp] = useState('');
  const [everhourConnected, setEverhourConnected] = useState(false);
  const [everhourUpdatedAt, setEverhourUpdatedAt] = useState<string | null>(null);
  const [everhourStatusLoaded, setEverhourStatusLoaded] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ElectronAppUpdateStatus | null>(null);
  const [checkUpdateButtonState, setCheckUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [downloadUpdateButtonState, setDownloadUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [restartToUpdateButtonState, setRestartToUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [refreshAgentsButtonState, setRefreshAgentsButtonState] =
    useState<ButtonLoadingState>('default');
  const [runningAgents, setRunningAgents] = useState<RunningAgentSession[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [stopAgentButtonStates, setStopAgentButtonStates] = useState<
    Record<string, ButtonLoadingState>
  >({});
  const [installWarningOpen, setInstallWarningOpen] = useState(false);
  const [runningAgentCount, setRunningAgentCount] = useState(0);
  const [platformUrl, setPlatformUrl] = useState<string | null>(null);
  const [cliInstallButtonState, setCliInstallButtonState] = useState<ButtonLoadingState>('default');
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliInstallMessage, setCliInstallMessage] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliIsStale, setCliIsStale] = useState(false);
  const [selectedSlashAgent, setSelectedSlashAgent] = useState('claude');
  const [slashCommandCopied, setSlashCommandCopied] = useState(false);
  const [agentToken, setAgentToken] = useState<string | null>(null);
  const [agentTokenLoading, setAgentTokenLoading] = useState(false);
  const [agentTokenError, setAgentTokenError] = useState<string | null>(null);
  const [agentEnvSnippetCopied, setAgentEnvSnippetCopied] = useState(false);
  const [agentDomainSnippetCopied, setAgentDomainSnippetCopied] = useState(false);
  const [rotateTokenButtonState, setRotateTokenButtonState] =
    useState<ButtonLoadingState>('default');
  const [customInstructions, setCustomInstructions] = useState('');
  const [customInstructionsLoading, setCustomInstructionsLoading] = useState(false);
  const [customInstructionsError, setCustomInstructionsError] = useState<string | null>(null);
  const [customInstructionsSaveState, setCustomInstructionsSaveState] =
    useState<ButtonLoadingState>('default');
  const [customInstructionsLastLoadedAt, setCustomInstructionsLastLoadedAt] = useState<
    string | null
  >(null);

  const visibleNavItems = navItems.filter(item => !item.electronOnly || isElectron);
  const [activeNav, setActiveNav] = useState<string>('Integrations');

  const resolvedPlatformUrl =
    platformUrl ??
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : null) ??
    'https://overlord.cooperativ.io';
  const resolvedPlatformDomain = (() => {
    try {
      return new URL(resolvedPlatformUrl).hostname;
    } catch {
      return 'overlord.cooperativ.io';
    }
  })();
  const supabaseDomain = (() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return null;
    try {
      return new URL(supabaseUrl).hostname;
    } catch {
      return null;
    }
  })();
  const allowedDomainLines = Array.from(
    new Set(
      [resolvedPlatformDomain, supabaseDomain].filter((value): value is string => Boolean(value))
    )
  );
  const domainSnippet = allowedDomainLines.join('\n');

  // Reset to first visible item when electron state changes
  useEffect(() => {
    if (visibleNavItems.length > 0 && !visibleNavItems.find(i => i.name === activeNav)) {
      setActiveNav(visibleNavItems[0]!.name);
    }
  }, [isElectron]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!api || !open) return;
    Promise.all([
      api.settings.get<string>('externalTerminalApp'),
      api.settings.get<string>('externalTerminalLaunchMode'),
      api.settings.get<string>('customExternalTerminalApp'),
      api.settings.get<string>('externalTerminalCustomHotkey')
    ]).then(([appValue, launchModeValue, customAppValue, customHotkeyValue]) => {
      if (appValue) setTerminalApp(appValue);
      if (launchModeValue) setTerminalLaunchMode(launchModeValue);
      if (typeof customAppValue === 'string') setCustomTerminalApp(customAppValue);
      if (typeof customHotkeyValue === 'string') setTerminalCustomHotkey(customHotkeyValue);
    });
  }, [api, open]);

  useEffect(() => {
    if (!open) return;
    setEverhourStatusLoaded(false);
    getEverhourConnectionStatus()
      .then(({ connected, updatedAt }) => {
        setEverhourConnected(connected);
        setEverhourUpdatedAt(updatedAt);
      })
      .catch(() => {
        setEverhourConnected(false);
        setEverhourUpdatedAt(null);
      })
      .finally(() => setEverhourStatusLoaded(true));
  }, [open]);

  const loadCustomInstructions = useCallback(async () => {
    setCustomInstructionsLoading(true);
    setCustomInstructionsError(null);
    try {
      const loadedInstructions = await getCustomInstructionsAction();
      setCustomInstructions(loadedInstructions);
      setCustomInstructionsLastLoadedAt(new Date().toISOString());
    } catch (error) {
      console.error('Failed to load custom instructions:', error);
      setCustomInstructionsError(
        error instanceof Error ? error.message : 'Failed to load custom instructions.'
      );
    } finally {
      setCustomInstructionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadCustomInstructions();
  }, [open, loadCustomInstructions]);

  useEffect(() => {
    if (!open) {
      setCustomInstructionsSaveState('default');
      setCustomInstructionsError(null);
    }
  }, [open]);

  const loadAgentToken = useCallback(async () => {
    setAgentTokenLoading(true);
    setAgentTokenError(null);
    try {
      const token = await getAgentTokenAction();
      setAgentToken(token);
    } catch (error) {
      console.error('Failed to load agent token:', error);
      setAgentTokenError(error instanceof Error ? error.message : 'Failed to load agent token.');
    } finally {
      setAgentTokenLoading(false);
    }
  }, []);

  async function loadRunningAgents(): Promise<boolean> {
    setAgentsError(null);
    try {
      const sessions = await getRunningAgentSessionsAction();
      setRunningAgents(sessions);
      return true;
    } catch (error) {
      console.error('Failed to load running agents:', error);
      setAgentsError('Failed to load running agents.');
      return false;
    } finally {
      setAgentsLoaded(true);
    }
  }

  async function handleSaveCustomInstructions() {
    if (customInstructionsLoading) return;

    setCustomInstructionsSaveState('loading');
    setCustomInstructionsError(null);
    try {
      const savedInstructions = await saveCustomInstructionsAction(customInstructions);
      setCustomInstructions(savedInstructions);
      setCustomInstructionsLastLoadedAt(new Date().toISOString());
      setCustomInstructionsSaveState('success');
    } catch (error) {
      console.error('Failed to save custom instructions:', error);
      setCustomInstructionsSaveState('error');
      setCustomInstructionsError(
        error instanceof Error ? error.message : 'Failed to save custom instructions.'
      );
    }
  }

  useEffect(() => {
    if (!open) return;
    setAgentsLoaded(false);
    void loadRunningAgents();
  }, [open]);

  useEffect(() => {
    if (!open || activeNav !== 'Agents & MCP') return;
    void loadAgentToken();
  }, [open, activeNav, loadAgentToken]);

  useEffect(() => {
    if (!open || !isElectron || !api) return;

    api.appUpdate
      .getStatus()
      .then(status => {
        setUpdateStatus(status);
      })
      .catch(() => {
        setUpdateStatus(null);
      });

    const unsubscribe = api.appUpdate.onStatus(status => {
      setUpdateStatus(status);
      if (status.phase === 'available') {
        setDownloadUpdateButtonState('default');
      }
      if (status.phase === 'downloaded') {
        setRestartToUpdateButtonState('default');
      }
    });

    return unsubscribe;
  }, [api, isElectron, open]);

  useEffect(() => {
    if (!open || !isElectron) return;
    if (typeof window !== 'undefined' && window.electronAPI?.app?.getPlatformUrl) {
      void window.electronAPI.app.getPlatformUrl().then(url => {
        if (url) setPlatformUrl(url);
      });
    }
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

  async function handleCopySlashInstall() {
    const config = SLASH_COMMAND_CONFIGS[selectedSlashAgent];
    if (!config) return;
    await navigator.clipboard.writeText(config.installCmd);
    setSlashCommandCopied(true);
    setTimeout(() => setSlashCommandCopied(false), 2000);
  }

  async function handleCopyAgentEnvSnippet() {
    const snippetToken = agentToken ?? '<AGENT_TOKEN>';
    const snippet = `PLATFORM_URL=${resolvedPlatformUrl}\nAGENT_TOKEN=${snippetToken}`;
    await navigator.clipboard.writeText(snippet);
    setAgentEnvSnippetCopied(true);
    setTimeout(() => setAgentEnvSnippetCopied(false), 2000);
  }

  async function handleCopyAgentDomainSnippet() {
    await navigator.clipboard.writeText(domainSnippet);
    setAgentDomainSnippetCopied(true);
    setTimeout(() => setAgentDomainSnippetCopied(false), 2000);
  }

  function handleTerminalModeChange(value: string) {
    const mode = value === 'embedded' ? 'embedded' : 'external';
    setTerminalMode(mode);
  }

  async function handleTerminalAppChange(value: string) {
    setTerminalApp(value);
    await api?.settings.set('externalTerminalApp', value);
  }

  async function handleTerminalLaunchModeChange(value: string) {
    setTerminalLaunchMode(value);
    await api?.settings.set('externalTerminalLaunchMode', value);
  }

  async function handleTerminalCustomHotkeyChange(value: string) {
    setTerminalCustomHotkey(value);
    await api?.settings.set('externalTerminalCustomHotkey', value);
  }

  function handleTerminalCustomHotkeyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Tab') {
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      void handleTerminalCustomHotkeyChange('');
      return;
    }

    const isMac =
      typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

    const parts: string[] = [];

    if (event.metaKey) {
      parts.push(isMac ? 'Cmd' : 'Meta');
    }
    if (event.ctrlKey) {
      parts.push('Ctrl');
    }
    if (event.altKey) {
      parts.push(isMac ? 'Option' : 'Alt');
    }
    if (event.shiftKey) {
      parts.push('Shift');
    }

    const modifierKeys = ['Meta', 'Control', 'Alt', 'Shift'];
    let key = event.key;

    if (!modifierKeys.includes(key)) {
      if (key.length === 1) {
        key = key.toUpperCase();
      } else if (key === ' ') {
        key = 'Space';
      }
      parts.push(key);
    }

    if (parts.length === 0) {
      return;
    }

    void handleTerminalCustomHotkeyChange(parts.join(' + '));
  }

  async function handleCustomTerminalAppChange(value: string) {
    setCustomTerminalApp(value);
    await api?.settings.set('customExternalTerminalApp', value);
  }

  async function handleCheckForUpdates() {
    if (!api) return;

    setCheckUpdateButtonState('loading');
    try {
      const started = await api.appUpdate.checkForUpdates();
      setCheckUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setCheckUpdateButtonState('error');
    }
  }

  async function handleDownloadUpdate() {
    if (!api) return;

    setDownloadUpdateButtonState('loading');
    try {
      const started = await api.appUpdate.downloadUpdate();
      setDownloadUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to download update:', error);
      setDownloadUpdateButtonState('error');
    }
  }

  async function restartToInstallUpdate() {
    if (!api) return;

    setRestartToUpdateButtonState('loading');
    try {
      const started = await api.appUpdate.quitAndInstall();
      setRestartToUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to restart and install update:', error);
      setRestartToUpdateButtonState('error');
    }
  }

  async function handleRestartToInstallUpdate() {
    if (!api) return;

    setRestartToUpdateButtonState('loading');
    try {
      const runningCount = await getRunningAgentSessionCountAction();
      if (runningCount > 0) {
        setRunningAgentCount(runningCount);
        setInstallWarningOpen(true);
        setRestartToUpdateButtonState('default');
        return;
      }

      const started = await api.appUpdate.quitAndInstall();
      setRestartToUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to restart and install update:', error);
      setRestartToUpdateButtonState('error');
    }
  }

  async function handleRefreshAgents() {
    setRefreshAgentsButtonState('loading');
    const refreshed = await loadRunningAgents();
    setRefreshAgentsButtonState(refreshed ? 'success' : 'error');
  }

  async function handleStopAgent(sessionId: string) {
    setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'loading' }));
    try {
      await stopRunningAgentSessionAction(sessionId);
      setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'success' }));
      await loadRunningAgents();
    } catch (error) {
      console.error('Failed to stop running agent:', error);
      setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'error' }));
    }
  }

  async function handleRotateAgentToken() {
    setRotateTokenButtonState('loading');
    setAgentTokenError(null);
    try {
      const token = await rotateAgentTokenAction();
      setAgentToken(token);
      setRotateTokenButtonState('success');
    } catch (error) {
      console.error('Failed to rotate agent token:', error);
      setRotateTokenButtonState('error');
      setAgentTokenError(error instanceof Error ? error.message : 'Failed to rotate agent token.');
    }
  }

  const canShowDownloadUpdate = updateStatus?.phase === 'available';
  const canShowInstallUpdate = updateStatus?.phase === 'downloaded';
  const updateStatusMessage =
    updateStatus?.message ?? 'Use Check for updates to look for a newer release.';
  const sessionCountLabel =
    runningAgents.length === 1
      ? '1 running agent session'
      : `${runningAgents.length} running agent sessions`;
  const customInstructionsPreviewText =
    customInstructions.trim() || '_No custom instructions have been saved yet._';

  const supportsLaunchModeSelection =
    terminalApp !== 'ghostty' && terminalApp !== 'alacritty' && terminalApp !== 'kitty';

  const selectedTerminalLabel =
    externalTerminalAppOptions.find(opt => opt.value === terminalApp)?.label ?? 'your terminal';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="overflow-hidden p-0 md:max-h-[560px] md:max-w-[700px] lg:max-w-[800px]">
          <DialogTitle className="sr-only">Settings</DialogTitle>
          <DialogDescription className="sr-only">Customize your settings here.</DialogDescription>
          <SidebarProvider className="items-start">
            <Sidebar collapsible="none" className="hidden md:flex">
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {visibleNavItems.map(item => (
                        <SidebarMenuItem key={item.name}>
                          <SidebarMenuButton
                            isActive={item.name === activeNav}
                            onClick={() => setActiveNav(item.name)}
                          >
                            <item.icon />
                            <span>{item.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
            <main className="flex h-[540px] flex-1 flex-col overflow-hidden">
              <header className="flex h-16 shrink-0 items-center gap-2 border-b">
                <div className="flex items-center gap-2 px-4">
                  <Breadcrumb>
                    <BreadcrumbList>
                      <BreadcrumbItem className="hidden md:block">
                        <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className="hidden md:block" />
                      <BreadcrumbItem>
                        <BreadcrumbPage>{activeNav}</BreadcrumbPage>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>
                </div>
              </header>
              <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
                {activeNav === 'Integrations' && (
                  <>
                    {everhourStatusLoaded ? (
                      <EverhourSettings
                        initiallyConnected={everhourConnected}
                        lastUpdatedAt={everhourUpdatedAt}
                        compact
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">Loading…</p>
                    )}
                  </>
                )}

                {activeNav === 'Agents & MCP' && (
                  <div className="grid gap-6">
                    <div className="grid gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="grid gap-1">
                          <p className="text-sm font-medium">Running agents</p>
                          <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
                        </div>
                        <LoadingButton
                          buttonState={refreshAgentsButtonState}
                          setButtonState={setRefreshAgentsButtonState}
                          text="Refresh"
                          loadingText="Refreshing..."
                          successText="Refreshed"
                          errorText="Try again"
                          reset
                          variant="outline"
                          onClick={handleRefreshAgents}
                        />
                      </div>
                      {!agentsLoaded ? (
                        <p className="text-sm text-muted-foreground">Loading running agents…</p>
                      ) : null}
                      {agentsError ? <p className="text-sm text-destructive">{agentsError}</p> : null}
                      {agentsLoaded && !agentsError && runningAgents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No agents are currently running.
                        </p>
                      ) : null}
                      {runningAgents.map(session => (
                        <div
                          key={session.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <Link
                              className="block truncate text-sm font-medium hover:underline"
                              href={buildTicketPath({
                                organizationId: session.organizationId,
                                projectId: session.projectId,
                                ticketId: session.ticketId
                              })}
                            >
                              {session.ticketTitle ?? 'Untitled ticket'}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              Agent: {session.agentIdentifier}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Attached {new Date(session.attachedAt).toLocaleString()}
                            </p>
                          </div>
                          <LoadingButton
                            buttonState={stopAgentButtonStates[session.id] ?? 'default'}
                            setButtonState={state =>
                              setStopAgentButtonStates(previous => ({
                                ...previous,
                                [session.id]: state
                              }))
                            }
                            text="Stop agent"
                            loadingText="Stopping..."
                            successText="Stopped"
                            errorText="Retry"
                            reset
                            size="sm"
                            variant="destructive"
                            onClick={() => handleStopAgent(session.id)}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-4">
                      <div className="grid gap-1">
                        <p className="text-sm font-medium">Cloud agents &amp; MCP</p>
                        <p className="text-xs text-muted-foreground">
                          Configure hosted agents like Claude Code and Codex so they can talk to
                          Overlord via MCP and HTTP.
                        </p>
                      </div>
                      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                        <p className="text-xs text-muted-foreground">
                          Cloud agents run in a secure cloud environment and connect back to Overlord
                          using your agent token and allowed domains configuration.
                        </p>
                        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                          <li>
                            Open your cloud environment settings in Claude Code, Codex, or another
                            MCP-based agent.
                          </li>
                          <li>Paste the environment variables snippet below into your env config.</li>
                          <li>
                            Add the domain snippet below to the allowed domains list, and keep the
                            default domain list enabled if your tool provides that option.
                          </li>
                        </ol>
                      </div>
                      <div className="grid gap-3">
                        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-foreground">
                              Environment variables snippet
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleCopyAgentEnvSnippet()}
                              className="shrink-0 rounded p-1 hover:bg-muted"
                              title="Copy environment snippet"
                            >
                              {agentEnvSnippetCopied ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                            {`PLATFORM_URL=${resolvedPlatformUrl}\nAGENT_TOKEN=${
                              agentToken ?? '<AGENT_TOKEN>'
                            }`}
                          </pre>
                          <p className="text-xs text-muted-foreground">
                            Paste this into your custom cloud environment so the agent can call
                            Overlord with your personal token.
                          </p>
                        </div>
                        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-foreground">Domain snippet</p>
                            <button
                              type="button"
                              onClick={() => void handleCopyAgentDomainSnippet()}
                              className="shrink-0 rounded p-1 hover:bg-muted"
                              title="Copy domain snippet"
                            >
                              {agentDomainSnippetCopied ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                            {domainSnippet}
                          </pre>
                          <p className="text-xs text-muted-foreground">
                            Add these domains to the allowed domains list for your cloud environment.
                            Include your Overlord domain and your Supabase MCP host. We recommend also
                            keeping the option checked to include the default domain list.
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="grid gap-1">
                            <p className="text-sm font-medium">Agent token</p>
                            <p className="text-xs text-muted-foreground">
                              Each user has a personal agent token used when Overlord talks to your
                              cloud IDE agents. Rotate it if it is ever exposed.
                            </p>
                          </div>
                          <LoadingButton
                            buttonState={rotateTokenButtonState}
                            setButtonState={setRotateTokenButtonState}
                            text={agentToken ? 'Rotate token' : 'Create token'}
                            loadingText={agentToken ? 'Rotating...' : 'Creating...'}
                            successText={agentToken ? 'Rotated' : 'Created'}
                            errorText="Retry"
                            reset
                            size="sm"
                            variant="outline"
                            onClick={handleRotateAgentToken}
                          />
                        </div>
                        {agentTokenError ? (
                          <p className="text-xs text-destructive">{agentTokenError}</p>
                        ) : null}
                        {agentTokenLoading ? (
                          <p className="text-xs text-muted-foreground">Loading agent token…</p>
                        ) : null}
                        {!agentToken && !agentTokenLoading && !agentTokenError ? (
                          <p className="text-xs text-muted-foreground">
                            No agent token found yet. Use &quot;Create token&quot; to generate one.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                {activeNav === 'Customization' && (
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="custom-instructions">Custom instructions</Label>
                      <Textarea
                        id="custom-instructions"
                        placeholder="Example: Always prioritize security fixes, ask for missing context, and avoid pushing changes without tests."
                        rows={8}
                        value={customInstructions}
                        onChange={event => setCustomInstructions(event.target.value)}
                        disabled={customInstructionsLoading}
                      />
                      <p className="text-xs text-muted-foreground">
                        These instructions support Markdown and are inserted at the beginning of
                        every agent prompt whenever someone attaches to a ticket. Use them to share
                        team conventions or priorities.
                      </p>
                      {customInstructionsLoading ? (
                        <p className="text-xs text-muted-foreground">
                          Loading current instructions…
                        </p>
                      ) : null}
                      {customInstructionsLastLoadedAt ? (
                        <p className="text-xs text-muted-foreground">
                          Last refreshed {new Date(customInstructionsLastLoadedAt).toLocaleString()}
                        </p>
                      ) : null}
                      {customInstructionsError ? (
                        <p className="text-sm text-destructive">{customInstructionsError}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">Preview</p>
                      <LoadingButton
                        buttonState={customInstructionsSaveState}
                        setButtonState={setCustomInstructionsSaveState}
                        text="Save instructions"
                        loadingText="Saving..."
                        successText="Saved"
                        errorText="Retry"
                        reset
                        variant="outline"
                        onClick={handleSaveCustomInstructions}
                      />
                    </div>
                    <div className="rounded-md border bg-muted/30 p-3">
                      <MarkdownContent compact>{customInstructionsPreviewText}</MarkdownContent>
                    </div>
                  </div>
                )}

                {activeNav === 'CLI' && (
                  <div className="grid gap-4">
                    <div className="grid gap-1">
                      <p className="text-sm font-medium">Overlord CLI (ovld)</p>
                      <p className="text-xs text-muted-foreground">
                        The CLI lets agents in Claude Code, Codex, Cursor, and Gemini work with
                        Overlord tickets. Available commands:
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="grid gap-1">
                          <p className="text-sm font-medium">Agent token</p>
                          <p className="text-xs text-muted-foreground">
                            Each user has a personal agent token used when Overlord talks to your
                            cloud IDE agents. Rotate it if it is ever exposed.
                          </p>
                        </div>
                        <LoadingButton
                          buttonState={rotateTokenButtonState}
                          setButtonState={setRotateTokenButtonState}
                          text={agentToken ? 'Rotate token' : 'Create token'}
                          loadingText={agentToken ? 'Rotating...' : 'Creating...'}
                          successText={agentToken ? 'Rotated' : 'Created'}
                          errorText="Retry"
                          reset
                          size="sm"
                          variant="outline"
                          onClick={handleRotateAgentToken}
                        />
                      </div>
                      {agentTokenError ? (
                        <p className="text-xs text-destructive">{agentTokenError}</p>
                      ) : null}
                      {agentTokenLoading ? (
                        <p className="text-xs text-muted-foreground">Loading agent token…</p>
                      ) : null}
                      {agentToken && !agentTokenLoading ? (
                        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                          <div className="flex items-center gap-2">
                            <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                              {`PLATFORM_URL=${resolvedPlatformUrl}\nAGENT_TOKEN=${agentToken}`}
                            </pre>
                            <button
                              type="button"
                              onClick={() => void handleCopyAgentEnvSnippet()}
                              className="shrink-0 rounded p-1 hover:bg-muted"
                              title="Copy environment snippet"
                            >
                              {agentEnvSnippetCopied ? (
                                <Check className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Add this snippet to your custom cloud environment in Claude Code or
                            Codex. Also add the domains from the Cloud agents &amp; MCP domain
                            snippet to the allow-list, and we recommend keeping the option checked
                            to also include the default domain list.
                          </p>
                        </div>
                      ) : null}
                      {!agentToken && !agentTokenLoading && !agentTokenError ? (
                        <p className="text-xs text-muted-foreground">
                          No agent token found yet. Use &quot;Create token&quot; to generate one.
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs">
                      <p className="mb-2 font-sans font-medium text-foreground">Top-level</p>
                      <ul className="grid gap-1 text-muted-foreground">
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld attach [ticketId] [agent]
                          </code>{' '}
                          interactive ticket picker + agent launcher
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1">ovld auth</code> login, status,
                          logout
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1">ovld tickets</code> create, list
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1">ovld ticket</code> context
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1">ovld protocol</code> attach,
                          update, ask, read-context, write-context, deliver
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld run &lt;agent&gt;
                          </code>{' '}
                          launch agent (requires TICKET_ID)
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld resume &lt;agent&gt;
                          </code>{' '}
                          resume an agent session
                        </li>
                      </ul>
                      <p className="mt-3 mb-2 font-sans font-medium text-foreground">Examples</p>
                      <ul className="grid gap-1 text-muted-foreground">
                        <li className="break-words">
                          <code className="rounded bg-muted px-1">ovld attach</code> — interactive:
                          search tickets, pick agent
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld attach &lt;ticketId&gt;
                          </code>{' '}
                          — skip search, pick agent
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld attach &lt;ticketId&gt; claude
                          </code>{' '}
                          — fully non-interactive
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld protocol attach --ticket-id &lt;id&gt;
                          </code>
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld protocol update --session-key &lt;key&gt; --summary "..."
                          </code>
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld protocol deliver --session-key &lt;key&gt; --summary "..."
                          </code>
                        </li>
                        <li className="break-words">
                          <code className="rounded bg-muted px-1 break-all">
                            ovld tickets create --objective "..." --execution-target agent
                          </code>
                        </li>
                      </ul>
                      <p className="mt-2 text-muted-foreground">
                        Run{' '}
                        <code className="rounded bg-muted px-1 break-all">
                          ovld &lt;command&gt; --help
                        </code>{' '}
                        for more detail.
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <p className="text-sm font-medium">Agent slash commands</p>
                      <p className="text-xs text-muted-foreground">
                        Install a <code className="rounded bg-muted px-1">/switch-ticket</code>{' '}
                        command so your agent can switch Overlord tickets without leaving its
                        session. Select your agent for setup instructions.
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
                            <p className="mb-1 font-sans text-muted-foreground">
                              {cfg.description}
                            </p>
                            <p className="mb-2 break-all font-sans text-muted-foreground">
                              File: <code className="rounded bg-muted px-1">{cfg.filePath}</code>
                            </p>
                            <pre className="mb-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-foreground">
                              {cfg.fileContent}
                            </pre>
                            <div className="flex items-center gap-2">
                              <p className="shrink-0 font-sans text-muted-foreground">
                                Install command:
                              </p>
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
                              ovld {cliVersion ? `v${cliVersion}` : ''} installed at{' '}
                              {cliInstallPath}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Automatically updated when the desktop app updates.
                            </p>
                            {cliInstallMessage ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {cliInstallMessage}
                              </p>
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
                                  The installed wrapper points to an old app location. Reinstall to
                                  link it to the current version
                                  {cliVersion ? ` (v${cliVersion})` : ''}.
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
                          <Link
                            href="/downloads"
                            className="text-foreground underline underline-offset-4"
                          >
                            desktop app
                          </Link>{' '}
                          to install the CLI with one click. Or run{' '}
                          <code className="rounded bg-muted px-1">npx overlord</code> from the
                          project directory.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {activeNav === 'Appearance' && (
                  <div className="grid gap-6">
                    <div className="grid gap-2">
                      <Label htmlFor="theme-select">Theme</Label>
                      <Select value={theme ?? 'system'} onValueChange={setTheme}>
                        <SelectTrigger id="theme-select">
                          <SelectValue placeholder="Select theme" />
                        </SelectTrigger>
                        <SelectContent>
                          {themeOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        System follows your OS appearance setting.
                      </p>
                    </div>
                  </div>
                )}

                {activeNav === 'Terminal' && isElectron && (
                  <div className="grid gap-6">
                    <div className="grid gap-2">
                      <Label htmlFor="terminal-mode">Where to run terminal commands</Label>
                      <Select value={terminalMode} onValueChange={handleTerminalModeChange}>
                        <SelectTrigger id="terminal-mode">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                        <SelectContent>
                          {terminalModeOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Embedded runs inside the app; External opens your system terminal.
                      </p>
                    </div>
                    {terminalMode === 'external' && (
                      <>
                        <div className="grid gap-2">
                          <Label htmlFor="terminal-app">External terminal application</Label>
                          <Select value={terminalApp} onValueChange={handleTerminalAppChange}>
                            <SelectTrigger id="terminal-app">
                              <SelectValue placeholder="Select terminal" />
                            </SelectTrigger>
                            <SelectContent>
                              {externalTerminalAppOptions.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {terminalApp === 'custom' && (
                            <div className="grid gap-2">
                              <Label htmlFor="custom-terminal-app">
                                Custom terminal name or path
                              </Label>
                              <Input
                                id="custom-terminal-app"
                                placeholder="Example: cmux or /Applications/cmux.app"
                                value={customTerminalApp}
                                onChange={event =>
                                  void handleCustomTerminalAppChange(event.target.value)
                                }
                              />
                              <p className="text-xs text-muted-foreground">
                                Overlord will open this app and type the launch command into the
                                active terminal session.
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="grid gap-2">
                          {supportsLaunchModeSelection && (
                            <>
                              <Label htmlFor="terminal-launch-mode">When opening a terminal</Label>
                              <Select
                                value={terminalLaunchMode}
                                onValueChange={handleTerminalLaunchModeChange}
                              >
                                <SelectTrigger id="terminal-launch-mode">
                                  <SelectValue placeholder="Select behavior" />
                                </SelectTrigger>
                                <SelectContent>
                                  {externalTerminalLaunchModeOptions.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </>
                          )}
                          {supportsLaunchModeSelection && terminalLaunchMode === 'custom' && (
                            <div className="mt-2 grid gap-2">
                              <Label htmlFor="terminal-custom-hotkey">Custom hotkey</Label>
                              <Input
                                id="terminal-custom-hotkey"
                                placeholder="Press the key combination to use (e.g. Cmd + D)"
                                value={terminalCustomHotkey}
                                onKeyDown={handleTerminalCustomHotkeyKeyDown}
                                readOnly
                              />
                              <p className="text-xs text-muted-foreground">
                                Overlord will activate {selectedTerminalLabel}, send this hotkey to
                                trigger your preferred split or focus behavior, then type the launch
                                command.
                              </p>
                            </div>
                          )}
                          {supportsLaunchModeSelection && terminalLaunchMode !== 'custom' && (
                            <p className="text-xs text-muted-foreground">
                              Choose the app and whether launches open in a new window or tab.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeNav === 'Updates' && isElectron && (
                  <div className="grid gap-4">
                    <div className="grid gap-1">
                      <p className="text-sm font-medium">App updates</p>
                      <p className="text-xs text-muted-foreground">
                        Version {updateStatus?.currentVersion ?? 'unknown'}
                        {updateStatus?.availableVersion
                          ? ` • Latest ${updateStatus.availableVersion}`
                          : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">{updateStatusMessage}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <LoadingButton
                        buttonState={checkUpdateButtonState}
                        setButtonState={setCheckUpdateButtonState}
                        text="Check for updates"
                        loadingText="Checking..."
                        successText="Check started"
                        errorText="Try again"
                        reset
                        variant="outline"
                        onClick={handleCheckForUpdates}
                      />
                      {canShowDownloadUpdate && (
                        <LoadingButton
                          buttonState={downloadUpdateButtonState}
                          setButtonState={setDownloadUpdateButtonState}
                          text="Download update"
                          loadingText="Starting download..."
                          successText="Download started"
                          errorText="Unavailable"
                          reset
                          variant="outline"
                          onClick={handleDownloadUpdate}
                        />
                      )}
                      {canShowInstallUpdate && (
                        <LoadingButton
                          buttonState={restartToUpdateButtonState}
                          setButtonState={setRestartToUpdateButtonState}
                          text="Install update"
                          loadingText="Installing..."
                          successText="Installing..."
                          errorText="Unavailable"
                          variant="default"
                          onClick={handleRestartToInstallUpdate}
                        />
                      )}
                    </div>
                    {platformUrl && (
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">PLATFORM_URL: {platformUrl}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </main>
          </SidebarProvider>
        </DialogContent>
      </Dialog>
      <AlertDialog open={installWarningOpen} onOpenChange={setInstallWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Install update now?</AlertDialogTitle>
            <AlertDialogDescription>
              {runningAgentCount === 1
                ? '1 agent is currently running.'
                : `${runningAgentCount} agents are currently running.`}{' '}
              Any currently running agents may become detached from Overlord. Please wait until all
              agents are finished before installing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>I'll wait</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault();
                setInstallWarningOpen(false);
                void restartToInstallUpdate();
              }}
            >
              Continue anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
