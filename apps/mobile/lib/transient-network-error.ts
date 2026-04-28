export function isTransientNetworkError(error: { message?: string } | Error | null | undefined) {
  const message = error?.message ?? '';
  return message.includes('Network request failed') || message.includes('Failed to fetch');
}
