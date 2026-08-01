import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { api } from '../lib/api.ts';

type SessionInputDto = {
  id: string;
  kind: string;
  body: string;
  status: string;
  deliveryOutcome: string | null;
  deliveryLabel: string;
  createdAt: string;
};

/**
 * Mission follow-up instructions with honest delivery labels.
 *
 * Cursor's turn-boundary path must render "Queued (turn boundary)" — never "Delivered" —
 * because followup_message schedules the next turn rather than placing text in the agent's
 * current context.
 */
export function MissionSessionInputsSection({ missionId }: { missionId: string }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const inputsQ = useQuery({
    queryKey: ['agent-session-inputs', missionId],
    queryFn: () => api.listAgentSessionInputs(missionId),
    refetchInterval: 5_000
  });

  const channelId = inputsQ.data?.liveChannelId ?? null;
  const inputs: SessionInputDto[] = inputsQ.data?.inputs ?? [];

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
      await queryClient.invalidateQueries({ queryKey: ['agent-session-inputs', missionId] });
    }
  });

  return (
    <section className="space-y-3">
      <p className="text-xs text-(--color-ink-dim)">
        Delivery labels are honest: Delivered means the agent has the message; Queued (turn
        boundary) means it will arrive at the next turn.
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
      <ul className="space-y-2">
        {inputs.length === 0 ? (
          <li className="text-xs italic text-(--color-ink-dim)">No instructions yet.</li>
        ) : (
          inputs.map(input => (
            <li key={input.id} className="rounded border border-(--color-line) px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-(--color-ink)">{input.deliveryLabel}</span>
                <span className="text-[11px] text-(--color-ink-dim)">
                  {new Date(input.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-(--color-ink-dim)">{input.body}</p>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
