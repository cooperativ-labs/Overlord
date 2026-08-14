import { useEffect, useRef, useState } from 'react';

import { AgentLaunchFooter } from '@/components/objectives/AgentLaunchFooter';
import { HotkeyCaptureButton } from '@/components/settings/HotkeyCaptureButton';
import { LatchDiscoveryStatus } from '@/components/settings/LatchDiscoveryStatus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { acceleratorToTerminalChord, terminalChordToAccelerator } from '@/lib/accelerator';
import {
  DEFAULT_EDITOR_SCHEME,
  EDITOR_SCHEME_OPTIONS,
  getEditorSchemeLabel
} from '@/lib/helpers/editor-scheme';
import { useLatchDiscovery, useRecheckLatchDiscovery } from '@/lib/latch-discovery-client';
import {
  effectiveOpenViewer as resolveOpenViewer,
  effectiveProviderKind as resolveProviderKind,
  latchBlockedReason as resolveLatchBlockedReason,
  type ProviderChoice,
  providerChoiceFromProfile,
  sessionOverrideFields
} from '@/lib/launch-session-form';
import {
  useAgentCatalog,
  useLaunchSettings,
  useProfile,
  useRefreshAgentCatalog,
  useUpdateAgentLaunchConfig,
  useUpdateLaunchSessionDefaults,
  useUpdateProfile,
  useUpdateTerminalProfile
} from '@/lib/queries';

import {
  type AgentLaunchConfigDto,
  agentLaunchFlagKey,
  type TerminalProfileDto
} from '../../../shared/contract.ts';

type IdePageProps = {
  open: boolean;
};

const INLINE_LAUNCHER = '__inline__';
const CUSTOM_LAUNCHER = '__custom__';
/**
 * coo:702: selecting this leaves the stored terminal choice untouched and only
 * turns off viewer-open-on-launch, so toggling a window back on is lossless.
 * Latch itself is deliberately *not* in the terminal list — the provider and the
 * viewer are orthogonal and fail differently.
 */
const NO_VIEWER = '__no_viewer__';

const TERMINAL_OPTIONS = [
  { label: 'Terminal', launcher: 'Terminal' },
  { label: 'iTerm2', launcher: 'iTerm2' },
  { label: 'Ghostty', launcher: "open -a 'Ghostty' --args" },
  { label: 'Warp', launcher: "open -a 'Warp' --args" },
  { label: 'WezTerm', launcher: "open -a 'WezTerm' --args" },
  { label: 'Alacritty', launcher: "open -a 'Alacritty' --args" },
  { label: 'Kitty', launcher: "open -a 'kitty' --args" },
  { label: 'Inline in this terminal', launcher: INLINE_LAUNCHER },
  { label: 'Custom launcher command', launcher: CUSTOM_LAUNCHER }
] as const;

function getTerminalLauncherLabel(launcher: string) {
  const preset = TERMINAL_OPTIONS.find(option => option.launcher === launcher);
  return preset ? preset.label : launcher;
}

function profileToDraft(profile: TerminalProfileDto) {
  const preset = TERMINAL_OPTIONS.find(option => option.launcher === profile.launcher);
  return {
    launcherChoice: profile.launcher
      ? preset
        ? profile.launcher
        : CUSTOM_LAUNCHER
      : INLINE_LAUNCHER,
    customLauncher: profile.launcher && !preset ? profile.launcher : '',
    placement: profile.placement,
    chord: profile.chord ?? '',
    background: profile.background
  };
}

function normalizeProfile({
  launcherChoice,
  customLauncher,
  placement,
  chord,
  background,
  providerChoice,
  latchExecutable,
  openViewerOverride
}: {
  launcherChoice: string;
  customLauncher: string;
  placement: TerminalProfileDto['placement'];
  chord: string;
  background: boolean;
  providerChoice: ProviderChoice;
  latchExecutable: string;
  openViewerOverride: boolean | null;
}): TerminalProfileDto {
  const launcher =
    launcherChoice === INLINE_LAUNCHER
      ? null
      : launcherChoice === CUSTOM_LAUNCHER
        ? customLauncher.trim() || null
        : launcherChoice;
  const resolvedPlacement = launcher ? placement : 'window';
  return {
    launcher,
    placement: resolvedPlacement,
    chord: launcher && placement === 'chord' ? chord.trim() || null : null,
    // The `chord` placement must foreground the app to deliver its keystroke, so
    // background mode only applies to window/tab launches.
    background: Boolean(launcher) && resolvedPlacement !== 'chord' && background,
    ...sessionOverrideFields({ providerChoice, latchExecutable, openViewerOverride })
  };
}

const NO_EXECUTION_TARGET_HINT =
  'These settings are stored per execution target, and this client has none. Declare the machine ' +
  'that runs agents first — link a project directory from it, or run `ovld add-et --name "<name>"` there.';

export function IdePage({ open }: IdePageProps) {
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const catalog = useAgentCatalog();
  const launchSettings = useLaunchSettings();
  const refreshCatalog = useRefreshAgentCatalog();
  const updateAgentLaunchConfig = useUpdateAgentLaunchConfig();
  const updateTerminalProfile = useUpdateTerminalProfile();
  const updateSessionDefaults = useUpdateLaunchSessionDefaults();
  // Discovery runs on the execution target through the local-target boundary,
  // never in the browser: only the device that would host the process can
  // answer whether Latch works there.
  const latchExecutableForProbe =
    launchSettings.data?.terminalProfile.executionProvider?.executable ??
    launchSettings.data?.launchSessionDefaults.executionProvider.executable ??
    'latch';
  const latchDiscovery = useLatchDiscovery({
    executionTargetId: launchSettings.data?.executionTargetId ?? null,
    executable: latchExecutableForProbe,
    enabled: Boolean(launchSettings.data)
  });
  const recheckLatch = useRecheckLatchDiscovery({
    executionTargetId: launchSettings.data?.executionTargetId ?? null,
    executable: latchExecutableForProbe
  });

  const [editorScheme, setEditorScheme] = useState(DEFAULT_EDITOR_SCHEME);
  const [schemeError, setSchemeError] = useState<string | null>(null);

  const [launcherChoice, setLauncherChoice] = useState<string>('Terminal');
  const [customLauncher, setCustomLauncher] = useState('');
  const [placement, setPlacement] = useState<TerminalProfileDto['placement']>('window');
  const [chord, setChord] = useState('');
  const [background, setBackground] = useState(false);
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('inherit');
  const [openViewerOverride, setOpenViewerOverride] = useState<boolean | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  // coo:719: the terminal profile has no save button — it persists on change.
  const [terminalSaving, setTerminalSaving] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  useEffect(() => {
    setEditorScheme(profile.data?.editorScheme ?? DEFAULT_EDITOR_SCHEME);
  }, [profile.data?.editorScheme]);

  useEffect(() => {
    const activeProfile = launchSettings.data?.terminalProfile;
    if (!activeProfile) return;
    const next = profileToDraft(activeProfile);
    setLauncherChoice(next.launcherChoice);
    setCustomLauncher(next.customLauncher);
    setPlacement(next.placement);
    setChord(next.chord);
    setBackground(next.background);
    setProviderChoice(providerChoiceFromProfile(activeProfile));
    setOpenViewerOverride(activeProfile.openViewerOnLaunch ?? null);
  }, [launchSettings.data?.terminalProfile]);

  const savedProfile = launchSettings.data?.terminalProfile ?? null;
  const sessionDefaults = launchSettings.data?.launchSessionDefaults ?? null;
  // The provider `executable` is never typed by the user — it exists so a future
  // custom path stays lossless across toggles, so carry the stored value forward.
  const latchExecutable =
    savedProfile?.executionProvider?.executable ??
    sessionDefaults?.executionProvider.executable ??
    'latch';
  const draftProfile = normalizeProfile({
    launcherChoice,
    customLauncher,
    placement,
    chord,
    background,
    providerChoice,
    latchExecutable,
    openViewerOverride
  });
  const savedProviderChoice = savedProfile ? providerChoiceFromProfile(savedProfile) : 'inherit';
  const savedOpenViewerOverride = savedProfile?.openViewerOnLaunch ?? null;
  const terminalIsDirty =
    savedProfile !== null &&
    (savedProfile.launcher !== draftProfile.launcher ||
      savedProfile.placement !== draftProfile.placement ||
      savedProfile.chord !== draftProfile.chord ||
      savedProfile.background !== draftProfile.background ||
      savedProviderChoice !== providerChoice ||
      savedOpenViewerOverride !== openViewerOverride);
  const requiresCustomLauncher =
    launcherChoice === CUSTOM_LAUNCHER && draftProfile.launcher === null;
  // Contract v39: launch settings are stored per execution target, and configuring
  // them is not an onboarding act. Without a declared target there is nothing to
  // store them against, so say that instead of offering controls that 409.
  const hasExecutionTarget = Boolean(launchSettings.data?.executionTargetId);

  // coo:719: autosave the terminal profile instead of making the user find a save
  // button. Everything here is a select/switch except the custom launcher field,
  // so a short debounce keeps typing from firing a write per keystroke. The ref
  // holds the latest draft and mutation so the timer effect only re-arms when the
  // draft's *content* changes, not on every render.
  const terminalDraftKey = JSON.stringify(draftProfile);
  const terminalAutosaveReady = hasExecutionTarget && terminalIsDirty && !requiresCustomLauncher;
  const latestTerminalSave = useRef({ draftProfile, updateTerminalProfile });
  useEffect(() => {
    latestTerminalSave.current = { draftProfile, updateTerminalProfile };
  });

  useEffect(() => {
    if (!terminalAutosaveReady) return;
    const timer = setTimeout(() => {
      const { draftProfile: pending, updateTerminalProfile: mutation } = latestTerminalSave.current;
      setTerminalSaving(true);
      setTerminalError(null);
      mutation
        .mutateAsync(pending)
        .catch((error: unknown) => {
          setTerminalError(
            error instanceof Error ? error.message : 'Failed to save the terminal profile.'
          );
        })
        .finally(() => setTerminalSaving(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [terminalAutosaveReady, terminalDraftKey]);

  if (!open) return null;

  if (profile.isLoading && !profile.data) {
    return <p className="text-sm text-muted-foreground">Loading terminal &amp; IDE settings…</p>;
  }

  if (profile.isError || !profile.data) {
    return (
      <p className="text-sm text-destructive">
        {(profile.error as Error | undefined)?.message ??
          'Terminal &amp; IDE settings are unavailable right now.'}
      </p>
    );
  }

  const defaultProviderKind = sessionDefaults?.executionProvider.kind ?? 'direct';
  const effectiveProviderKind = resolveProviderKind({
    providerChoice,
    defaults: sessionDefaults
  });
  const persistent = effectiveProviderKind === 'latch';
  const effectiveOpenViewer = resolveOpenViewer({
    openViewerOverride,
    defaults: sessionDefaults
  });
  const discovery = latchDiscovery.data;
  const latchBlockedReason = resolveLatchBlockedReason(discovery);
  const agents = [...(catalog.data?.agents ?? [])].sort((a, b) => a.label.localeCompare(b.label));

  // coo:719: the IDE preference is a single select, so it saves on change; the
  // optimistic local value keeps the control responsive while the write lands.
  async function handleSchemeChange(value: string) {
    const next = value || DEFAULT_EDITOR_SCHEME;
    setEditorScheme(next);
    setSchemeError(null);
    try {
      await updateProfile.mutateAsync({ editorScheme: next });
    } catch (err) {
      setEditorScheme(profile.data?.editorScheme ?? DEFAULT_EDITOR_SCHEME);
      setSchemeError(err instanceof Error ? err.message : 'Failed to save your IDE preference.');
    }
  }

  async function handleSaveSessionDefault(kind: 'direct' | 'latch') {
    setDefaultsError(null);
    try {
      await updateSessionDefaults.mutateAsync({
        executionProvider: { kind, executable: latchExecutable }
      });
    } catch (error) {
      setDefaultsError(
        error instanceof Error ? error.message : 'Failed to save your session default.'
      );
    }
  }

  async function commitAgentConfig(agentKey: string, config: AgentLaunchConfigDto) {
    setAgentError(null);
    try {
      await updateAgentLaunchConfig.mutateAsync({ agentKey, body: config });
    } catch (error) {
      setAgentError(
        error instanceof Error ? error.message : 'Failed to save the agent launch defaults.'
      );
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-base font-medium">Terminal &amp; IDE</h2>
        <p className="text-sm text-muted-foreground">
          Per-user launch and editor defaults for this machine. These preferences are shared with
          the CLI and runner for the local execution target.
        </p>
      </div>

      {launchSettings.data ? (
        <div className="rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Local execution target</h3>
              <p className="text-sm text-muted-foreground">
                Launches queue against this device unless an objective overrides the target.
              </p>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
              local
            </span>
          </div>
          {launchSettings.data.executionTargetId ? (
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-muted-foreground">Device label</dt>
                <dd className="font-medium">{launchSettings.data.deviceLabel}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted-foreground">Execution target ID</dt>
                <dd className="break-all font-mono text-xs">
                  {launchSettings.data.executionTargetId}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              This client has no execution target. Execution targets are declared from the machine
              that runs agents — link a project directory there, or run{' '}
              <code className="font-mono text-xs">ovld add-et --name &quot;&lt;name&gt;&quot;</code>{' '}
              on it.
            </p>
          )}
        </div>
      ) : null}

      <div className="max-w-xl space-y-2">
        <Label htmlFor="editor-scheme-select">Preferred IDE</Label>
        <Select
          value={editorScheme}
          onValueChange={value => void handleSchemeChange(value ?? DEFAULT_EDITOR_SCHEME)}
        >
          <SelectTrigger id="editor-scheme-select">
            <SelectValue placeholder="Select an IDE">
              {getEditorSchemeLabel(editorScheme)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EDITOR_SCHEME_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          File links will open in {getEditorSchemeLabel(editorScheme)}. Saved as soon as you change
          it.
        </p>
        {schemeError ? <p className="text-sm text-destructive">{schemeError}</p> : null}
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Terminal sessions</h3>
          <p className="text-sm text-muted-foreground">
            Choose how agent runs open on this machine.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="execution-target-session">Session</Label>
          <Select
            value={effectiveProviderKind}
            onValueChange={value =>
              setProviderChoice((value as 'direct' | 'latch' | null) ?? 'direct')
            }
          >
            <SelectTrigger id="execution-target-session">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">Direct — the window runs the agent</SelectItem>
              <SelectItem value="latch" disabled={latchBlockedReason !== null}>
                Persistent — Latch hosts the agent, the window just shows it
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs text-muted-foreground">
              {providerChoice === 'inherit'
                ? `Following your default (${defaultProviderKind === 'latch' ? 'Persistent' : 'Direct'}).`
                : `This machine overrides your default (${defaultProviderKind === 'latch' ? 'Persistent' : 'Direct'}).`}
            </p>
            {providerChoice === 'inherit' ? null : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setProviderChoice('inherit')}
              >
                Use my default
              </Button>
            )}
          </div>
          {latchBlockedReason ? (
            <p className="text-xs text-muted-foreground">
              {latchBlockedReason} Direct execution stays available.
            </p>
          ) : null}
          <LatchDiscoveryStatus
            discovery={discovery}
            isLoading={latchDiscovery.isLoading}
            deviceLabel={launchSettings.data?.deviceLabel ?? null}
            onRecheck={() => void recheckLatch.mutateAsync().catch(() => undefined)}
            recheckPending={recheckLatch.isPending}
          />
          {persistent && savedProfile?.executionProvider?.kind === 'latch' && latchBlockedReason ? (
            <p className="text-xs text-destructive">
              This machine is set to persistent sessions but Latch is unusable here, so runs launch
              directly until that is fixed.
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="execution-target-launcher">
              {persistent ? 'Show it in' : 'Open in'}
            </Label>
            <Select
              value={persistent && !effectiveOpenViewer ? NO_VIEWER : launcherChoice}
              onValueChange={value => {
                if (value === NO_VIEWER) {
                  setOpenViewerOverride(false);
                  return;
                }
                setLauncherChoice(value ?? INLINE_LAUNCHER);
                // Picking a terminal implies wanting a window; the stored
                // launcher itself is never touched by the provider toggle.
                if (!effectiveOpenViewer) setOpenViewerOverride(true);
              }}
            >
              <SelectTrigger id="execution-target-launcher">
                <SelectValue>
                  {persistent && !effectiveOpenViewer
                    ? "Don't open a window automatically"
                    : getTerminalLauncherLabel(launcherChoice)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TERMINAL_OPTIONS.map(option => (
                  <SelectItem key={option.launcher} value={option.launcher}>
                    {option.label}
                  </SelectItem>
                ))}
                {persistent ? (
                  <SelectItem value={NO_VIEWER}>Don&apos;t open a window automatically</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {persistent
                ? 'Shows the session that Latch is already hosting. Closing the window leaves the agent running.'
                : 'Launches the agent in this terminal.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="execution-target-placement">Placement</Label>
            <Select
              value={placement}
              disabled={draftProfile.launcher === null}
              onValueChange={value =>
                setPlacement((value as TerminalProfileDto['placement'] | null) ?? 'window')
              }
            >
              <SelectTrigger id="execution-target-placement">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="window">New window</SelectItem>
                <SelectItem value="tab">New tab</SelectItem>
                <SelectItem value="chord">Keyboard shortcut</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {launcherChoice === CUSTOM_LAUNCHER ? (
          <div className="space-y-2">
            <Label htmlFor="execution-target-custom-launcher">Custom launcher command</Label>
            <Input
              id="execution-target-custom-launcher"
              value={customLauncher}
              onChange={event => setCustomLauncher(event.target.value)}
              placeholder="open -a 'Ghostty' --args"
            />
            <p className="text-xs text-muted-foreground">
              Use the same prefix you would pass to `ovld --terminal`.
            </p>
          </div>
        ) : null}

        {draftProfile.launcher !== null && placement === 'chord' ? (
          <div className="space-y-2">
            <Label>Shortcut</Label>
            <div className="flex flex-wrap items-center gap-2">
              <HotkeyCaptureButton
                value={chord ? terminalChordToAccelerator(chord) : ''}
                onCapture={accel => setChord(acceleratorToTerminalChord(accel))}
                placeholder="Press to set"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Click the button and press the shortcut your terminal uses to split or open a new
              pane, for example ⌘ D in iTerm2.
            </p>
          </div>
        ) : null}

        {draftProfile.launcher !== null && placement !== 'chord' ? (
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="execution-target-background">Open in the background</Label>
              <p className="text-xs text-muted-foreground">
                Launch the terminal without stealing keyboard focus (macOS). Not available for
                keyboard-shortcut placement, which must foreground the terminal to send its
                shortcut.
              </p>
            </div>
            <Switch
              id="execution-target-background"
              checked={background}
              onCheckedChange={next => setBackground(Boolean(next))}
            />
          </div>
        ) : null}

        <div className="space-y-2 rounded-md border border-dashed p-3">
          <Label htmlFor="launch-session-default">Default for new machines</Label>
          <Select
            value={defaultProviderKind}
            onValueChange={value => void handleSaveSessionDefault(value as 'direct' | 'latch')}
          >
            <SelectTrigger id="launch-session-default" className="max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">Direct</SelectItem>
              <SelectItem value="latch">Persistent (Latch)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Applies to every execution target that has not set its own Session above. Saved as soon
            as you change it.
          </p>
          {defaultsError ? <p className="text-xs text-destructive">{defaultsError}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {!hasExecutionTarget
              ? NO_EXECUTION_TARGET_HINT
              : requiresCustomLauncher
                ? 'Enter a launcher command or choose one of the built-in terminals — nothing is saved until you do.'
                : terminalSaving
                  ? 'Saving…'
                  : draftProfile.launcher === null
                    ? 'Saved automatically. No launcher configured: runs stay inline in the current terminal.'
                    : 'Saved automatically. Changes apply to future launches from the web app and CLI.'}
          </p>
        </div>
        {terminalError ? <p className="text-sm text-destructive">{terminalError}</p> : null}
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Agent launch defaults</h3>
            <p className="text-sm text-muted-foreground">
              Store per-agent pre-commands and extra CLI flags for this machine.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshCatalog.mutateAsync()}
            disabled={refreshCatalog.isPending}
          >
            {refreshCatalog.isPending ? 'Refreshing…' : 'Refresh catalog'}
          </Button>
        </div>

        {catalog.isLoading && !catalog.data ? (
          <p className="text-sm text-muted-foreground">Loading agent catalog…</p>
        ) : null}
        {catalog.isError ? (
          <p className="text-sm text-destructive">
            {(catalog.error as Error | undefined)?.message ?? 'Failed to load the agent catalog.'}
          </p>
        ) : null}
        {agentError ? <p className="text-sm text-destructive">{agentError}</p> : null}

        {!hasExecutionTarget ? (
          <p className="text-sm text-muted-foreground">{NO_EXECUTION_TARGET_HINT}</p>
        ) : null}

        {(hasExecutionTarget ? agents : []).map((agent, index) => {
          const config = launchSettings.data?.agentConfigs[agent.key] ?? {
            preCommand: '',
            flags: []
          };
          return (
            <div key={agent.key} className="space-y-3">
              {index > 0 ? <Separator /> : null}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-medium">{agent.label}</h4>
                  {!agent.availableByDefault ? (
                    <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      hidden by workspace default
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {agent.defaultModel ? `Default model: ${agent.defaultModel}. ` : ''}
                  These values are used when this agent is launched on this machine.
                </p>
              </div>
              <AgentLaunchFooter
                key={`${agent.key}:${config.preCommand}:${config.flags.map(agentLaunchFlagKey).join('\u0000')}`}
                agentKey={agent.key}
                preCommand={config.preCommand}
                flags={config.flags}
                onCommit={next => void commitAgentConfig(agent.key, next)}
                sourceHint="Saved to your per-target launch preferences."
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
