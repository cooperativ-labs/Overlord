import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../lib/api.ts';
import { keys, useMissionAgentSessionInputs } from '../lib/queries.ts';

/**
 * Composer for follow-up instructions sent into a mission's live session.
 *
 * This section used to also list every instruction it had sent. It no longer does: those rows
 * now appear as {@link SessionInputStatusCard}s in the activity timeline, in reverse
 * chronological order alongside the requests and updates they interleave with. Showing them
 * twice made the same message look like two events.
 *
 * The composer is gated on the live channel snapshot rather than on whether the mission looks
 * busy — a session that has ended cannot be addressed, and offering an input box for it would
 * accept text that goes nowhere.
 */
export function MissionSessionInputsSection({ missionId }: { missionId: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const inputsQ = useMissionAgentSessionInputs(missionId);

  const channelId = inputsQ.data?.liveChannelId ?? null;

  const send = useMutation({
    mutationFn: async (text: string) => {
      if (!channelId) throw new Error('No live session channel to address');
      return api.enqueueAgentSessionInput({
        channelId,
        body: text,
        kind: 'instruction'
      });
    },
    onSuccess: async () => {
      setBody('');
      await queryClient.invalidateQueries({
        queryKey: keys.missionAgentSessionInputs(missionId)
      });
    }
  });

  return (
    <section className="space-y-3">
      <p className="text-xs text-(--color-ink-dim)">
        Delivery labels are honest: Delivered means the agent has the message; Queued (turn
        boundary) means it will arrive at the next turn. Sent instructions appear in the activity
        timeline.
      </p>
      {channelId ? (
        <form
          className="flex gap-2"
          onSubmit={event => {
            event.preventDefault();
            const trimmed = body.trim();
            if (trimmed) send.mutate(trimmed);
          }}
        >
          <input
            className="min-w-0 flex-1 rounded border border-(--color-line) bg-transparent px-2 py-1.5 text-sm"
            placeholder="Send a follow-up instruction…"
            value={body}
            onChange={event => setBody(event.target.value)}
          />
          <button
            type="submit"
            disabled={send.isPending || !body.trim()}
            className="rounded bg-(--color-ink) px-3 py-1.5 text-sm text-(--color-paper) disabled:opacity-40"
          >
            Send
          </button>
        </form>
      ) : (
        <p className="text-xs italic text-(--color-ink-dim)">No live session channel.</p>
      )}
      {send.isError ? (
        <p className="text-xs text-red-600">{(send.error as Error).message}</p>
      ) : null}
    </section>
  );
}
