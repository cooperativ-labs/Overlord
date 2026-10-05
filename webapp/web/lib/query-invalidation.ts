type QueryKey = readonly unknown[];

interface QueryLike {
  queryKey: QueryKey;
}

interface QueryInvalidator {
  invalidateQueries(filters?: {
    queryKey?: QueryKey;
    predicate?: (query: QueryLike) => boolean;
  }): unknown;
}

export function isEverhourQueryKey(queryKey: QueryKey): boolean {
  return (
    (queryKey[0] === 'integrations' && queryKey[1] === 'everhour') ||
    (queryKey[0] === 'project' && queryKey[2] === 'everhour-link') ||
    (queryKey[0] === 'project' && queryKey[2] === 'everhour') ||
    (queryKey[0] === 'mission' && queryKey[2] === 'everhour')
  );
}

/** Connected accounts never appear in change projections, so realtime never refreshes them. */
export function isAccountConnectionsQueryKey(queryKey: QueryKey): boolean {
  return queryKey[0] === 'connections';
}

export function invalidateNonEverhourQueries(queryClient: QueryInvalidator): void {
  void queryClient.invalidateQueries({
    predicate: query =>
      !isEverhourQueryKey(query.queryKey) && !isAccountConnectionsQueryKey(query.queryKey)
  });
}

export function invalidateMissionEverhourQueries(queryClient: QueryInvalidator): void {
  void queryClient.invalidateQueries({
    predicate: query => query.queryKey[0] === 'mission' && query.queryKey[2] === 'everhour'
  });
}

export function invalidateProjectEverhourQueries(queryClient: QueryInvalidator): void {
  void queryClient.invalidateQueries({
    predicate: query => query.queryKey[0] === 'project' && query.queryKey[2] === 'everhour'
  });
}
