import type { BackendClient } from './backend-client.js';

/**
 * Launch settings (terminal profile, per-agent pre-command/flags, worktree
 * automation) are **workspace-scoped** on the backend.
 *
 * `GET /api/launch-settings` without a workspace only works for the legacy
 * loopback-trusted local operator: any USER_TOKEN- or session-authenticated
 * caller establishes an authorization *set* rather than an ambient workspace, so
 * the unscoped route answers `400 workspaceId is required`. Every `ovld` call
 * against a cloud backend authenticates with a USER_TOKEN, which made the CLI's
 * terminal profile, execution-target preference, and worktree-automation reads
 * fail — silently, because each call site swallowed the error and fell back to
 * "no terminal launcher" / "automation off". That is why `ovld runner start` and
 * the persistent runner service ignored Settings → Terminal & IDE and launched
 * agents inline instead of in a new window/tab.
 *
 * These helpers always address the workspace-scoped route. The workspace is the
 * caller's when known (the claimed request's, or the mission's), otherwise the
 * caller's active workspace resolved once per process.
 */
export function launchSettingsPath(workspaceId: string | null | undefined, suffix = ''): string {
  const id = workspaceId?.trim();
  return id
    ? `/api/workspaces/${encodeURIComponent(id)}/launch-settings${suffix}`
    : `/api/launch-settings${suffix}`;
}

type WorkspaceSummary = { id?: unknown; isActive?: unknown };

/**
 * Resolved once per process: repeated launch/claim cycles must not re-list
 * workspaces on every poll. `null` marks a resolution that failed, so the caller
 * falls back to the unscoped route rather than retrying in a tight loop.
 */
// A long-lived runner can be repointed at another backend by its service
// environment.  Cache per client/backend, rather than globally, so an active
// workspace learned from one account can never leak into requests for another.
let cachedWorkspaceIds = new WeakMap<BackendClient, string | null>();

/** Reset the memoized workspace (tests only). */
export function resetLaunchSettingsWorkspaceCache(): void {
  cachedWorkspaceIds = new WeakMap<BackendClient, string | null>();
}

/**
 * The workspace a launch-settings call should address: the caller-supplied one
 * when known, otherwise the acting user's active workspace (falling back to a
 * sole membership). Never throws — an unresolvable workspace yields `null` and
 * the unscoped route is used, preserving loopback/self-hosted behavior.
 */
export async function resolveLaunchSettingsWorkspaceId({
  backend,
  workspaceId
}: {
  backend: BackendClient;
  workspaceId?: string | null;
}): Promise<string | null> {
  const explicit = workspaceId?.trim();
  if (explicit) return explicit;
  const cached = cachedWorkspaceIds.get(backend);
  if (cached !== undefined) return cached;

  let resolved: string | null = null;
  try {
    const workspaces = await backend.get<WorkspaceSummary[]>('/api/workspaces');
    const rows = Array.isArray(workspaces) ? workspaces : [];
    const ids = rows
      .map(row => (typeof row.id === 'string' && row.id.trim() ? row.id.trim() : null))
      .filter((id): id is string => id !== null);
    const active = rows.find(row => row.isActive === true);
    const activeId =
      active && typeof active.id === 'string' && active.id.trim() ? active.id.trim() : null;
    resolved = activeId ?? (ids.length === 1 ? (ids[0] ?? null) : null);
  } catch {
    resolved = null;
  }
  cachedWorkspaceIds.set(backend, resolved);
  return resolved;
}

/**
 * Read launch settings for `workspaceId` (or the resolved active workspace).
 * Rejects with the backend error so callers can report *why* settings could not
 * be read instead of silently degrading.
 */
export async function fetchLaunchSettings<T>({
  backend,
  workspaceId
}: {
  backend: BackendClient;
  workspaceId?: string | null;
}): Promise<T> {
  const resolved = await resolveLaunchSettingsWorkspaceId({ backend, workspaceId });
  return backend.get<T>(launchSettingsPath(resolved));
}
