const STORAGE_KEY = 'overlord:offline:ticket-queue';

export type QueuedTicket = {
  id: string;
  objective: string;
  projectId: string;
  projectName: string;
  queuedAt: string; // ISO date string
};

export function getQueuedTickets(): QueuedTicket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedTicket[];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedTicket[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function enqueueOfflineTicket(ticket: Omit<QueuedTicket, 'id' | 'queuedAt'>): QueuedTicket {
  const entry: QueuedTicket = {
    ...ticket,
    id: crypto.randomUUID(),
    queuedAt: new Date().toISOString()
  };
  const queue = getQueuedTickets();
  queue.push(entry);
  saveQueue(queue);
  return entry;
}

export function removeQueuedTicket(id: string) {
  const queue = getQueuedTickets().filter(t => t.id !== id);
  saveQueue(queue);
}

export function clearTicketQueue() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
