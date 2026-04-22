export function buildTicketPath(input: {
  organizationId?: number;
  projectId?: string | null;
  ticketId: string;
}): string {
  return input.projectId
    ? `/projects/${input.projectId}/${input.ticketId}`
    : `/u/${input.ticketId}`;
}

export function buildProjectPath(input: {
  organizationId?: number;
  projectId?: string | null;
}): string {
  return input.projectId ? `/projects/${input.projectId}` : '/u';
}
