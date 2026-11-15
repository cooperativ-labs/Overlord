import { CircleCheck } from 'lucide-react';
import { type KeyboardEvent, type RefObject, useEffect, useId, useRef, useState } from 'react';

import { ApiRequestError } from '../../lib/api.ts';
import { useResolveMissionItem } from '../../lib/queries.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';

import { summaryFocusRing } from './MissionSummaryParts.tsx';

/** The longest reason the item routes accept. */
export const ITEM_REASON_LIMIT = 280;

/** Noun used in labels: `Resolve risk: …`. */
export type ResolvableItemNoun = 'risk' | 'action';

export interface ResolveDisclosure {
  open: boolean;
  formId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  show: () => void;
  /** Closes the form and returns focus to the trigger. */
  hide: () => void;
}

/** Open state shared by a row's Resolve button and its inline form. */
export function useResolveDisclosure(): ResolveDisclosure {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return {
    open,
    formId,
    triggerRef,
    show: () => setOpen(true),
    hide: () => {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };
}

/**
 * The control that opens the resolve form on an open risk or human action
 * (contract v173, PM decision 4). Visible text plus an icon, never colour alone.
 */
export function ResolveItemButton({
  disclosure,
  noun,
  itemText
}: {
  disclosure: ResolveDisclosure;
  noun: ResolvableItemNoun;
  itemText: string;
}) {
  return (
    <button
      ref={disclosure.triggerRef}
      type="button"
      aria-expanded={disclosure.open}
      aria-controls={disclosure.open ? disclosure.formId : undefined}
      aria-label={`Resolve ${noun}: ${itemText}`}
      onClick={() => (disclosure.open ? disclosure.hide() : disclosure.show())}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap px-1 text-xs font-medium text-(--color-ink-dim) hover:text-(--color-ink)',
        summaryFocusRing
      )}
    >
      <CircleCheck className="size-3" aria-hidden="true" />
      Resolve
    </button>
  );
}

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.status === 404) {
    return 'This item no longer exists. The list will refresh.';
  }
  return cause instanceof Error ? cause.message : 'Something went wrong.';
}

/**
 * Inline form under the row: done or dismissed, an optional reason, and the
 * submit. Escape cancels. The row leaves the open list when the summary
 * refetches, which the mutation awaits.
 */
export function ResolveItemForm({
  disclosure,
  itemId,
  missionId,
  noun,
  itemText
}: {
  disclosure: ResolveDisclosure;
  itemId: string;
  missionId: string;
  noun: ResolvableItemNoun;
  itemText: string;
}) {
  const resolve = useResolveMissionItem();
  const [status, setStatus] = useState<'done' | 'dismissed'>('done');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const name = useId();

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape' && !resolve.isPending) {
      event.preventDefault();
      disclosure.hide();
    }
  }

  async function submit() {
    setError(null);
    try {
      await resolve.mutateAsync({
        id: itemId,
        missionId,
        status,
        reason: reason.trim() || null
      });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  const option = (value: 'done' | 'dismissed', label: string, hint: string, first = false) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-(--color-ink)">
      <input
        ref={first ? firstRef : undefined}
        type="radio"
        name={name}
        value={value}
        checked={status === value}
        onChange={() => setStatus(value)}
        className="size-3.5 accent-(--color-ink)"
      />
      <span className="font-medium">{label}</span>
      <span className="text-(--color-ink-dim)">{hint}</span>
    </label>
  );

  return (
    <form
      id={disclosure.formId}
      aria-label={`Resolve ${noun}: ${itemText}`}
      onKeyDown={onKeyDown}
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
      className="grid gap-2 rounded-md border border-(--color-border) bg-(--color-surface-1) p-2.5"
    >
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-xs font-semibold text-(--color-ink)">Resolve as</legend>
        {option('done', 'Done', 'it was addressed', true)}
        {option('dismissed', 'Dismissed', 'it no longer applies')}
      </fieldset>
      <div className="grid gap-1">
        <label htmlFor={reasonId} className="text-xs font-semibold text-(--color-ink)">
          Reason <span className="font-normal text-(--color-ink-dim)">(optional)</span>
        </label>
        <Input
          id={reasonId}
          value={reason}
          maxLength={ITEM_REASON_LIMIT}
          onChange={event => setReason(event.target.value)}
          placeholder="What changed?"
          className="h-7 text-xs md:text-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="submit" size="xs" disabled={resolve.isPending}>
          {resolve.isPending ? 'Resolving…' : `Resolve ${noun}`}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={resolve.isPending}
          onClick={() => disclosure.hide()}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
