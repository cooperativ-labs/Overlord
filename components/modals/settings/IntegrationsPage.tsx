'use client';

import { useEffect, useState } from 'react';

import { EverhourSettings } from '@/components/features/everhour/EverhourSettings';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';

export function IntegrationsPage({ open }: { open: boolean }) {
  const [everhourConnected, setEverhourConnected] = useState(false);
  const [everhourUpdatedAt, setEverhourUpdatedAt] = useState<string | null>(null);
  const [everhourStatusLoaded, setEverhourStatusLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEverhourStatusLoaded(false);
    getEverhourConnectionStatus()
      .then(({ connected, updatedAt }) => {
        setEverhourConnected(connected);
        setEverhourUpdatedAt(updatedAt);
      })
      .catch(() => {
        setEverhourConnected(false);
        setEverhourUpdatedAt(null);
      })
      .finally(() => setEverhourStatusLoaded(true));
  }, [open]);

  if (!everhourStatusLoaded) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <EverhourSettings
      initiallyConnected={everhourConnected}
      lastUpdatedAt={everhourUpdatedAt}
      compact
    />
  );
}
