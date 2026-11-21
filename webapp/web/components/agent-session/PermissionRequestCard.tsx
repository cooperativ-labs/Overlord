import type { HumanAgentRequestDto } from '@overlord/contract';
import { ShieldQuestion } from 'lucide-react';

import { AgentSessionCardShell, RequestSummaryText } from './AgentSessionCardShell.tsx';
import { QuestionAnswerForm } from './QuestionAnswerForm.tsx';

/**
 * An approval (`agent_requests.kind = 'permission'`): the agent wants to run a command or change
 * files and is held until someone answers.
 *
 * Only a control-plane session (Codex app-server mode, ADR 0094) can be answered here, and only
 * by the member who launched it; the server says so through `delivery.mode`, and every other
 * case renders read-only with the reason. The options are the card's own (`Allow once`, `Deny`):
 * no free text, and never a standing grant. A person at an attached terminal may answer first;
 * the card then closes as answered elsewhere.
 */
export function PermissionRequestCard({ request }: { request: HumanAgentRequestDto }) {
  return (
    <AgentSessionCardShell
      icon={ShieldQuestion}
      title="Approval needed"
      tone="action"
      timestamp={request.createdAt}
    >
      <RequestSummaryText text={request.summary} />
      {request.options.length > 0 ? (
        <QuestionAnswerForm request={request} allowText={false} />
      ) : (
        <p className="text-[11px] text-(--color-ink-dim)">
          This approval arrived without any options. Answer it in the agent&apos;s terminal.
        </p>
      )}
    </AgentSessionCardShell>
  );
}
