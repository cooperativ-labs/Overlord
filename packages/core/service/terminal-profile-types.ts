export type TerminalLaunchPlacement = 'window' | 'tab' | 'chord';

/**
 * Which process host actually runs the agent.
 *
 * `direct` is today's behavior — the terminal application (or the runner's own
 * stdio) both creates and presents the process. `latch` asks Latch to create the
 * PTY, so the process outlives whatever window is looking at it.
 *
 * This is deliberately **not** an entry in the terminal/launcher list: the
 * provider and the viewer are orthogonal and fail differently (spawn failure is
 * fatal to a launch, viewer failure is cosmetic), so they are stored, resolved,
 * and reported separately.
 */
export type ExecutionProviderKind = 'direct' | 'latch';

export type ExecutionProvider = {
  kind: ExecutionProviderKind;
  /**
   * The Latch CLI to invoke. Retained while `kind` is `direct` so switching the
   * provider off and back on never loses a custom executable path.
   */
  executable: string;
};

/**
 * Normalized identifier for the viewer that *presents* a session, derived from
 * the stored `launcher`. It is a projection, never a second source of truth:
 * `launcher` remains the single stored terminal choice, so toggling the
 * execution provider on and off cannot disturb it.
 */
export type TerminalViewerKind = 'iterm' | 'terminal' | 'inline' | 'custom';

/** Version of the `terminal_profile_json` provider/viewer shape written below. */
export const TERMINAL_PROFILE_VERSION = 1;

export const DEFAULT_LATCH_EXECUTABLE = 'latch';

/** What a profile means when it carries no provider field at all (legacy rows). */
export const DEFAULT_EXECUTION_PROVIDER: ExecutionProvider = {
  kind: 'direct',
  executable: DEFAULT_LATCH_EXECUTABLE
};

export const DEFAULT_OPEN_VIEWER_ON_LAUNCH = true;

/**
 * Per-user terminal launch settings stored on `user_execution_target_preferences`.
 *
 * `launcher`/`placement`/`chord`/`background` are the pre-existing terminal
 * choice and are unchanged. `executionProvider` and `openViewerOnLaunch` are
 * additive and **optional**: absent means "this target has never chosen", which
 * resolves to the user-level default (itself `direct`), so a row written before
 * this field existed keeps behaving exactly as it does today.
 */
export type TerminalProfile = {
  launcher: string | null;
  placement: TerminalLaunchPlacement;
  chord: string | null;
  /**
   * When true, open the terminal without stealing keyboard focus (no AppleScript
   * `activate`; `open -g` for generic launchers). macOS only; ignored for the
   * `chord` placement, which must foreground the app to deliver its keystroke.
   */
  background?: boolean;
  /** Per-target override of the execution provider; absent inherits the user default. */
  executionProvider?: ExecutionProvider;
  /** Per-target override of "open a window on launch"; absent inherits the user default. */
  openViewerOnLaunch?: boolean;
};

export const DEFAULT_TERMINAL_PROFILE: TerminalProfile = {
  launcher: 'Terminal',
  placement: 'window',
  chord: null,
  background: false
};

export const EMPTY_TERMINAL_PROFILE = DEFAULT_TERMINAL_PROFILE;

/** The user-level default new execution targets inherit until they override it. */
export type LaunchSessionDefaults = {
  executionProvider: ExecutionProvider;
  openViewerOnLaunch: boolean;
};

export const DEFAULT_LAUNCH_SESSION_DEFAULTS: LaunchSessionDefaults = {
  executionProvider: { ...DEFAULT_EXECUTION_PROVIDER },
  openViewerOnLaunch: DEFAULT_OPEN_VIEWER_ON_LAUNCH
};

/** Where an effective value came from, so settings can say "your default" honestly. */
export type LaunchSessionSource = 'target' | 'user_default';

/** The effective provider + viewer for one user on one execution target. */
export type ResolvedLaunchSession = {
  version: typeof TERMINAL_PROFILE_VERSION;
  executionProvider: ExecutionProvider;
  viewer: {
    kind: TerminalViewerKind;
    /** The stored terminal choice itself, so callers never re-derive it. */
    launcher: string | null;
    openOnLaunch: boolean;
  };
  executionProviderSource: LaunchSessionSource;
  viewerOpenSource: LaunchSessionSource;
};

/**
 * The resolved session frozen onto an execution request when a runner claims it,
 * so a later settings change can never retroactively change what a run did.
 */
export type LaunchSessionSnapshot = ResolvedLaunchSession & {
  /** ISO timestamp of the claim that resolved this snapshot. */
  resolvedAt: string;
};

/** Key under `execution_requests.metadata_json` holding {@link LaunchSessionSnapshot}. */
export const LAUNCH_SESSION_METADATA_KEY = 'launchSession';

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Derive the viewer identifier for a stored launcher. Never stored on its own. */
export function viewerKindForLauncher(launcher: string | null | undefined): TerminalViewerKind {
  const value = trimmed(launcher);
  if (!value) return 'inline';
  const lowered = value.toLowerCase();
  if (lowered === 'iterm2' || lowered === 'iterm') return 'iterm';
  if (lowered === 'terminal') return 'terminal';
  return 'custom';
}

/**
 * Inverse of {@link viewerKindForLauncher} for the two built-in viewers, used
 * only when a document carries the versioned viewer block and no `launcher` —
 * i.e. was written by something that only knows the design-reference shape.
 * `custom` yields `undefined` because the launcher string is unrecoverable.
 */
export function launcherForViewerKind(kind: unknown): string | null | undefined {
  switch (trimmed(kind)?.toLowerCase()) {
    case 'iterm':
    case 'iterm2':
      return 'iTerm2';
    case 'terminal':
      return 'Terminal';
    case 'inline':
    case 'none':
      return null;
    default:
      return undefined;
  }
}

export function normalizeExecutionProvider(value: unknown): ExecutionProvider | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cast = value as { kind?: unknown; executable?: unknown };
  // An unrecognized provider degrades to direct rather than failing the launch:
  // direct execution must stay available in every state.
  const kind: ExecutionProviderKind =
    trimmed(cast.kind)?.toLowerCase() === 'latch' ? 'latch' : 'direct';
  return {
    kind,
    executable: trimmed(cast.executable) ?? DEFAULT_LATCH_EXECUTABLE
  };
}

export function parseTerminalProfileJson(json: string | null | undefined): TerminalProfile {
  if (!json?.trim()) return { ...DEFAULT_TERMINAL_PROFILE };
  try {
    const parsed = JSON.parse(json) as {
      launcher?: unknown;
      placement?: unknown;
      chord?: unknown;
      background?: unknown;
      executionProvider?: unknown;
      viewer?: unknown;
    };
    const hasLauncher = Object.prototype.hasOwnProperty.call(parsed, 'launcher');
    const placementRaw =
      typeof parsed.placement === 'string'
        ? parsed.placement.trim()
        : DEFAULT_TERMINAL_PROFILE.placement;
    const placement: TerminalLaunchPlacement =
      placementRaw === 'tab' ? 'tab' : placementRaw === 'chord' ? 'chord' : 'window';

    const viewer =
      parsed.viewer && typeof parsed.viewer === 'object' && !Array.isArray(parsed.viewer)
        ? (parsed.viewer as { kind?: unknown; openOnLaunch?: unknown })
        : null;
    // `launcher` is authoritative; `viewer.kind` is a derived projection that is
    // only consulted for a document that carries no launcher at all.
    const viewerLauncher = hasLauncher ? undefined : launcherForViewerKind(viewer?.kind);

    const profile: TerminalProfile = {
      launcher:
        typeof parsed.launcher === 'string' && parsed.launcher.trim()
          ? parsed.launcher.trim()
          : hasLauncher
            ? null
            : viewerLauncher !== undefined
              ? viewerLauncher
              : DEFAULT_TERMINAL_PROFILE.launcher,
      placement,
      chord: typeof parsed.chord === 'string' && parsed.chord.trim() ? parsed.chord.trim() : null,
      background: parsed.background === true
    };

    const provider = normalizeExecutionProvider(parsed.executionProvider);
    if (provider) profile.executionProvider = provider;
    if (typeof viewer?.openOnLaunch === 'boolean') profile.openViewerOnLaunch = viewer.openOnLaunch;

    return profile;
  } catch {
    return { ...DEFAULT_TERMINAL_PROFILE };
  }
}

/**
 * Serialize a profile back to `terminal_profile_json`.
 *
 * The versioned block is written only when the profile actually carries a
 * provider or viewer choice, so a target that never opts in keeps a byte-identical
 * legacy document and no stored row is rewritten into a shape it did not ask for.
 */
export function serializeTerminalProfile(profile: TerminalProfile): string {
  const document: Record<string, unknown> = {
    launcher: profile.launcher,
    placement: profile.placement,
    chord: profile.placement === 'chord' ? profile.chord : null,
    background: profile.background === true
  };

  const provider = profile.executionProvider
    ? normalizeExecutionProvider(profile.executionProvider)
    : null;
  const openOnLaunch =
    typeof profile.openViewerOnLaunch === 'boolean' ? profile.openViewerOnLaunch : undefined;

  if (provider || openOnLaunch !== undefined) {
    document.version = TERMINAL_PROFILE_VERSION;
    if (provider) document.executionProvider = provider;
    document.viewer = {
      kind: viewerKindForLauncher(profile.launcher),
      ...(openOnLaunch === undefined ? {} : { openOnLaunch })
    };
  }

  return JSON.stringify(document);
}

/** Parse the user-level default from its stored (profile-metadata) representation. */
export function parseLaunchSessionDefaults(value: unknown): LaunchSessionDefaults {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      executionProvider: { ...DEFAULT_EXECUTION_PROVIDER },
      openViewerOnLaunch: DEFAULT_OPEN_VIEWER_ON_LAUNCH
    };
  }
  const cast = value as { executionProvider?: unknown; viewer?: unknown };
  const viewer =
    cast.viewer && typeof cast.viewer === 'object' && !Array.isArray(cast.viewer)
      ? (cast.viewer as { openOnLaunch?: unknown })
      : null;
  return {
    executionProvider: normalizeExecutionProvider(cast.executionProvider) ?? {
      ...DEFAULT_EXECUTION_PROVIDER
    },
    openViewerOnLaunch:
      typeof viewer?.openOnLaunch === 'boolean'
        ? viewer.openOnLaunch
        : DEFAULT_OPEN_VIEWER_ON_LAUNCH
  };
}

/** Stored representation of the user-level default; same versioned shape, no launcher. */
export function serializeLaunchSessionDefaults(
  defaults: LaunchSessionDefaults
): Record<string, unknown> {
  return {
    version: TERMINAL_PROFILE_VERSION,
    executionProvider: normalizeExecutionProvider(defaults.executionProvider) ?? {
      ...DEFAULT_EXECUTION_PROVIDER
    },
    viewer: { openOnLaunch: defaults.openViewerOnLaunch !== false }
  };
}

/**
 * Resolve the effective provider and viewer for one target: an explicit per-target
 * value wins, otherwise the user-level default applies. A legacy row carries
 * neither field, and the default is itself `direct`, so nothing changes for
 * existing users until they deliberately opt in.
 */
export function resolveLaunchSession({
  profile,
  defaults = DEFAULT_LAUNCH_SESSION_DEFAULTS
}: {
  profile: TerminalProfile | null | undefined;
  defaults?: LaunchSessionDefaults;
}): ResolvedLaunchSession {
  const launcher = profile ? profile.launcher : DEFAULT_TERMINAL_PROFILE.launcher;
  const provider = profile?.executionProvider
    ? normalizeExecutionProvider(profile.executionProvider)
    : null;
  const openOnLaunch =
    typeof profile?.openViewerOnLaunch === 'boolean' ? profile.openViewerOnLaunch : null;

  return {
    version: TERMINAL_PROFILE_VERSION,
    executionProvider: provider ?? {
      ...(normalizeExecutionProvider(defaults.executionProvider) ?? DEFAULT_EXECUTION_PROVIDER)
    },
    viewer: {
      kind: viewerKindForLauncher(launcher),
      launcher: launcher ?? null,
      openOnLaunch: openOnLaunch ?? defaults.openViewerOnLaunch !== false
    },
    executionProviderSource: provider ? 'target' : 'user_default',
    viewerOpenSource: openOnLaunch === null ? 'user_default' : 'target'
  };
}

/** Freeze a resolved session for storage on an execution request. */
export function toLaunchSessionSnapshot(
  session: ResolvedLaunchSession,
  resolvedAt: string
): LaunchSessionSnapshot {
  return { ...session, resolvedAt };
}

/**
 * Read the snapshot a claim froze onto `execution_requests.metadata_json`.
 * Returns `null` for a request claimed before snapshots existed, which callers
 * must treat as "resolve normally", never as an error.
 */
export function launchSessionSnapshotFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): LaunchSessionSnapshot | null {
  const raw = metadata?.[LAUNCH_SESSION_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cast = raw as {
    version?: unknown;
    executionProvider?: unknown;
    viewer?: unknown;
    executionProviderSource?: unknown;
    viewerOpenSource?: unknown;
    resolvedAt?: unknown;
  };
  if (cast.version !== TERMINAL_PROFILE_VERSION) return null;
  const viewer =
    cast.viewer && typeof cast.viewer === 'object' && !Array.isArray(cast.viewer)
      ? (cast.viewer as { kind?: unknown; launcher?: unknown; openOnLaunch?: unknown })
      : null;
  const launcher = trimmed(viewer?.launcher);
  const source = (value: unknown): LaunchSessionSource =>
    trimmed(value) === 'target' ? 'target' : 'user_default';

  return {
    version: TERMINAL_PROFILE_VERSION,
    executionProvider: normalizeExecutionProvider(cast.executionProvider) ?? {
      ...DEFAULT_EXECUTION_PROVIDER
    },
    viewer: {
      kind: trimmed(viewer?.kind)
        ? (trimmed(viewer?.kind) as TerminalViewerKind)
        : viewerKindForLauncher(launcher),
      launcher,
      openOnLaunch: viewer?.openOnLaunch !== false
    },
    executionProviderSource: source(cast.executionProviderSource),
    viewerOpenSource: source(cast.viewerOpenSource),
    resolvedAt: trimmed(cast.resolvedAt) ?? ''
  };
}
