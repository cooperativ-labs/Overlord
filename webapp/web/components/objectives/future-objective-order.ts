/**
 * Merge local optimistic future-objective order with the server list.
 *
 * Drag-and-drop keeps a locally mirrored order so a position-only refetch does
 * not jump a dragged item back before the reorder lands. When membership
 * changes (promote, create, delete), take the server order: a demoted draft
 * belongs at the front of the future group, a newly authored future at the end.
 */
export function mergeFutureObjectiveOrder(options: {
  previousIds: string[];
  incomingIds: readonly string[];
}): string[] {
  const { previousIds, incomingIds } = options;
  const incomingSet = new Set(incomingIds);
  const sameMembership =
    previousIds.length === incomingIds.length && previousIds.every(id => incomingSet.has(id));
  if (sameMembership) return previousIds;
  return [...incomingIds];
}
