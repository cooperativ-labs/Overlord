import { AgentTokenList } from '@/components/features/account/agent-token-list';
import { getActiveAgentTokensAction } from '@/lib/actions/agent-tokens';

export default async function AccountTokensPage() {
  const tokens = await getActiveAgentTokensAction();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Agent tokens</h2>
        <p className="text-muted-foreground text-sm">
          Active CLI and desktop tokens for this account. Revoked tokens lose API access
          immediately.
        </p>
      </div>

      <AgentTokenList initialTokens={tokens} />
    </div>
  );
}
