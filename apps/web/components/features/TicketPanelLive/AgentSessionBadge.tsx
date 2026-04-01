import { Badge } from '@/components/ui/badge';
import type { Database } from '@/types/database.types';

type AgentSession = Database['public']['Tables']['agent_sessions']['Row'];
type SessionState = Database['public']['Enums']['session_state'];

const sessionBadgeConfig: Record<
  SessionState,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; pulse?: boolean }
> = {
  attached: { label: 'Running', variant: 'default', pulse: true },
  idle: { label: 'Idle', variant: 'secondary' },
  blocked: { label: 'Blocked', variant: 'destructive' },
  completed: { label: 'Completed', variant: 'outline' },
  disconnected: { label: 'Disconnected', variant: 'destructive' }
};

export function AgentSessionBadge({ session }: { session: AgentSession | null }) {
  if (!session) return null;

  const config = sessionBadgeConfig[session.session_state] ?? {
    label: session.session_state,
    variant: 'outline' as const
  };

  return (
    <Badge className="rounded-full gap-1.5" variant={config.variant}>
      {config.pulse ? (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      ) : null}
      {config.label}
    </Badge>
  );
}
