'use client';

import { useLayoutEffect } from 'react';

import { seedAgentModelsCache } from '@/components/features/AgentModelSelector';
import { MARKETING_OFFERED_AGENT_MODELS } from '@/lib/marketing/offered-agent-models';

export function useSeedMarketingAgentModels() {
  useLayoutEffect(() => {
    seedAgentModelsCache(MARKETING_OFFERED_AGENT_MODELS);
  }, []);
}
