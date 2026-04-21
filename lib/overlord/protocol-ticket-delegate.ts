export function resolveTicketDelegate(
  delegate: string | null | undefined,
  modelIdentifier: string | null | undefined,
  agentIdentifier: string | null | undefined
) {
  const explicitDelegate = delegate?.trim();
  if (explicitDelegate) return explicitDelegate;

  const resolvedModel = modelIdentifier?.trim();
  if (resolvedModel) return resolvedModel;

  const sessionAgent = agentIdentifier?.trim();
  return sessionAgent || null;
}
