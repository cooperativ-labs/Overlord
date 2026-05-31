import { useCallback, useRef, useState } from 'react';

/**
 * Shared clipboard-copy hook with a transient `copied` flag.
 *
 * Replaces the inline `useState(false)` + `navigator.clipboard.writeText` +
 * `setTimeout(() => setCopied(false), 2000)` pattern that was duplicated across
 * the app. The reset timer is stored in a ref so rapid re-clicks don't stack
 * timeouts, and `copy` returns a boolean so callers can branch on success.
 */
export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetMs);
        return true;
      } catch {
        return false;
      }
    },
    [resetMs]
  );

  return { copied, copy };
}
