import { resolveLaunchOAuthSession, resolvePlatformUrl } from '@/lib/platform';

type QueueTicketExecutionParams = {
  /** Ticket id or `org:sequence` reference. */
  ticketId: string;
  /** Specific objective to queue; omit to let the server resolve the next launchable one. */
  objectiveId?: string | null;
  /** execution_targets.id of the target the runner should claim this on. */
  executionTargetId: string;
};

type QueueTicketExecutionResult = {
  requestId: string;
  status: string;
  /** True when an already-active request was re-queued instead of created fresh. */
  reused: boolean;
};

/**
 * Queue an objective for the ovld runner by hitting the Overlord protocol
 * `request-execution` endpoint with the user's Supabase access token. This is
 * the runner-based replacement for the old SSH "run on server" flow — the
 * runner attached to the chosen execution target picks the work up.
 */
export async function queueTicketExecution({
  ticketId,
  objectiveId,
  executionTargetId
}: QueueTicketExecutionParams): Promise<QueueTicketExecutionResult> {
  const platformUrl = resolvePlatformUrl();
  const { accessToken, organizationId } = await resolveLaunchOAuthSession();

  const response = await fetch(`${platformUrl}/api/protocol/request-execution`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'x-organization-id': String(organizationId)
    },
    body: JSON.stringify({
      ticketId,
      objectiveId: objectiveId ?? undefined,
      requestedFrom: 'mobile',
      targetKind: 'any',
      targetDeviceId: executionTargetId
    })
  });

  const payload = (await response.json().catch(() => null)) as {
    request?: { id: string; status: string };
    reused?: boolean;
    error?: string;
  } | null;

  if (!response.ok || !payload?.request) {
    throw new Error(payload?.error ?? `Failed to queue execution (${response.status}).`);
  }

  return {
    requestId: payload.request.id,
    status: payload.request.status,
    reused: Boolean(payload.reused)
  };
}
