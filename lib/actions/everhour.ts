'use server';

import { revalidatePath } from 'next/cache';

import { getTicketIdentifier } from '@/lib/helpers/tickets';
import { createClient } from '@/supabase/utils/server';

const EVERHOUR_BASE_URL = 'https://api.everhour.com';
const EVERHOUR_PROVIDER = 'everhour';

type EverhourTaskRef = {
  id: string;
  name?: string;
};

export type EverhourTimer = {
  status: 'active' | 'inactive';
  duration?: number;
  task?: EverhourTaskRef | null;
  today?: number;
};

export type EverhourTimeRecord = {
  comment?: string | null;
  date: string;
  id: number;
  task?: EverhourTaskRef;
  time: number;
};

export type EverhourSyncedProject = {
  color: string;
  everhour_project_id: string | null;
  id: string;
  name: string;
};

type AuthenticatedContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

type TicketEverhourState = {
  everhour_project_id: string | null;
  everhour_task_id: string | null;
  id: string;
  organization_id: number;
  project_id: string | null;
  title: string | null;
};

type EverhourRemoteProject = {
  id: string;
  name: string;
};

function formatEverhourError(status: number, body: string, fallback: string) {
  const detail = body.trim();
  const message = detail.length > 0 ? detail.slice(0, 300) : fallback;
  return new Error(`Everhour request failed (${status}): ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEverhourErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Unexpected error while talking to Everhour.';
}

function parseEverhourStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/Everhour request failed \\((\\d{3})\\):/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseISODate(value: Date): string {
  return value.toISOString().split('T')[0];
}

function sanitizeDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    throw new Error('Duration must be a number of seconds.');
  }
  const rounded = Math.round(seconds);
  if (rounded <= 0) {
    throw new Error('Duration must be greater than zero.');
  }
  return rounded;
}

function normalizeProjectName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractEverhourProjectId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function extractEverhourProjects(payload: unknown): EverhourRemoteProject[] {
  const candidates = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.projects)
      ? payload.projects
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : [];

  const parsedProjects = candidates
    .map(item => {
      if (!isRecord(item)) return null;
      const id = extractEverhourProjectId(item.id);
      const name = typeof item.name === 'string' ? normalizeProjectName(item.name) : '';
      if (!id || !name) return null;

      return {
        id,
        name
      };
    })
    .filter((item): item is EverhourRemoteProject => item !== null);

  const deduped = new Map<string, EverhourRemoteProject>();
  for (const project of parsedProjects) {
    deduped.set(project.id, project);
  }
  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeTimeRecords(payload: unknown): EverhourTimeRecord[] {
  const records = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.records)
      ? payload.records
      : [];

  return records
    .filter((record): record is EverhourTimeRecord => {
      return isRecord(record) && typeof record.id === 'number' && typeof record.time === 'number';
    })
    .sort((a, b) => {
      if (a.date === b.date) {
        return b.id - a.id;
      }
      return b.date.localeCompare(a.date);
    });
}

function extractCreatedProjectId(payload: unknown): string | null {
  if (isRecord(payload)) {
    const direct = extractEverhourProjectId(payload.id);
    if (direct) return direct;
    if (isRecord(payload.project)) {
      const nested = extractEverhourProjectId(payload.project.id);
      if (nested) return nested;
    }
  }
  return null;
}

async function createEverhourProject(apiKey: string, name: string): Promise<string> {
  const payloadVariants: Array<Record<string, string>> = [
    // Newer API variants often expect explicit internal project type.
    { name, type: 'internal' },
    { name }
  ];

  let lastError: unknown = null;
  for (const body of payloadVariants) {
    try {
      const payload = await everhourFetch<unknown>(apiKey, '/projects', {
        body: JSON.stringify(body),
        method: 'POST'
      });
      const projectId = extractCreatedProjectId(payload);
      if (!projectId) {
        throw new Error('Everhour did not return a project ID after project creation.');
      }
      return projectId;
    } catch (error) {
      lastError = error;
    }
  }

  if (isInvalidProjectTypeError(lastError)) {
    throw new Error(
      'Everhour rejected project creation due to project type requirements. Create the project in Everhour once, then run Sync Projects to Everhour again.',
      { cause: lastError }
    );
  }

  if (lastError instanceof Error) {
    throw new Error(parseEverhourErrorMessage(lastError), { cause: lastError });
  }
  throw new Error(parseEverhourErrorMessage(lastError));
}

function isInvalidProjectTypeError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes('Invalid project type');
}

async function createEverhourTask(
  apiKey: string,
  projectId: string,
  name: string
): Promise<{ id?: string }> {
  const encodedProjectId = encodeURIComponent(projectId);

  try {
    // Preferred project-scoped task creation endpoint.
    return await everhourFetch<{ id?: string }>(apiKey, `/projects/${encodedProjectId}/tasks`, {
      body: JSON.stringify({ name }),
      method: 'POST'
    });
  } catch {
    // Backward-compatible fallback for older payload shape.
    try {
      return await everhourFetch<{ id?: string }>(apiKey, '/tasks', {
        body: JSON.stringify({
          name,
          projects: [projectId]
        }),
        method: 'POST'
      });
    } catch (legacyError) {
      if (isInvalidProjectTypeError(legacyError)) {
        throw new Error(
          `Everhour rejected project mapping for "${projectId}". Re-run "Sync Projects to Everhour" and try again.`,
          { cause: legacyError }
        );
      }
      throw new Error(parseEverhourErrorMessage(legacyError), { cause: legacyError });
    }
  }
}

async function stopCurrentTimerIfRunning(apiKey: string): Promise<void> {
  const currentTimer = await everhourFetch<EverhourTimer>(apiKey, '/timers/current');
  if (currentTimer.status !== 'active') {
    return;
  }
  await everhourFetch<null>(apiKey, '/timers/current', { method: 'DELETE' });
}

function revalidateTicketPaths(organizationId: number, ticketId: string) {
  revalidatePath('/u');
  revalidatePath(`/${organizationId}`);
  revalidatePath(`/${organizationId}/${ticketId}`);
}

function revalidateProjectTicketPaths(
  organizationId: number,
  projectId: string | null,
  ticketId: string
) {
  if (!projectId) {
    return;
  }
  revalidatePath(`/${organizationId}/projects/${projectId}`);
  revalidatePath(`/${organizationId}/projects/${projectId}/${ticketId}`);
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in.');
  }

  return { supabase, userId: user.id };
}

async function getEverhourApiKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_integrations')
    .select('api_key')
    .eq('user_id', userId)
    .eq('provider', EVERHOUR_PROVIDER)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data?.api_key as string | undefined) ?? null;
}

async function requireEverhourApiKey(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string> {
  const apiKey = await getEverhourApiKey(supabase, userId);
  if (!apiKey) {
    throw new Error('Everhour is not connected. Add your API key in Account settings.');
  }
  return apiKey;
}

async function everhourFetch<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('X-Api-Key', apiKey);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${EVERHOUR_BASE_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw formatEverhourError(response.status, bodyText, response.statusText);
  }

  if (!bodyText) {
    return null as T;
  }

  return JSON.parse(bodyText) as T;
}

async function getTicketEverhourState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string
): Promise<TicketEverhourState> {
  const { data, error } = await supabase
    .from('tickets')
    .select('id,organization_id,project_id,title,everhour_task_id,everhour_project_id')
    .eq('id', ticketId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Ticket not found.');
  }

  return data as TicketEverhourState;
}

async function getEverhourProjectIdForTicket(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticket: TicketEverhourState
): Promise<string> {
  if (!ticket.project_id) {
    throw new Error('Assign a project to this ticket before starting Everhour timer.');
  }

  const { data: project, error } = await supabase
    .from('projects')
    .select('everhour_project_id,name')
    .eq('id', ticket.project_id)
    .eq('organization_id', ticket.organization_id)
    .single();

  if (error || !project) {
    throw new Error(error?.message ?? 'Ticket project not found.');
  }

  const projectId =
    typeof project.everhour_project_id === 'string' ? project.everhour_project_id : null;
  if (!projectId) {
    throw new Error(
      `Project "${project.name}" is not linked to Everhour. Use Sync Projects to Everhour in the Project section.`
    );
  }

  return projectId;
}

function buildEverhourTaskName(ticket: { id: string; title: string | null }): string {
  const label = getTicketIdentifier(ticket.id) || 'Ticket';
  const title = ticket.title?.trim() || 'Untitled';
  return `${label}: ${title}`;
}

export async function getEverhourConnectionStatus(): Promise<{
  connected: boolean;
  updatedAt: string | null;
}> {
  const { supabase, userId } = await getAuthenticatedContext();
  const { data, error } = await supabase
    .from('user_integrations')
    .select('updated_at')
    .eq('user_id', userId)
    .eq('provider', EVERHOUR_PROVIDER)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    connected: Boolean(data),
    updatedAt: (data?.updated_at as string | undefined) ?? null
  };
}

export async function saveEverhourApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    throw new Error('API key is required.');
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const { error } = await supabase.from('user_integrations').upsert(
    {
      api_key: trimmed,
      provider: EVERHOUR_PROVIDER,
      updated_at: new Date().toISOString(),
      user_id: userId
    },
    { onConflict: 'user_id,provider' }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function syncEverhourProjectsForOrganization(organizationId: number): Promise<{
  created: number;
  failedProjects: string[];
  linked: number;
  mapped: number;
  projects: EverhourSyncedProject[];
  totalLocal: number;
}> {
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error('A valid organization is required.');
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const apiKey = await requireEverhourApiKey(supabase, userId);

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id')
    .eq('id', organizationId)
    .single();

  if (organizationError || !organization) {
    throw new Error('Organization not found or inaccessible.');
  }

  const rawProjects = await everhourFetch<unknown>(apiKey, '/projects');
  const everhourProjects = extractEverhourProjects(rawProjects);

  const { data: existingProjects, error: existingProjectsError } = await supabase
    .from('projects')
    .select('id,name,color,everhour_project_id')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true });

  if (existingProjectsError) {
    throw new Error(existingProjectsError.message);
  }

  const localProjects = [...(existingProjects ?? [])];
  const remoteById = new Map<string, EverhourRemoteProject>();
  const remoteByName = new Map<string, EverhourRemoteProject>();
  for (const remoteProject of everhourProjects) {
    remoteById.set(remoteProject.id, remoteProject);
    remoteByName.set(normalizeProjectName(remoteProject.name).toLowerCase(), remoteProject);
  }

  let created = 0;
  const failedProjects: string[] = [];
  let linked = 0;

  for (const localProject of localProjects) {
    const localProjectName = normalizeProjectName(localProject.name);
    const currentEverhourId = extractEverhourProjectId(localProject.everhour_project_id);

    if (currentEverhourId && remoteById.has(currentEverhourId)) {
      continue;
    }

    const existingByName = remoteByName.get(localProjectName.toLowerCase()) ?? null;
    let targetEverhourId: string;

    if (existingByName) {
      targetEverhourId = existingByName.id;
      linked += 1;
    } else {
      try {
        targetEverhourId = await createEverhourProject(apiKey, localProjectName);
        const remoteProject = { id: targetEverhourId, name: localProjectName };
        remoteById.set(targetEverhourId, remoteProject);
        remoteByName.set(localProjectName.toLowerCase(), remoteProject);
        created += 1;
      } catch {
        failedProjects.push(localProjectName);
        continue;
      }
    }

    const { error: updateMappingError } = await supabase
      .from('projects')
      .update({ everhour_project_id: targetEverhourId })
      .eq('id', localProject.id)
      .eq('organization_id', organizationId);

    if (updateMappingError) {
      throw new Error(updateMappingError.message);
    }
  }

  const { data: projectsAfterSync, error: projectsAfterSyncError } = await supabase
    .from('projects')
    .select('id,name,color,everhour_project_id')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true });

  if (projectsAfterSyncError) {
    throw new Error(projectsAfterSyncError.message);
  }

  revalidatePath(`/${organizationId}`);

  const mapped =
    projectsAfterSync?.filter(project => typeof project.everhour_project_id === 'string').length ??
    0;

  return {
    created,
    failedProjects,
    linked,
    mapped,
    projects: (projectsAfterSync ?? []) as EverhourSyncedProject[],
    totalLocal: projectsAfterSync?.length ?? 0
  };
}

export async function ensureEverhourTaskForTicket(ticketId: string): Promise<{
  projectId: string;
  taskId: string;
}> {
  const { supabase, userId } = await getAuthenticatedContext();
  const ticket = await getTicketEverhourState(supabase, ticketId);

  if (ticket.everhour_task_id) {
    return {
      projectId: ticket.everhour_project_id ?? '',
      taskId: ticket.everhour_task_id
    };
  }

  const projectId = await getEverhourProjectIdForTicket(supabase, ticket);

  const apiKey = await requireEverhourApiKey(supabase, userId);
  const task = await createEverhourTask(apiKey, projectId, buildEverhourTaskName(ticket));

  const taskId = typeof task.id === 'string' ? task.id : null;
  if (!taskId) {
    throw new Error('Everhour did not return a task ID.');
  }

  const { error } = await supabase
    .from('tickets')
    .update({
      everhour_project_id: projectId,
      everhour_task_id: taskId
    })
    .eq('id', ticket.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidateTicketPaths(ticket.organization_id, ticket.id);
  revalidateProjectTicketPaths(ticket.organization_id, ticket.project_id, ticket.id);
  return { projectId, taskId };
}

export async function getCurrentEverhourTimer(): Promise<EverhourTimer> {
  const { supabase, userId } = await getAuthenticatedContext();
  const apiKey = await getEverhourApiKey(supabase, userId);
  if (!apiKey) {
    return { status: 'inactive' };
  }

  try {
    const timer = await everhourFetch<EverhourTimer>(apiKey, '/timers/current');
    return timer?.status ? timer : { status: 'inactive' };
  } catch (error) {
    throw new Error(parseEverhourErrorMessage(error), { cause: error });
  }
}

export async function startEverhourTimerForTicket(
  ticketId: string,
  comment?: string
): Promise<EverhourTimer> {
  const { supabase, userId } = await getAuthenticatedContext();
  const { taskId } = await ensureEverhourTaskForTicket(ticketId);
  const apiKey = await requireEverhourApiKey(supabase, userId);
  await stopCurrentTimerIfRunning(apiKey);

  const payload = comment?.trim() ? { comment: comment.trim(), task: taskId } : { task: taskId };

  return everhourFetch<EverhourTimer>(apiKey, '/timers', {
    body: JSON.stringify(payload),
    method: 'POST'
  });
}

export async function stopEverhourTimer(): Promise<void> {
  const { supabase, userId } = await getAuthenticatedContext();
  const apiKey = await requireEverhourApiKey(supabase, userId);
  await everhourFetch<null>(apiKey, '/timers/current', { method: 'DELETE' });
}

export async function listTimeRecordsForTicket(ticketId: string): Promise<EverhourTimeRecord[]> {
  const { supabase, userId } = await getAuthenticatedContext();
  const ticket = await getTicketEverhourState(supabase, ticketId);
  if (!ticket.everhour_task_id) {
    return [];
  }

  const apiKey = await getEverhourApiKey(supabase, userId);
  if (!apiKey) {
    return [];
  }

  const to = new Date();
  const from = new Date();
  from.setFullYear(to.getFullYear() - 1);

  const params = new URLSearchParams({
    from: parseISODate(from),
    tasks: ticket.everhour_task_id,
    to: parseISODate(to)
  });

  const candidatePaths = [
    `/time?${params.toString()}`,
    `/reports/time?${params.toString()}`,
    `/time/records?${params.toString()}`
  ];

  let lastError: unknown = null;
  for (const path of candidatePaths) {
    try {
      const response = await everhourFetch<unknown>(apiKey, path);
      return normalizeTimeRecords(response);
    } catch (error) {
      lastError = error;
      const status = parseEverhourStatus(error);
      if (status !== 404 && status !== 405) {
        break;
      }
    }
  }

  const status = parseEverhourStatus(lastError);
  if (status === 404 || status === 405) {
    return [];
  }
  throw new Error(parseEverhourErrorMessage(lastError), { cause: lastError });
}

export async function createTimeRecordForTicket(
  ticketId: string,
  seconds: number,
  date: string,
  comment?: string
): Promise<EverhourTimeRecord> {
  const { supabase, userId } = await getAuthenticatedContext();
  const { taskId } = await ensureEverhourTaskForTicket(ticketId);
  const apiKey = await requireEverhourApiKey(supabase, userId);
  const sanitizedSeconds = sanitizeDuration(seconds);

  return everhourFetch<EverhourTimeRecord>(apiKey, '/time', {
    body: JSON.stringify({
      comment: comment?.trim() || undefined,
      date,
      task: taskId,
      time: sanitizedSeconds
    }),
    method: 'POST'
  });
}

export async function updateTimeRecord(
  recordId: number,
  seconds: number,
  comment?: string
): Promise<EverhourTimeRecord> {
  const { supabase, userId } = await getAuthenticatedContext();
  const apiKey = await requireEverhourApiKey(supabase, userId);
  const sanitizedSeconds = sanitizeDuration(seconds);

  return everhourFetch<EverhourTimeRecord>(apiKey, `/time/${recordId}`, {
    body: JSON.stringify({
      comment: comment?.trim() || undefined,
      time: sanitizedSeconds
    }),
    method: 'PUT'
  });
}

export async function deleteTimeRecord(recordId: number): Promise<void> {
  const { supabase, userId } = await getAuthenticatedContext();
  const apiKey = await requireEverhourApiKey(supabase, userId);
  await everhourFetch<null>(apiKey, `/time/${recordId}`, { method: 'DELETE' });
}
