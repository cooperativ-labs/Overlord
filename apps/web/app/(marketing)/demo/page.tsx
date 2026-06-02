import type { Metadata } from 'next';

import { AgentModelsPrefetch } from '@/components/features/AgentModelSelector';
import { getAgentModelsAction } from '@/lib/actions/agent-models';
import { resolveMarketingAgentModels } from '@/lib/marketing/offered-agent-models';

import { DemoContent } from './DemoContent';

export const metadata: Metadata = {
  title: 'Overlord | Interactive Demo',
  description:
    'Explore the Overlord AI workflow: ticket boards, agent controls, settings, and CLI — all interactive, no sign-up required.',
  alternates: {
    canonical: 'https://www.ovld.ai/demo'
  }
};

export default async function DemoPage() {
  const offeredModels = resolveMarketingAgentModels(await getAgentModelsAction());

  return (
    <>
      <AgentModelsPrefetch models={offeredModels} configs={{}} launchPreference={null} />
      <DemoContent />
    </>
  );
}
