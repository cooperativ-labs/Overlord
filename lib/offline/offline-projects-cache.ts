const STORAGE_KEY = 'overlord:offline:projects';

export type CachedProject = {
  id: string;
  name: string;
  color: string;
  organizationId: number;
};

export function cacheProjectsForOffline(
  projects: { id: string; name: string; color: string; organizationId: number }[]
) {
  try {
    const minimal: CachedProject[] = projects.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      organizationId: p.organizationId
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function getCachedProjects(): CachedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CachedProject[];
  } catch {
    return [];
  }
}
