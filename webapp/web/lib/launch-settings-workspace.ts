type WorkspaceScope = { id: string };

/**
 * Pick the workspace context used to find and authorize this machine's
 * execution target. Launch mechanics themselves remain per-user and per-target
 * preferences, so this is a scope for access, not a separate set of defaults.
 */
export function resolveLaunchSettingsWorkspaceId({
  selectedWorkspaceId,
  defaultWorkspaceId,
  workspaces
}: {
  selectedWorkspaceId: string | null;
  defaultWorkspaceId: string | null | undefined;
  workspaces: readonly WorkspaceScope[];
}): string | null {
  const selectedIsAvailable = selectedWorkspaceId
    ? workspaces.some(workspace => workspace.id === selectedWorkspaceId)
    : false;
  if (selectedIsAvailable) return selectedWorkspaceId;

  const defaultIsAvailable = defaultWorkspaceId
    ? workspaces.some(workspace => workspace.id === defaultWorkspaceId)
    : false;
  if (defaultIsAvailable) return defaultWorkspaceId;

  return workspaces[0]?.id ?? null;
}
