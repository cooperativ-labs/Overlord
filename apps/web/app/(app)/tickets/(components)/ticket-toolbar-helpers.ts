export type ProjectFilterOption = {
  id: string;
  name: string;
};

export function projectFilterTriggerLabel({
  filterProjectIds,
  projectOptions
}: {
  filterProjectIds: string[];
  projectOptions: ProjectFilterOption[];
}): string {
  if (filterProjectIds.length === 0) return 'All';
  if (filterProjectIds.length === 1) {
    return projectOptions.find(p => p.id === filterProjectIds[0])?.name ?? 'Project';
  }
  return `${filterProjectIds.length} projects`;
}
