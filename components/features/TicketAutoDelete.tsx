'use client';

import { useEffect, useRef } from 'react';

/**
 * Mounts silently on a newly-created blank ticket (when ?new=1 is in the URL).
 * When the user navigates away without adding any content, calls the
 * delete-if-empty API so the empty draft is cleaned up automatically.
 *
 * The server-side endpoint only deletes if all content fields are still empty
 * and execution target remains at the default, so edits made by the user are safe.
 */
export function TicketAutoDelete({ ticketId }: { ticketId: string }) {
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    const url = `/api/tickets/${ticketId}/delete-if-empty`;

    function onBeforeUnload() {
      // Fires on browser close / reload / hard navigation
      navigator.sendBeacon(url);
    }

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      isMounted.current = false;

      // Delay slightly so React StrictMode's synchronous remount can set
      // isMounted back to true before the fetch fires.
      setTimeout(() => {
        if (!isMounted.current) {
          // Component truly unmounted — user navigated away via SPA routing
          fetch(url, { method: 'POST', keepalive: true });
        }
      }, 100);
    };
  }, [ticketId]);

  return null;
}
