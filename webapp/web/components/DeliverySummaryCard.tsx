import { AlertTriangle, Clock3, Lightbulb, ListChecks, Package, Scale } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

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

export function formatDeliveryTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function DeliveryBulletSection({
  deliveryId,
  sectionKey,
  title,
  icon,
  items,
  className,
  titleClassName,
  itemClassName
}: {
  deliveryId: string;
  sectionKey: string;
  title: string;
  icon: ReactNode;
  items: string[];
  className: string;
  titleClassName: string;
  itemClassName: string;
}) {
  const headingId = `delivery-${sectionKey}-${deliveryId}`;
  return (
    <section aria-labelledby={headingId} className={className}>
      <h4 id={headingId} className={titleClassName}>
        {icon}
        {title}
      </h4>
      <ul className={`mt-2 grid min-w-0 gap-2 wrap-anywhere text-sm ${itemClassName}`}>
        {items.map((item, index) => (
          <li key={`${sectionKey}-${index}`} className="flex min-w-0 items-start gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
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
      {presentation.knownRisks.length > 0 ? (
        <DeliveryBulletSection
          deliveryId={delivery.id}
          sectionKey="risks"
          title="Known risks"
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          items={presentation.knownRisks}
          className="min-w-0 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-500/50 dark:bg-red-500/10"
          titleClassName="flex items-center gap-1.5 wrap-anywhere text-sm font-semibold text-red-950 dark:text-red-100"
          itemClassName="text-red-950 dark:text-red-100"
        />
      ) : null}
      {presentation.deferredWork.length > 0 ? (
        <DeliveryBulletSection
          deliveryId={delivery.id}
          sectionKey="deferred"
          title="Deferred work"
          icon={<Clock3 className="size-4" aria-hidden="true" />}
          items={presentation.deferredWork}
          className="min-w-0 rounded-md border border-violet-300 bg-violet-50 p-3 dark:border-violet-500/50 dark:bg-violet-500/10"
          titleClassName="flex items-center gap-1.5 wrap-anywhere text-sm font-semibold text-violet-950 dark:text-violet-100"
          itemClassName="text-violet-950 dark:text-violet-100"
        />
      ) : null}
      {presentation.assumptions.length > 0 ? (
        <DeliveryBulletSection
          deliveryId={delivery.id}
          sectionKey="assumptions"
          title="Assumptions"
          icon={<Lightbulb className="size-4" aria-hidden="true" />}
          items={presentation.assumptions}
          className="min-w-0 rounded-md border border-(--color-border) bg-(--color-muted)/70 p-3 dark:bg-(--color-muted)/50"
          titleClassName="flex items-center gap-1.5 wrap-anywhere text-sm font-semibold text-(--color-ink)"
          itemClassName="text-(--color-ink)"
        />
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
/**
 * Collapse-on-outside-click/Escape for an expanded delivery card. Shared so the
 * mission panel and the Feed activity feed dismiss the same way; a divergence
 * here reads to the operator as two different components.
 */
export function useCollapseOnDismiss(
  expanded: boolean,
  collapse: () => void
): React.RefObject<HTMLDivElement | null> {
  const cardRef = useRef<HTMLDivElement>(null);
  // Held in a ref so an inline `() => setExpanded(false)` at the call site does not
  // rebind the document listeners on every render while the card is open.
  const collapseRef = useRef(collapse);
  collapseRef.current = collapse;

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) collapseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') collapseRef.current();
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

  return cardRef;
}

export function MissionDeliveryCard({
  delivery,
  objectiveTitle
}: {
  delivery: DeliveryDto;
  objectiveTitle: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = deliveryOneSentenceSummary(delivery);

  // The trigger is the only thing that opens or closes this accordion — no
  // outside-click/Escape dismissal, so interacting with the expanded body
  // (e.g. selecting text, clicking a link inside it) never collapses the card.
  if (expanded) {
    return (
      <article className="min-w-0 rounded-lg border border-(--color-border) bg-(--color-surface-1) p-3 shadow-md">
        <button
          type="button"
          className="mb-3 flex w-full flex-wrap items-center gap-2 border-b border-(--color-border) pb-2 text-left"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
        >
          <Package className="h-3.5 w-3.5 text-(--color-ink-dim)" aria-hidden="true" />
          <span className="min-w-0 wrap-anywhere text-sm font-medium text-(--color-ink)">
            {objectiveTitle ?? 'Delivery'}
          </span>
          <span className="text-[11px] text-(--color-ink-dim)">
            {formatDeliveryTimestamp(delivery.deliveredAt)}
          </span>
        </button>
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
            <span>{formatDeliveryTimestamp(delivery.deliveredAt)}</span>
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
