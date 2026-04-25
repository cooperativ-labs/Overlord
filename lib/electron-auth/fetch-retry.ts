'use client';

function isRetryableBearerAuthResponse(response: Response): boolean {
  if (response.status !== 401) return false;

  const challenge = response.headers.get('www-authenticate') ?? '';
  return challenge.startsWith('Bearer ');
}

export async function fetchWithElectronRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retried = false
): Promise<Response> {
  const response = await fetch(input, init);

  if (
    typeof window === 'undefined' ||
    !window.electronAPI?.auth ||
    retried ||
    !isRetryableBearerAuthResponse(response)
  ) {
    return response;
  }

  const refreshResult = await window.electronAPI.auth.forceRefresh();
  if (!refreshResult?.ok) {
    return response;
  }

  return fetchWithElectronRetry(input, init, true);
}
