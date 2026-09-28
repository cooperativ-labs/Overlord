import { getActiveTokenProjectIds, serviceDatabaseClient } from '../db.ts';

// ---- Human project references -------------------------------------------
//
// Shared by workspace derivation in the dispatcher (backend/protocol.ts) and by
// the V2/V3 search project filter in ./missions.ts.

/**
 * One project the caller can reach, labelled with its owning workspace.
 *
 * Project slugs and names are unique per workspace, never per organization, so
 * a human reference can legitimately match in more than one workspace. The
 * workspace labels are what let the caller (or the user behind an agent) tell
 * the candidates apart.
 */
export type ProjectChoice = {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
};

/**
 * Raised when a human project reference matches in more than one workspace.
 *
 * Carried as a throw rather than a return value because project references are
 * resolved deep inside workspace derivation, before any subcommand handler
 * runs. `runProtocolSubcommand` converts it into the structured
 * `project_selection_required` result so every surface that accepts a project
 * name gets the same disambiguation contract — search, board-column reads,
 * mission creation, and project discovery alike.
 */
export class ProjectSelectionRequiredError extends Error {
  readonly projectRef: string;
  readonly projects: ProjectChoice[];

  constructor(projectRef: string, projects: ProjectChoice[]) {
    super(`Project reference matches more than one workspace: ${projectRef}`);
    this.name = 'ProjectSelectionRequiredError';
    this.projectRef = projectRef;
    this.projects = projects;
  }
}

/**
 * Resolve a human project reference — UUID, slug, or name — against the
 * caller's live memberships.
 *
 * A UUID is an exact address and short-circuits. Slug and name matching is
 * case-insensitive and may return several rows; `--workspace-id` (id, slug, or
 * name) narrows them, which is how a caller retries after a
 * `project_selection_required` result.
 */
export async function resolveProjectRefChoices({
  projectRef,
  workspaceHint,
  workspaceIds
}: {
  projectRef: string;
  workspaceHint?: string | null;
  workspaceIds: string[];
}): Promise<ProjectChoice[]> {
  if (workspaceIds.length === 0) return [];
  const allowedProjectIds = getActiveTokenProjectIds();
  if (allowedProjectIds?.length === 0) return [];
  const db = serviceDatabaseClient();
  const placeholders = workspaceIds.map(() => '?').join(', ');
  const selectChoice = `SELECT p.id, p.name, p.slug, p.workspace_id, w.name AS workspace_name,
            w.slug AS workspace_slug
       FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.deleted_at IS NULL AND p.workspace_id IN (${placeholders})${
        allowedProjectIds === null
          ? ''
          : ` AND p.id IN (${allowedProjectIds.map(() => '?').join(', ')})`
      }`;
  const choiceParams = [...workspaceIds, ...(allowedProjectIds ?? [])];
  type ChoiceRow = {
    id: string;
    name: string;
    slug: string;
    workspace_id: string;
    workspace_name: string;
    workspace_slug: string;
  };
  const toChoice = (row: ChoiceRow): ProjectChoice => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug
  });

  const byId = await db.get<ChoiceRow>(`${selectChoice} AND p.id = ?`, [
    ...choiceParams,
    projectRef
  ]);
  if (byId) return [toChoice(byId)];

  const matches = (
    await db.all<ChoiceRow>(
      `${selectChoice} AND (lower(p.slug) = lower(?) OR lower(p.name) = lower(?))`,
      [...choiceParams, projectRef, projectRef]
    )
  ).map(toChoice);

  const hint = workspaceHint?.trim().toLowerCase();
  if (!hint || matches.length <= 1) return matches;
  // A hint only narrows: it never widens the set beyond live membership.
  const narrowed = matches.filter(
    choice =>
      choice.workspaceId.toLowerCase() === hint ||
      choice.workspaceSlug.toLowerCase() === hint ||
      choice.workspaceName.toLowerCase() === hint
  );
  return narrowed.length > 0 ? narrowed : matches;
}
