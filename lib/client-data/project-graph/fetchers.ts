import type {
  GraphApiResponse,
  HotspotApiResponse
} from '@/components/features/projects/graph/types';

export async function fetchProjectGraph(
  projectId: string,
  ticketIds: string[],
  options?: { includeCompleted?: boolean }
): Promise<GraphApiResponse> {
  const params = new URLSearchParams();
  if (ticketIds.length > 0) {
    params.set('ticketId', ticketIds.join(','));
  }
  if (options?.includeCompleted) {
    params.set('includeCompleted', 'true');
  }

  const url = `/api/projects/${projectId}/graph?${params.toString()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Graph request failed (${response.status})`);
  }

  return response.json();
}

export async function fetchProjectHotspots(
  projectId: string,
  options?: { windowDays?: number; directory?: string | null; includeCompleted?: boolean }
): Promise<HotspotApiResponse> {
  const params = new URLSearchParams();
  if (options?.windowDays) params.set('windowDays', String(options.windowDays));
  if (options?.directory) params.set('directory', options.directory);
  if (options?.includeCompleted === false) params.set('includeCompleted', 'false');

  const url = `/api/projects/${projectId}/graph/hotspots?${params.toString()}`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Hotspot request failed (${response.status})`);
  }

  return response.json();
}
