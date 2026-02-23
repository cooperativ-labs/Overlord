export function buildTicketPath(input: {
  organizationId: number;
  projectId: string;
  ticketId: string;
}): string {
  return `/${input.organizationId}/projects/${input.projectId}/${input.ticketId}`;
}

export function buildProjectPath(input: { organizationId: number; projectId: string }): string {
  return `/${input.organizationId}/projects/${input.projectId}`;
}
