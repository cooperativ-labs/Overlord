export const projectGraphQueryKeys = {
  all: ['project-graph'] as const,
  graph: (projectId: string, ticketIds: string[]) =>
    ['project-graph', 'graph', projectId, ...[...ticketIds].sort()] as const,
  hotspots: (projectId: string, windowDays: number, directory: string | null) =>
    ['project-graph', 'hotspots', projectId, windowDays, directory ?? '__all__'] as const
};
