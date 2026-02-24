'use client';

import { Bot, Link2, Monitor, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EverhourSettings } from '@/components/features/everhour/EverhourSettings';
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
import {
  getRunningAgentSessionCountAction,
  getRunningAgentSessionsAction,
  type RunningAgentSession,
  stopRunningAgentSessionAction
} from '@/lib/actions/agent-sessions';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';
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
  { value: 'tab', label: 'New tab' }
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
  { name: 'Agents', icon: Bot },
  { name: 'Terminal', icon: Monitor, electronOnly: true },
  { name: 'Updates', icon: RefreshCcw, electronOnly: true }
];

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { isElectron, api } = useElectron();
  const { terminalMode, setTerminalMode } = useTerminal();
  const [terminalApp, setTerminalApp] = useState('default');
  const [terminalLaunchMode, setTerminalLaunchMode] = useState('window');
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

  const visibleNavItems = navItems.filter(item => !item.electronOnly || isElectron);
  const [activeNav, setActiveNav] = useState<string>('Integrations');

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
      api.settings.get<string>('customExternalTerminalApp')
    ]).then(([appValue, launchModeValue, customAppValue]) => {
      if (appValue) setTerminalApp(appValue);
      if (launchModeValue) setTerminalLaunchMode(launchModeValue);
      if (typeof customAppValue === 'string') setCustomTerminalApp(customAppValue);
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

  useEffect(() => {
    if (!open) return;
    setAgentsLoaded(false);
    void loadRunningAgents();
  }, [open]);

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

  const canShowDownloadUpdate = updateStatus?.phase === 'available';
  const canShowInstallUpdate = updateStatus?.phase === 'downloaded';
  const updateStatusMessage =
    updateStatus?.message ?? 'Use Check for updates to look for a newer release.';
  const sessionCountLabel =
    runningAgents.length === 1
      ? '1 running agent session'
      : `${runningAgents.length} running agent sessions`;

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

                {activeNav === 'Agents' && (
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
                          <p className="text-xs text-muted-foreground">
                            Choose the app and whether launches open in a new window or tab.
                          </p>
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
