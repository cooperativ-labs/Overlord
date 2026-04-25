'use client';

function isRetryableElectronAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;

  const candidate = err as {
    code?: string;
    name?: string;
    message?: string;
  };

  if (candidate.name === 'ElectronAuthError') return true;
  if (candidate.code === 'expired_token' || candidate.code === 'invalid_token') return true;

  const message = candidate.message ?? '';
  return (
    message.includes('ElectronAuthError') ||
    message.includes('expired_token') ||
    message.includes('invalid_token') ||
    message.includes('Bearer error="expired_token"') ||
    message.includes('Bearer error="invalid_token"')
  );
}

export function withElectronActionRetry<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>
) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      return await action(...args);
    } catch (err) {
      if (
        typeof window === 'undefined' ||
        !window.electronAPI?.auth ||
        !isRetryableElectronAuthError(err)
      ) {
        throw err;
      }

      const refreshResult = await window.electronAPI.auth.forceRefresh();
      if (!refreshResult?.ok) {
        throw err;
      }

      return action(...args);
    }
  };
}

export { isRetryableElectronAuthError };
