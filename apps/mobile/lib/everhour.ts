import { getSupabase } from '@/lib/supabase';

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

type TicketEverhourState = {
  id: string;
  organization_id: number;
  project_id: string | null;
  title: string | null;
  ticket_id: string | null;
  ticket_sequence: number | null;
  everhour_task_id: string | null;
};

function formatEverhourError(status: number, body: string, fallback: string): Error {
  const detail = body.trim();
  const message = detail.length > 0 ? detail.slice(0, 300) : fallback;
  return new Error(`Everhour request failed (${status}): ${message}`);
}

function parseEverhourErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Unexpected error while talking to Everhour.';
}

function buildEverhourTaskName(ticket: TicketEverhourState): string {
  const persisted = ticket.ticket_id?.trim();
  const label =
    persisted ||
    (typeof ticket.ticket_sequence === 'number' && Number.isFinite(ticket.ticket_sequence)
      ? String(ticket.ticket_sequence)
      : 'Ticket');
  const title = ticket.title?.trim() || 'Untitled';
  return `${label}: ${title}`;
}

async function getCurrentUserId(): Promise<string> {
  const supabase = getSupabase();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in.');
  }
  return user.id;
}

async function getEverhourApiKey(userId: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_integrations')
    .select('api_key')
    .eq('user_id', userId)
    .eq('provider', EVERHOUR_PROVIDER)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const apiKey = (data?.api_key as string | undefined)?.trim();
  return apiKey && apiKey.length > 0 ? apiKey : null;
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

async function getTicketEverhourState(ticketId: string): Promise<TicketEverhourState> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('tickets')
    .select('id,organization_id,project_id,title,ticket_id,ticket_sequence,everhour_task_id')
    .eq('id', ticketId)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Ticket not found.');
  }

  return data as TicketEverhourState;
}

async function getEverhourProjectIdForTicket(ticket: TicketEverhourState): Promise<string> {
  if (!ticket.project_id) {
    throw new Error('Assign a project to this ticket before starting the Everhour timer.');
  }

  const supabase = getSupabase();
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
      `Project "${project.name}" is not linked to Everhour. Use Sync Projects to Everhour in the web app.`
    );
  }

  return projectId;
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
    return everhourFetch<{ id?: string }>(apiKey, '/tasks', {
      body: JSON.stringify({ name, projects: [projectId] }),
      method: 'POST'
    });
  }
}

async function ensureEverhourTaskForTicket(
  apiKey: string,
  ticketId: string
): Promise<{ taskId: string }> {
  const ticket = await getTicketEverhourState(ticketId);

  if (ticket.everhour_task_id) {
    return { taskId: ticket.everhour_task_id };
  }

  const projectId = await getEverhourProjectIdForTicket(ticket);
  const task = await createEverhourTask(apiKey, projectId, buildEverhourTaskName(ticket));

  const taskId = typeof task.id === 'string' ? task.id : null;
  if (!taskId) {
    throw new Error('Everhour did not return a task ID.');
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('tickets')
    .update({ everhour_task_id: taskId })
    .eq('id', ticket.id);

  if (error) {
    throw new Error(error.message);
  }

  return { taskId };
}

async function stopCurrentTimerIfRunning(apiKey: string): Promise<void> {
  const currentTimer = await everhourFetch<EverhourTimer>(apiKey, '/timers/current');
  if (currentTimer?.status !== 'active') {
    return;
  }
  await everhourFetch<null>(apiKey, '/timers/current', { method: 'DELETE' });
}

/** Whether the signed-in user has connected an Everhour API key. */
export async function getEverhourConnectionStatus(): Promise<boolean> {
  const userId = await getCurrentUserId();
  const apiKey = await getEverhourApiKey(userId);
  return apiKey !== null;
}

/** Read the user's currently running Everhour timer (if any). */
export async function getCurrentEverhourTimer(): Promise<EverhourTimer> {
  const userId = await getCurrentUserId();
  const apiKey = await getEverhourApiKey(userId);
  if (!apiKey) {
    return { status: 'inactive' };
  }

  try {
    const timer = await everhourFetch<EverhourTimer>(apiKey, '/timers/current');
    if (!timer?.status || timer.status === 'inactive') {
      return { status: 'inactive' };
    }
    return timer;
  } catch (error) {
    throw new Error(parseEverhourErrorMessage(error), { cause: error });
  }
}

/** Start (or restart) the Everhour timer for a ticket, creating its task if needed. */
export async function startEverhourTimerForTicket(ticketId: string): Promise<EverhourTimer> {
  const userId = await getCurrentUserId();
  const apiKey = await getEverhourApiKey(userId);
  if (!apiKey) {
    throw new Error('Everhour is not connected. Add your API key in the web app settings.');
  }

  const { taskId } = await ensureEverhourTaskForTicket(apiKey, ticketId);
  await stopCurrentTimerIfRunning(apiKey);

  return everhourFetch<EverhourTimer>(apiKey, '/timers', {
    body: JSON.stringify({ task: taskId }),
    method: 'POST'
  });
}

/** Stop the user's currently running Everhour timer. */
export async function stopEverhourTimer(): Promise<void> {
  const userId = await getCurrentUserId();
  const apiKey = await getEverhourApiKey(userId);
  if (!apiKey) {
    throw new Error('Everhour is not connected. Add your API key in the web app settings.');
  }
  await everhourFetch<null>(apiKey, '/timers/current', { method: 'DELETE' });
}
