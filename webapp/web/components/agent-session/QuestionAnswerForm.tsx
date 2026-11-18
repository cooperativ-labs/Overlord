import type { HumanAgentRequestDto } from '@overlord/contract';
import { useEffect, useRef, useState } from 'react';

import { noteAnsweredAgentRequest } from '../../lib/answered-agent-requests.ts';
import { useRedeliverAgentRequest, useResolveAgentRequest } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';

import {
  answerErrorText,
  answerOutcome,
  type AnswerOutcomeTone,
  classifyAnswerError,
  isQuestionDeliveryAnswerable,
  newerAnswerSnapshot,
  questionAllowsFreeText,
  questionReadOnlyReason
} from './question-answer-model.ts';

export {
  answerOutcome,
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
 *
 * Recording an answer is not delivering it (ADR 0065). After a resolve the form shows the
 * delivery outcome the server reported, never "Delivered" merely because `resolved` is true.
 * A refused resolve (someone answered first, session ended, machine offline) keeps the draft.
 */
export function QuestionAnswerForm({
  request,
  allowText = questionAllowsFreeText(request)
}: {
  request: HumanAgentRequestDto;
  allowText?: boolean;
}) {
  const resolve = useResolveAgentRequest(request.missionId ?? '');
  const [text, setText] = useState('');
  const [lostRace, setLostRace] = useState(false);
  /** The authoritative request the resolve call returned on this device. */
  const [answered, setAnswered] = useState<HumanAgentRequestDto | null>(null);
  // Guards a double click that lands before React re-renders with `isPending`.
  const inFlight = useRef(false);
  // A "cannot be delivered" refusal describes the route at that moment (offline machine, ended
  // session). Once the server reports a different route, the refusal no longer applies.
  const { mode: deliveryMode, reason: deliveryReason } = request.delivery;
  const resetResolve = resolve.reset;
  const refusedAsUndeliverable =
    resolve.isError && classifyAnswerError(resolve.error) === 'not_deliverable';
  useEffect(() => {
    if (refusedAsUndeliverable) resetResolve();
    // Only a change of route clears it, not the refusal itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryMode, deliveryReason]);

  if (answered || answerOutcome(request)) {
    return <AnswerDeliveryStatus request={newerAnswerSnapshot(answered, request)} />;
  }

  if (!isQuestionDeliveryAnswerable(request)) {
    return (
      <div className="grid gap-1 text-[11px] text-(--color-ink-dim)">
        <p>{questionReadOnlyReason(request)}</p>
        {text.trim() && request.status === 'open' ? (
          <p>Your draft is kept and can be sent when this question is answerable again.</p>
        ) : null}
      </div>
    );
  }

  const errorKind = resolve.isError ? classifyAnswerError(resolve.error) : null;
  const answer = (resolution: Record<string, unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLostRace(false);
    resolve.mutate(
      { requestId: request.id, resolution, expectedRevision: request.revision },
      {
        onSuccess: result => {
          if (result.resolved) {
            setText('');
            setAnswered(result.request);
            noteAnsweredAgentRequest(result.request);
          } else {
            setLostRace(true);
          }
        },
        onSettled: () => {
          inFlight.current = false;
        }
      }
    );
  };

  return (
    <div className="grid gap-2">
      {request.options.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {request.options.map(option => (
            <Button
              key={option.optionId}
              type="button"
              variant="outline"
              size="sm"
              disabled={resolve.isPending}
              onClick={() => answer({ optionId: option.optionId })}
            >
              {option.label}
            </Button>
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
          <Input
            className="flex-1 bg-background"
            placeholder="Answer the agent…"
            aria-label="Answer the agent"
            value={text}
            disabled={resolve.isPending}
            onChange={event => setText(event.target.value)}
          />
          <Button type="submit" className="px-3" disabled={resolve.isPending || !text.trim()}>
            {resolve.isPending ? 'Sending…' : 'Reply'}
          </Button>
        </form>
      ) : null}
      {resolve.isPending ? (
        <p role="status" className="text-[11px] text-(--color-ink-dim)">
          Saving your answer and sending it to the agent…
        </p>
      ) : null}
      {lostRace || errorKind === 'lost_race' ? (
        <p role="alert" className="text-[11px] text-(--color-ink-dim)">
          Someone answered this first. Your response was not recorded.
        </p>
      ) : null}
      {errorKind && errorKind !== 'lost_race' ? (
        <p role="alert" className="text-[11px] text-red-600 dark:text-red-400">
          {answerErrorText(resolve.error)}
          {errorKind === 'not_deliverable' ? ' Your answer was not recorded.' : null}
        </p>
      ) : null}
    </div>
  );
}

const OUTCOME_CLASSES: Record<AnswerOutcomeTone, string> = {
  pending: 'text-(--color-ink-dim)',
  confirmed: 'text-emerald-700 dark:text-emerald-400',
  unconfirmed: 'text-amber-800 dark:text-amber-300',
  failed: 'text-red-700 dark:text-red-400'
};

/** What the person answered, for the outcome view. */
export function recordedAnswerText(request: HumanAgentRequestDto): string | null {
  const resolution = request.resolution;
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution)) return null;
  const record = resolution as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.optionId === 'string') {
    const option = request.options.find(candidate => candidate.optionId === record.optionId);
    parts.push(option?.label ?? record.optionId);
  }
  if (typeof record.text === 'string' && record.text.trim()) parts.push(record.text.trim());
  return parts.length > 0 ? parts.join(' — ') : null;
}

/**
 * The delivery outcome of a recorded answer, with the recovery the server allows:
 * "Send again" after a definitive failure, and "I checked — send again" after an unconfirmed
 * delivery. The latter passes `confirmUnconfirmed`, and the runner first asks Latch for the
 * earlier attempt's receipt, so a delivered answer is not sent twice. Nothing is ever resent
 * automatically.
 */
export function AnswerDeliveryStatus({ request }: { request: HumanAgentRequestDto }) {
  const redeliver = useRedeliverAgentRequest(request.missionId ?? '');
  const [latest, setLatest] = useState<HumanAgentRequestDto | null>(null);
  const [confirming, setConfirming] = useState(false);
  const inFlight = useRef(false);
  const current = newerAnswerSnapshot(latest, request);
  const outcome = answerOutcome(current);

  // A newer attempt arriving from the server closes a pending confirmation.
  const attempt = current.delivery.attempt ?? null;
  useEffect(() => setConfirming(false), [attempt]);

  if (!outcome) return null;
  const recorded = recordedAnswerText(current);
  const errorKind = redeliver.isError ? classifyAnswerError(redeliver.error) : null;

  const send = (confirmUnconfirmed: boolean) => {
    if (inFlight.current || outcome.attempt === null) return;
    inFlight.current = true;
    redeliver.mutate(
      { requestId: current.id, expectedAttempt: outcome.attempt, confirmUnconfirmed },
      {
        onSuccess: result => {
          setLatest(result.request);
          noteAnsweredAgentRequest(result.request);
        },
        onSettled: () => {
          inFlight.current = false;
          setConfirming(false);
        }
      }
    );
  };

  return (
    <div className="grid gap-1.5 text-[11px]" data-delivery-stage={current.delivery.stage ?? ''}>
      {recorded ? (
        <p className="wrap-anywhere text-(--color-ink)">
          <span className="text-(--color-ink-dim)">Your answer: </span>
          {recorded}
        </p>
      ) : null}
      <p role="status" className={cn('font-medium', OUTCOME_CLASSES[outcome.tone])}>
        {outcome.text}
      </p>
      {outcome.detail ? <p className="text-(--color-ink-dim)">{outcome.detail}</p> : null}
      {outcome.tone !== 'confirmed' &&
      outcome.tone !== 'pending' &&
      !outcome.canRedeliver &&
      !(current.delivery.failureCode === 'session_ended' && outcome.detail) ? (
        <p className="text-(--color-ink-dim)">
          {current.delivery.sessionState === 'exited'
            ? 'The terminal session has ended. Restart the objective to continue.'
            : 'It cannot be sent again right now.'}
        </p>
      ) : null}
      {outcome.canRedeliver && !outcome.confirmationRequired ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={redeliver.isPending}
            onClick={() => send(false)}
          >
            {redeliver.isPending ? 'Sending…' : 'Send again'}
          </Button>
        </div>
      ) : null}
      {outcome.canRedeliver && outcome.confirmationRequired ? (
        confirming ? (
          <div className="grid gap-1.5">
            <p className="text-(--color-ink)">
              Send only if the agent did not receive it. Overlord first asks Latch whether the
              earlier attempt arrived and sends nothing if it did.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                disabled={redeliver.isPending}
                onClick={() => send(true)}
              >
                {redeliver.isPending ? 'Checking…' : 'It did not arrive — send again'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={redeliver.isPending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button type="button" variant="outline" size="xs" onClick={() => setConfirming(true)}>
              Check and send again…
            </Button>
          </div>
        )
      ) : null}
      {errorKind ? (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {answerErrorText(redeliver.error)}
        </p>
      ) : null}
    </div>
  );
}
