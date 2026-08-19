import type { ProjectDto } from '@overlord/contract';
import {
  type ProjectJsonLink,
  readProjectJsonLinks,
  selectPrimaryProjectLink
} from '@overlord/core/service/local-target/project-metadata';
import type { LinkedProjectDiscovery, ProjectDiscovery } from '@overlord/core/service/projects';
import path from 'node:path';

import type { BackendClient } from './backend-client.js';
import { CliError } from './errors.js';

export async function resolvePreferredExecutionTargetId({
  backend
}: {
  backend: BackendClient;
}): Promise<string | null> {
  try {
    const launchSettings = await backend.get<{ executionTargetId?: string | null }>(
      '/api/launch-settings'
    );
    return typeof launchSettings.executionTargetId === 'string'
      ? launchSettings.executionTargetId
      : null;
  } catch {
    return null;
  }
}

function discoverProjectJsonFromFilesystem({
  workingDirectory,
  preferredExecutionTargetId
}: {
  workingDirectory: string;
  preferredExecutionTargetId?: string | null;
}): { resourcePath: string; links: ProjectJsonLink[] } | null {
  let current = path.resolve(workingDirectory);

  while (true) {
    const projectJsonPath = path.join(current, '.overlord', 'project.json');
    const links = readProjectJsonLinks(projectJsonPath, { preferredExecutionTargetId });
    if (links.length > 0) {
      return { resourcePath: current, links };
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

export async function resolveProjectByIdOrName({
  backend,
  projectRef
}: {
  backend: BackendClient;
  projectRef: string;
}): Promise<ProjectDto> {
  const trimmed = projectRef.trim();
  try {
    return await backend.get<ProjectDto>(`/api/projects/${encodeURIComponent(trimmed)}`);
  } catch (error) {
    if (!(error instanceof CliError) || !/project not found/i.test(error.message)) throw error;
  }
  // Slugs and names are not globally unique, so resolve them from the
  // account-wide catalog after the direct id lookup misses.
  const projects = await listAccessibleProjects({ backend });
  const match =
    projects.find(project => project.name === trimmed) ??
    projects.find(project => project.slug === trimmed);
  if (!match) {
    throw new CliError({ message: `Project not found: ${trimmed}` });
  }
  return match;
}

async function tryResolveProjectByIdOrName({
  backend,
  projectRef
}: {
  backend: BackendClient;
  projectRef: string;
}): Promise<ProjectDto | null> {
  try {
    return await resolveProjectByIdOrName({ backend, projectRef });
  } catch (error) {
    if (error instanceof CliError && /project not found/i.test(error.message)) return null;
    throw error;
  }
}

/** Every project in every workspace the authenticated profile can access. */
export async function listAccessibleProjects({
  backend
}: {
  backend: BackendClient;
}): Promise<ProjectDto[]> {
  const workspaces = await backend.get<Array<{ id: string }>>('/api/workspaces');
  const projectLists = await Promise.all(
    workspaces.map(workspace =>
      backend.get<ProjectDto[]>(`/api/workspaces/${encodeURIComponent(workspace.id)}/projects`)
    )
  );
  const projects = new Map<string, ProjectDto>();
  for (const project of projectLists.flat()) projects.set(project.id, project);
  return [...projects.values()];
}

function linkedProjectFrom({
  link,
  project
}: {
  link: ProjectJsonLink;
  project: ProjectDto | null;
}): LinkedProjectDiscovery {
  return {
    projectId: project?.id ?? link.projectId,
    projectName: project?.name ?? link.projectName ?? link.projectId,
    resourceId: link.resourceId,
    resourceKey: link.resourceKey,
    isPrimary: link.isPrimary
  };
}

/**
 * Resolve a project from the client filesystem when the backend is remote.
 * The hosted control plane cannot walk the agent machine's directories.
 */
export async function discoverProjectOnClient({
  backend,
  workingDirectory,
  projectId
}: {
  backend: BackendClient;
  workingDirectory: string;
  projectId?: string | null;
}): Promise<ProjectDiscovery> {
  if (projectId?.trim()) {
    const project = await resolveProjectByIdOrName({ backend, projectRef: projectId });
    return {
      projectId: project.id,
      projectName: project.name,
      resourceId: null,
      resourcePath: null,
      isPrimary: false,
      linkedProjects: [
        {
          projectId: project.id,
          projectName: project.name,
          resourceId: null,
          resourceKey: null,
          isPrimary: false
        }
      ]
    };
  }

  const preferredExecutionTargetId = await resolvePreferredExecutionTargetId({ backend });
  const local = discoverProjectJsonFromFilesystem({ workingDirectory });
  const localWithTarget = discoverProjectJsonFromFilesystem({
    workingDirectory,
    preferredExecutionTargetId
  });
  const resolvedLocal = localWithTarget ?? local;
  if (!resolvedLocal) {
    throw new CliError({
      message: `No linked Overlord project found for ${path.resolve(workingDirectory)}. Run \`ovld add-cwd\` or \`ovld create-project\`.`
    });
  }

  const selectedLink = selectPrimaryProjectLink(resolvedLocal.links);
  const orderedLinks = [
    ...(selectedLink ? [selectedLink] : []),
    ...resolvedLocal.links.filter(link => link.projectId !== selectedLink?.projectId)
  ];

  let chosenProject: ProjectDto | null = null;
  let chosenLink = selectedLink;
  for (const link of orderedLinks) {
    const project = await tryResolveProjectByIdOrName({ backend, projectRef: link.projectId });
    if (project) {
      chosenProject = project;
      chosenLink = link;
      break;
    }
  }

  if (!chosenProject || !chosenLink) {
    throw new CliError({
      message: `No linked Overlord project found for ${path.resolve(workingDirectory)}. Run \`ovld add-cwd\` or \`ovld create-project\`.`
    });
  }

  const accessible =
    resolvedLocal.links.length > 1 ? await listAccessibleProjects({ backend }) : [chosenProject];
  const byId = new Map(accessible.map(project => [project.id, project]));

  return {
    projectId: chosenProject.id,
    projectName: chosenProject.name,
    resourceId: chosenLink.resourceId,
    resourcePath: resolvedLocal.resourcePath,
    isPrimary: chosenLink.isPrimary,
    linkedProjects: resolvedLocal.links.map(link =>
      linkedProjectFrom({
        link,
        project:
          byId.get(link.projectId) ?? (link.projectId === chosenProject.id ? chosenProject : null)
      })
    )
  };
}
