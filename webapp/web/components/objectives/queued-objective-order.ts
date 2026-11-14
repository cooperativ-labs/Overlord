/**
 * Merge local optimistic future-objective order with the server list.
 *
 * Drag-and-drop keeps a locally mirrored order so a position-only refetch does
 * not jump a dragged item back before the reorder lands. That protection only
 * applies while a local reorder is in flight: the Run Queue also rewrites
 * objective order (a queue reorder, or a dequeued objective moving to the end),
 * and those server-side changes must show up here. When membership changes
 * (promote, create, delete), take the server order: a demoted draft belongs at
 * the front of the future group, a newly authored future at the end.
 */
export function mergeFutureObjectiveOrder(options: {
  previousIds: string[];
  incomingIds: readonly string[];
  /** True while this client's own reorder write has not settled yet. */
  reorderPending: boolean;
}): string[] {
  const { previousIds, incomingIds, reorderPending } = options;
  const incomingSet = new Set(incomingIds);
  const sameMembership =
    previousIds.length === incomingIds.length && previousIds.every(id => incomingSet.has(id));
  if (sameMembership && reorderPending) return previousIds;
  if (sameMembership && previousIds.every((id, index) => id === incomingIds[index]))
    return previousIds;
  return [...incomingIds];
}
