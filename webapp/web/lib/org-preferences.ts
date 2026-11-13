const ACTIVE_ORGANIZATION_STORAGE_PREFIX = 'overlord:active-organization';
const WORKSPACE_COLLAPSE_STORAGE_PREFIX = 'overlord:workspace-collapse';

function storageKey(prefix: string, backendKey: string): string {
  return `${prefix}:${backendKey}`;
}

function writeBackendScopedKey(prefix: string, value: string): void {
  if (typeof window === 'undefined') return;
  const backendKey = window.localStorage.getItem('overlord:active-backend-key');
  if (!backendKey) return;
  try {
    window.localStorage.setItem(storageKey(prefix, backendKey), value);
  } catch {
    /* localStorage may be unavailable */
  }
}

/** Persist the UI's selected organization id (preference echo; server scope follows active workspace). */
export function persistActiveOrganizationId(organizationId: string): void {
  writeBackendScopedKey(ACTIVE_ORGANIZATION_STORAGE_PREFIX, organizationId);
}

function collapseStorageKey(organizationId: string): string {
  const backendKey =
    typeof window !== 'undefined'
      ? (window.localStorage.getItem('overlord:active-backend-key') ?? 'default')
      : 'default';
  return `${WORKSPACE_COLLAPSE_STORAGE_PREFIX}:${backendKey}:${organizationId}`;
}

type WorkspaceCollapseState = Record<string, boolean>;

function readCollapseState(organizationId: string): WorkspaceCollapseState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(collapseStorageKey(organizationId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as WorkspaceCollapseState) : {};
  } catch {
    return {};
  }
}

function writeCollapseState(organizationId: string, state: WorkspaceCollapseState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(collapseStorageKey(organizationId), JSON.stringify(state));
  } catch {
    /* localStorage may be unavailable */
  }
}

/** Whether a workspace section is expanded in the sidebar (default expanded). */
export function isWorkspaceSectionExpanded({
  organizationId,
  workspaceId
}: {
  organizationId: string;
  workspaceId: string;
}): boolean {
  const state = readCollapseState(organizationId);
  const stored = state[workspaceId];
  return stored === undefined ? true : stored;
}

export function setWorkspaceSectionExpanded({
  organizationId,
  workspaceId,
  expanded
}: {
  organizationId: string;
  workspaceId: string;
  expanded: boolean;
}): void {
  const state = readCollapseState(organizationId);
  state[workspaceId] = expanded;
  writeCollapseState(organizationId, state);
}
