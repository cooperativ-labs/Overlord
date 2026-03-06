'use client';

import { useEffect, useState } from 'react';

import { AiConnectionSection } from '@/components/features/ai-connections/AiConnectionSection';
import { EverhourSettings } from '@/components/features/everhour/EverhourSettings';
import { Separator } from '@/components/ui/separator';
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

  return (
    <div className="space-y-6">
      <AiConnectionSection
        provider="claude-code"
        title="Claude Code"
        description="Connect your Anthropic account to view your Claude Code subscription usage, including 5-hour and weekly token consumption."
        connectHref="/api/auth/claude-code/initiate"
        open={open}
      />

      <Separator />

      <AiConnectionSection
        provider="codex"
        title="Codex"
        description="Connect your OpenAI account to view your Codex subscription usage, including 5-hour rate limits and weekly consumption."
        connectHref="/api/auth/codex/initiate"
        open={open}
      />

      {everhourStatusLoaded ? (
        <>
          <Separator />
          <EverhourSettings
            initiallyConnected={everhourConnected}
            lastUpdatedAt={everhourUpdatedAt}
            compact
          />
        </>
      ) : null}
    </div>
  );
}
