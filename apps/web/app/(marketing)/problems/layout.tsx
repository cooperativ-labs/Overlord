import { AgentModelsPrefetch } from '@/components/features/AgentModelSelector';
import { getAgentModelsAction } from '@/lib/actions/agent-models';
import { resolveMarketingAgentModels } from '@/lib/marketing/offered-agent-models';

export default async function ProblemsLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const agentModels = resolveMarketingAgentModels(await getAgentModelsAction());

  return (
    <>
      <AgentModelsPrefetch models={agentModels} configs={{}} launchPreference={null} />
      {children}
    </>
  );
}
