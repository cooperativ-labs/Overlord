import { AgentModelsPrefetch } from '@/components/features/AgentModelSelector';
import { ElectronAuthBoundary } from '@/components/features/electron-auth/ElectronAuthGate';
import { ElectronDetector } from '@/components/features/terminal/ElectronDetector';
import { AppQueryClientProvider } from '@/components/providers/query-client-provider';
import { getAllAgentConfigsAction } from '@/lib/actions/agent-config';
import { getAgentModelsAction } from '@/lib/actions/agent-models';
import { getUserLaunchPreferenceAction } from '@/lib/actions/user-launch-preference';
import { createClientForRequest } from '@/supabase/utils/server';

export default async function QuickLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const [agentModels, agentConfigs, launchPreference] = await Promise.all([
    getAgentModelsAction(),
    user ? getAllAgentConfigsAction() : Promise.resolve({}),
    user ? getUserLaunchPreferenceAction() : Promise.resolve(null)
  ]);

  return (
    <ElectronAuthBoundary>
      <ElectronDetector />
      <AppQueryClientProvider>
        <AgentModelsPrefetch
          models={agentModels}
          configs={agentConfigs}
          launchPreference={launchPreference}
        />
        <div className="h-dvh w-dvw overflow-hidden bg-transparent">{children}</div>
      </AppQueryClientProvider>
    </ElectronAuthBoundary>
  );
}
