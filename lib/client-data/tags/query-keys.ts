const TICKET_TAGS_ROOT = 'ticket-tags' as const;
const TICKET_TAGS_BATCH_ROOT = 'ticket-tags-batch' as const;

export const tagQueryKeys = {
  projectTags: (projectId: string) => ['project-tag-definitions', projectId] as const,
  ticketTags: (ticketId: string) => [TICKET_TAGS_ROOT, ticketId] as const,
  ticketTagsBatch: (ticketIds: string[]) =>
    [TICKET_TAGS_BATCH_ROOT, ...ticketIds.slice().sort()] as const,
  /** Prefix for invalidateQueries; matches any ticketTagsBatch(ids) query. */
  ticketTagsBatchRoot: [TICKET_TAGS_BATCH_ROOT] as const
};
