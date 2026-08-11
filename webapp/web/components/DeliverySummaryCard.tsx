import { ListChecks, Package, Scale } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';

import type { DeliveryDto } from '../../shared/contract.ts';

import { Markdown } from './Markdown.tsx';
import { Badge } from './ui.tsx';

/** Scaled deliver card for the activity feed; artifacts use the default bordered layout. */
const DELIVERY_CARD_EMPHASIS_CLASS =
  'relative z-10 w-[calc((100%-1rem)/1.1)] max-w-[calc((100%-1rem)/1.1)] origin-top-left scale-110 rounded-lg bg-white shadow-md dark:bg-black';

function stripMarkdownInline(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_>~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First sentence of the composed presentation, falling back to the raw delivery summary. */
export function deliveryOneSentenceSummary(delivery: DeliveryDto): string {
  const source = delivery.report.presentation.markdown.trim() || delivery.summary.trim();
  const plain = stripMarkdownInline(source);
  const match = plain.match(/^[^.!?]+[.!?]?/);
  return match?.[0]?.trim() || plain.slice(0, 200);
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function DeliveryPresentation({
  delivery,
  summaryText,
  emphasized = false
}: {
  delivery: DeliveryDto;
  summaryText: string;
  /** When true, uses the scaled activity-feed card styling. */
  emphasized?: boolean;
}) {
  const presentation = delivery.report.presentation;
  const cardClass = emphasized
    ? `${DELIVERY_CARD_EMPHASIS_CLASS} grid min-w-0 gap-3 p-3`
    : 'grid min-w-0 gap-3';

  return (
    <div className={cardClass}>
      {presentation.status === 'pending' ? (
        <p className="text-xs text-(--color-ink-dim)" role="status">
          Adding delivery details…
        </p>
      ) : null}
      <Markdown text={presentation.markdown} />
      {presentation.humanActions.length > 0 ? (
        <section
          aria-labelledby={`delivery-actions-${delivery.id}`}
          className="min-w-0 rounded-md border border-sky-300 bg-sky-50 p-3 dark:border-sky-500/50 dark:bg-sky-500/10"
        >
          <h4
            id={`delivery-actions-${delivery.id}`}
            className="flex items-center gap-1.5 wrap-anywhere text-sm font-semibold text-sky-950 dark:text-sky-100"
          >
            <ListChecks className="size-4" aria-hidden="true" />
            Follow-up actions
          </h4>
          <ul className="mt-2 grid min-w-0 gap-2 wrap-anywhere text-sm text-sky-950 dark:text-sky-100">
            {presentation.humanActions.map(action => (
              <li key={action.id}>
                <span className="font-medium">{action.action}</span>
                {action.reason ? (
                  <span className="block text-sky-800 dark:text-sky-200">{action.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {presentation.tradeoffsMade.length > 0 ? (
        <section
          aria-labelledby={`delivery-tradeoffs-${delivery.id}`}
          className="min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/50 dark:bg-amber-500/10"
        >
          <h4
            id={`delivery-tradeoffs-${delivery.id}`}
            className="flex items-center gap-1.5 wrap-anywhere text-sm font-semibold text-amber-950 dark:text-amber-100"
          >
            <Scale className="size-4" aria-hidden="true" />
            Tradeoffs made
          </h4>
          <ul className="mt-2 grid min-w-0 gap-3 wrap-anywhere text-sm text-amber-950 dark:text-amber-100">
            {presentation.tradeoffsMade.map(tradeoff => (
              <li key={tradeoff.id}>
                <span className="font-medium">{tradeoff.decision}</span>
                <span className="block text-amber-800 dark:text-amber-200">
                  {tradeoff.rationale}
                </span>
                {tradeoff.alternativesConsidered.length > 0 ? (
                  <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
                    Considered: {tradeoff.alternativesConsidered.join(', ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Accordion className="border-t border-(--color-ink-dim)/15 pt-1">
        <AccordionItem value="summary" className="border-none">
          <AccordionTrigger className="py-2 text-xs font-medium text-(--color-ink-dim) hover:no-underline">
            Full delivery text
          </AccordionTrigger>
          <AccordionContent>
            <p className="whitespace-pre-wrap wrap-anywhere text-sm text-(--color-ink-dim)">
              {summaryText}
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

/**
 * Delivery card for the Artifacts section: objective title, one-sentence preview,
 * and click-to-expand full structured delivery summary.
 */
export function MissionDeliveryCard({
  delivery,
  objectiveTitle
}: {
  delivery: DeliveryDto;
  objectiveTitle: string | null;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const preview = deliveryOneSentenceSummary(delivery);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [expanded]);

  if (expanded) {
    return (
      <article
        ref={cardRef}
        className="min-w-0 rounded-lg border border-(--color-border) bg-(--color-surface-1) p-3 shadow-md"
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-(--color-border) pb-2">
          <Package className="h-3.5 w-3.5 text-(--color-ink-dim)" aria-hidden="true" />
          <span className="min-w-0 wrap-anywhere text-sm font-medium text-(--color-ink)">
            {objectiveTitle ?? 'Delivery'}
          </span>
          <span className="text-[11px] text-(--color-ink-dim)">
            {formatTimestamp(delivery.deliveredAt)}
          </span>
        </div>
        <DeliveryPresentation delivery={delivery} summaryText={delivery.summary} />
      </article>
    );
  }

  return (
    <article className="min-w-0 rounded-lg border border-(--color-border) bg-(--color-surface-1)">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 p-3 text-left transition-colors hover:bg-(--color-surface-2)"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-(--color-border) bg-(--color-surface-1)">
          <Package className="h-3.5 w-3.5 text-(--color-ink-dim)" aria-hidden="true" />
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="truncate text-sm font-medium text-(--color-ink)">
            {objectiveTitle ?? 'Delivery'}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-[11px] text-(--color-ink-dim)">
            <Badge className="px-1.5 py-0 text-[10px] uppercase tracking-wide">Delivered</Badge>
            <span>{formatTimestamp(delivery.deliveredAt)}</span>
          </span>
          <p className="line-clamp-2 wrap-anywhere text-sm text-(--color-ink-dim)">{preview}</p>
        </span>
      </button>
    </article>
  );
}

export function MissionDeliveryList({
  deliveries,
  objectiveTitleById
}: {
  deliveries: DeliveryDto[];
  objectiveTitleById: Map<string, string | null>;
}) {
  const sorted = [...deliveries].sort(
    (a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime()
  );

  return (
    <div className="grid gap-3">
      {sorted.map(delivery => (
        <MissionDeliveryCard
          key={delivery.id}
          delivery={delivery}
          objectiveTitle={objectiveTitleById.get(delivery.objectiveId) ?? null}
        />
      ))}
    </div>
  );
}
