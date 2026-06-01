'use client';

import { ArrowRight, FolderOpen } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  DEFAULT_AGENT_TRIGGER_STORAGE_KEY,
  readDefaultAgentTriggerFromStorage
} from '@/lib/helpers/agent-trigger';
import { AGENT_SELECTOR_VALUES, type LaunchAgentType } from '@/lib/helpers/agent-types';

import { AgentNameWithLogo } from './cli/AgentNameWithLogo';
import { AgentVisibilitySection } from './cli/AgentVisibilitySection';
import {
  AGENT_PLUGIN_GROUPS,
  AGENT_PLUGIN_OPTIONS,
  BUNDLE_FILE_PATHS,
  CONNECTOR_UPDATE_WARNING_KEY,
  getAgentSelectorLabel,
  SLASH_COMMAND_CONFIGS
} from './cli/cli-page-constants';
import { getBundleActionMeta, getSlashActionMeta } from './cli/cli-page-helpers';
import type {
  AgentPluginInstallOption,
  BundleAgent,
  BundleStatusEntry,
  ServiceStatusEntry,
  SlashAgent,
  SlashStatusEntry
} from './cli/cli-page-types';
import { CustomAgentsSection } from './cli/CustomAgentsSection';
import { DefaultAgentSelector } from './cli/DefaultAgentSelector';

export function CliPage({
  open,
  onNavigate
}: {
  open: boolean;
  onNavigate?: (section: string) => void;
}) {
  const { isElectron, api } = useElectron();

  const [selectedDefaultAgentTrigger, setSelectedDefaultAgentTrigger] =
    useState<LaunchAgentType>('claude');

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
  const [cliInstalledVersion, setCliInstalledVersion] = useState<string | null>(null);
  const [cliLatestVersion, setCliLatestVersion] = useState<string | null>(null);
  const [cliUpdateAvailable, setCliUpdateAvailable] = useState(false);
  const [bundleStatuses, setBundleStatuses] = useState<BundleStatusEntry[]>([]);
  const [serviceStatuses, setServiceStatuses] = useState<ServiceStatusEntry[]>([]);
  const [installAllBundlesButtonState, setInstallAllBundlesButtonState] =
    useState<ButtonLoadingState>('default');

  const [showUpdateWarning, setShowUpdateWarning] = useState(false);
  const [dontShowWarningAgain, setDontShowWarningAgain] = useState(false);
  const [pendingUpdateAction, setPendingUpdateAction] = useState<(() => Promise<void>) | null>(
    null
  );
  const [pendingUpdateWarningTitle, setPendingUpdateWarningTitle] =
    useState('Restart may be required');
  const [pendingUpdateWarningDescription, setPendingUpdateWarningDescription] = useState(
    'Some desktop apps need a refresh before the change is visible. Terminal-only setups do not.'
  );

  function withUpdateWarning(
    title: string,
    description: string,
    action: () => Promise<void>
  ): () => Promise<void> {
    return async () => {
      const dismissed = window.localStorage.getItem(CONNECTOR_UPDATE_WARNING_KEY) === 'true';
      if (dismissed) {
        await action();
        return;
      }
      setDontShowWarningAgain(false);
      setPendingUpdateWarningTitle(title);
      setPendingUpdateWarningDescription(description);
      setPendingUpdateAction(() => action);
      setShowUpdateWarning(true);
    };
  }

  async function handleWarningConfirm() {
    if (dontShowWarningAgain) {
      window.localStorage.setItem(CONNECTOR_UPDATE_WARNING_KEY, 'true');
    }
    setShowUpdateWarning(false);
    if (pendingUpdateAction) {
      await pendingUpdateAction();
      setPendingUpdateAction(null);
    }
  }

  function getUpdateWarningCopy(option: AgentPluginInstallOption): {
    title: string;
    description: string;
  } {
    if (option.agentKey === 'claude') {
      return {
        title: 'Restart Claude Desktop',
        description:
          'If you are using Claude Desktop, restart the app so the updated plugin loads. Terminal sessions do not need a restart.'
      };
    }

    if (option.agentKey === 'codex') {
      return {
        title: 'Refresh the Codex plugin',
        description:
          'In the Codex app, click Remove from Codex and then Add to Codex so the updated plugin loads. Terminal sessions do not need this step.'
      };
    }

    return {
      title: 'Restart may be required',
      description: `If you are using ${option.label} in a desktop app, you may need to restart or refresh it so the update takes effect. Terminal sessions do not need a restart.`
    };
  }

  function handleWarningCancel() {
    setShowUpdateWarning(false);
    setPendingUpdateAction(null);
  }

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
    if (!open || !isElectron || !api?.cli) return;
    void api.cli
      .getInstallStatus()
      .then(
        ({
          installed,
          installPath,
          isStale,
          version,
          installedVersion,
          latestVersion,
          updateAvailable
        }) => {
          setCliInstalled(installed);
          setCliInstallPath(installPath ?? null);
          setCliIsStale(isStale ?? false);
          setCliVersion(version);
          setCliInstalledVersion(installedVersion ?? null);
          setCliLatestVersion(latestVersion ?? null);
          setCliUpdateAvailable(updateAvailable ?? false);
        }
      );
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

  function handleDefaultAgentTriggerChange(value: string) {
    const nextValue = value as LaunchAgentType;
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
    setPluginActionMessage(optionKey, null);
    try {
      const result = await window.electronAPI.agentBundle.install(agent);
      if (!result.ok) {
        throw new Error(result.error ?? 'Install failed');
      }
      await loadBundleStatuses();
      if (agent === 'claude' || agent === 'opencode') {
        await loadSlashStatuses();
      }
      setPluginActionButtonState(optionKey, 'success');
    } catch (error) {
      setPluginActionMessage(optionKey, error instanceof Error ? error.message : 'Install failed');
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
    setPluginActionMessage(optionKey, null);
    try {
      const result = await window.electronAPI.agentBundle.repair(agent);
      if (!result.ok) {
        throw new Error(result.error ?? 'Update failed');
      }
      await loadBundleStatuses();
      if (agent === 'claude' || agent === 'opencode') {
        await loadSlashStatuses();
      }
      setPluginActionButtonState(optionKey, 'success');
    } catch (error) {
      setPluginActionMessage(optionKey, error instanceof Error ? error.message : 'Update failed');
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
        <Accordion type="multiple" className="grid gap-1 last:border-b">
          <AccordionItem value="default-agent" className="rounded-md border last:border-b px-3">
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
              <DefaultAgentSelector />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}

      <div className="rounded-md border px-3 py-3 grid gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Local agent configuration</p>
          <p className="text-xs text-muted-foreground">
            Per-target agent launch flags, pre-commands, and command previews are configured on the
            Execution Targets page.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 w-fit"
          onClick={() => onNavigate?.('Execution Targets')}
        >
          Go to Execution Targets
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <AgentVisibilitySection open={open} />

      <CustomAgentsSection open={open} />

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Agent plugins</p>
          <p className="text-xs text-muted-foreground">
            Install or prepare durable agent plugins where supported, plus mid-session ticket
            commands for agents that can handle{' '}
            <code className="rounded bg-muted px-1">/connect</code>,{' '}
            <code className="rounded bg-muted px-1">/load</code>, and{' '}
            <code className="rounded bg-muted px-1">/spawn</code>.
          </p>
        </div>
        <Accordion type="multiple" className="flex flex-col gap-2 ">
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
                className="rounded-md border bg-muted/30 px-3 last:border-b"
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
                                  {option.supportNote.startsWith('http') ? (
                                    <Link
                                      href={option.supportNote}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline underline-offset-4"
                                    >
                                      Learn more
                                    </Link>
                                  ) : (
                                    option.supportNote
                                  )}
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
                                onClick={() => {
                                  const isRemove = actionMeta.label === 'Remove';
                                  const baseAction = () =>
                                    option.kind === 'bundle'
                                      ? bundleStatus?.status === 'installed'
                                        ? handleUninstallBundle(bundleStatus.agent, option.key)
                                        : bundleStatus?.status === 'partial' ||
                                            bundleStatus?.status === 'error' ||
                                            bundleStatus?.status === 'stale'
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
                                          ? handleInstallSlashCommands(
                                              option.slashAgent,
                                              option.key
                                            )
                                          : handleUninstallSlashCommands(
                                              option.slashAgent,
                                              option.key
                                            );
                                  if (isRemove || option.kind === 'slash') {
                                    void baseAction();
                                    return;
                                  }
                                  const warningCopy = getUpdateWarningCopy(option);
                                  void withUpdateWarning(
                                    warningCopy.title,
                                    warningCopy.description,
                                    baseAction
                                  )();
                                }}
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
            text="Prepare all agent plugins"
            loadingText="Preparing..."
            successText="Prepared"
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
          The CLI lets agents in Claude Code, Codex, Cursor, Antigravity, and OpenCode work with
          Overlord tickets. Available commands:
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <p className="mb-2 font-sans font-medium text-foreground">Top-level</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">ovld attach [ticketId] [agent]</code>{' '}
            interactive ticket picker + agent launcher
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">ovld create &lt;objective&gt;</code>{' '}
            create a ticket after numbered project selection
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">ovld prompt &lt;objective&gt;</code>{' '}
            create a ticket, then pick an agent by number and launch it
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1">ovld auth</code> login, status, logout
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1">ovld tickets</code> create, list
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1">ovld ticket</code> context
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">
              ovld protocol &lt;subcommand&gt;
            </code>{' '}
            attach, connect, load-context, spawn, update, ask, read-context, write-context, deliver,
            attachment-upload-file
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">ovld launch &lt;agent&gt;</code>{' '}
            launch agent on a ticket
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">ovld restart &lt;agent&gt;</code>{' '}
            resume an agent session
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1">ovld context</code> print ticket context
            (requires TICKET_ID)
          </li>
        </ul>
        <p className="mt-3 mb-2 font-sans font-medium text-foreground">Examples</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">
              ovld create &quot;Implement login page&quot;
            </code>{' '}
            — prompts for a numbered project choice, then creates the ticket
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1 break-all">
              ovld prompt &quot;Investigate flaky tests&quot;
            </code>{' '}
            — prompts for numbered project and agent choices, then launches the agent
          </li>
          <li className="wrap-break-word">
            <code className="rounded bg-muted px-1">ovld attach</code> — interactive: search
            tickets, pick agent
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Run <code className="rounded bg-muted px-1 break-all">ovld &lt;command&gt; --help</code>{' '}
          for more detail.
        </p>
      </div>

      <AlertDialog open={showUpdateWarning} onOpenChange={setShowUpdateWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingUpdateWarningTitle}</AlertDialogTitle>
            <AlertDialogDescription>{pendingUpdateWarningDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id="dont-show-warning"
              checked={dontShowWarningAgain}
              onCheckedChange={checked => setDontShowWarningAgain(checked === true)}
            />
            <label htmlFor="dont-show-warning" className="text-sm cursor-pointer">
              Don&apos;t show this again
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleWarningCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleWarningConfirm()}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isElectron && api?.cli ? (
        <>
          {cliInstalled && !cliIsStale ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                ovld{' '}
                {cliInstalledVersion
                  ? `v${cliInstalledVersion}`
                  : cliVersion
                    ? `v${cliVersion}`
                    : ''}{' '}
                installed at {cliInstallPath}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Managed by the desktop app. Reinstall here if the app reports that the wrapper is
                outdated.
              </p>
              {cliUpdateAvailable && cliLatestVersion ? (
                <p className="mt-1 text-xs text-yellow-700 dark:text-yellow-400">
                  New CLI version available: v{cliLatestVersion}. Reinstall the CLI wrapper so the
                  installed `ovld` command points at the latest standalone CLI copy. If you manage
                  the CLI manually outside the desktop app, run `ovld update` to install the newest
                  npm release with Node 20+.
                </p>
              ) : null}
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
