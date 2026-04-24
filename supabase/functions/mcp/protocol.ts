export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-11-25',
  '2025-11-05',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05'
] as const;

export function negotiateProtocolVersion(requested: unknown): string {
  if (
    typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }

  return SUPPORTED_PROTOCOL_VERSIONS[0];
}
