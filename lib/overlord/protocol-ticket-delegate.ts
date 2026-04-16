export function resolveTicketDelegate(
  delegate: string | null | undefined,
  agentIdentifier: string | null | undefined
) {
  const explicitDelegate = delegate?.trim();
  if (explicitDelegate) return explicitDelegate;

  const sessionAgent = agentIdentifier?.trim();
  return sessionAgent || null;
}
