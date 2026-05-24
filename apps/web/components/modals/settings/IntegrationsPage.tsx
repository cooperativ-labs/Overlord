'use client';

import { useEffect, useState } from 'react';

import { EverhourSettings } from '@/components/features/everhour/EverhourSettings';
import { SlackSettings } from '@/components/features/slack/SlackSettings';
import { Separator } from '@/components/ui/separator';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';

export function IntegrationsPage({
  open,
  slackEnabled = false
}: {
  open: boolean;
  slackEnabled?: boolean;
}) {
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

  return (
    <div className="space-y-6">
      {slackEnabled ? <SlackSettings open={open} /> : null}

      {slackEnabled ? <Separator /> : null}

      {everhourStatusLoaded ? (
        <EverhourSettings
          initiallyConnected={everhourConnected}
          lastUpdatedAt={everhourUpdatedAt}
          compact
        />
      ) : null}
    </div>
  );
}
