import { useEffect, useState } from 'react';

import type { AgentRequestDto } from '../../../shared/contract.ts';
import { useResolveAgentRequest } from '../../lib/queries.ts';

import {
  deliveryStateText,
  isQuestionAnswerConflict,
  isQuestionDeliveryAnswerable,
  questionAllowsFreeText,
  questionReadOnlyReason
} from './question-answer-model.ts';

export {
  deliveryStateText,
  isQuestionDeliveryAnswerable,
  questionAllowsFreeText,
  questionReadOnlyReason
} from './question-answer-model.ts';

/**
 * The one shared human-answer form for a Latch-deliverable question or choice.
 *
 * The server's `delivery.mode` is authoritative. This component deliberately does not
 * re-derive Latch availability from a channel snapshot: an off-device session is still
 * answerable through the runner queue, while a live non-Latch channel is not.
 */
export function QuestionAnswerForm({
  request,
  allowText = questionAllowsFreeText(request)
}: {
  request: AgentRequestDto;
  allowText?: boolean;
}) {
  const resolve = useResolveAgentRequest(request.missionId ?? '');
  const [text, setText] = useState('');
  const [lostRace, setLostRace] = useState(false);
  const [locallyResolved, setLocallyResolved] = useState(false);
  const [deliveryState, setDeliveryState] = useState(request.delivery.state);

  useEffect(() => setDeliveryState(request.delivery.state), [request.delivery.state]);

  const resolveConflict = resolve.isError && isQuestionAnswerConflict(resolve.error);
  const answer = (resolution: Record<string, unknown>) => {
    resolve.mutate(
      { requestId: request.id, resolution, expectedRevision: request.revision },
      {
        onSuccess: result => {
          setLostRace(!result.resolved);
          if (result.resolved) {
            setText('');
            setLocallyResolved(true);
            setDeliveryState(result.request.delivery.state);
          }
        }
      }
    );
  };

  if (!isQuestionDeliveryAnswerable(request) || locallyResolved) {
    return (
      <div className="grid gap-1 text-[11px] text-(--color-ink-dim)">
        {!locallyResolved ? <p>{questionReadOnlyReason(request)}</p> : null}
        {deliveryStateText(deliveryState) ? <p>{deliveryStateText(deliveryState)}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {request.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {request.options.map(option => (
            <button
              key={option.optionId}
              type="button"
              disabled={resolve.isPending}
              onClick={() => answer({ optionId: option.optionId })}
              className="rounded border border-(--color-line) px-2 py-1 text-xs font-medium disabled:opacity-40"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {allowText ? (
        <form
          className="flex gap-2"
          onSubmit={event => {
            event.preventDefault();
            const trimmed = text.trim();
            if (trimmed) answer({ text: trimmed });
          }}
        >
          <input
            className="min-w-0 flex-1 rounded border border-(--color-line) bg-transparent px-2 py-1.5 text-sm"
            placeholder="Answer the agent…"
            value={text}
            onChange={event => setText(event.target.value)}
          />
          <button
            type="submit"
            disabled={resolve.isPending || !text.trim()}
            className="rounded bg-(--color-ink) px-3 py-1.5 text-sm text-(--color-paper) disabled:opacity-40"
          >
            Reply
          </button>
        </form>
      ) : null}
      {lostRace || resolveConflict ? (
        <p className="text-[11px] text-(--color-ink-dim)">
          Someone answered this first. Your response was not recorded.
        </p>
      ) : null}
      {resolve.isError && !resolveConflict ? (
        <p className="text-[11px] text-red-600">{(resolve.error as Error).message}</p>
      ) : null}
      {deliveryStateText(deliveryState) ? (
        <p className="text-[11px] text-(--color-ink-dim)">{deliveryStateText(deliveryState)}</p>
      ) : null}
    </div>
  );
}
