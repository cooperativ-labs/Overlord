/**
 * Honest inject outcomes.
 *
 * `Delivered` means the agent has the message. `Queued` means it will get it at a boundary
 * we can name. `Unsupported` is a perfectly good answer and better than a hopeful Queued.
 * The Exchange delivery state machine is only honest if adapters are.
 */

export const DELIVERY_OUTCOMES = [
  'delivered',
  'queued_turn_boundary',
  'queued_next_turn',
  'unsupported'
] as const;

export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

/**
 * Human-readable delivery label. Cursor's turn-boundary path must say
 * "Queued (turn boundary)" — never "Delivered" — because followup_message schedules the
 * next turn rather than placing text in the agent's current context.
 */
export function describeDeliveryOutcome({
  status,
  deliveryOutcome
}: {
  status: string;
  deliveryOutcome: DeliveryOutcome | null | undefined;
}): string {
  if (status === 'acknowledged' || deliveryOutcome === 'delivered') return 'Delivered';
  if (deliveryOutcome === 'queued_turn_boundary') return 'Queued (turn boundary)';
  if (deliveryOutcome === 'queued_next_turn') return 'Queued (next turn)';
  if (deliveryOutcome === 'unsupported' || status === 'failed') return 'Unsupported';
  if (status === 'emitted') return 'Sent to harness';
  if (status === 'queued' || status === 'leased') return 'Pending';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'expired') return 'Expired';
  return status;
}
