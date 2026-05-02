import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import type { TaggingInspector } from '@/lib/tagging-engine';

type TicketTaggingDebugProps = {
  inspector: TaggingInspector | null;
};

function formatEngineDecision(value: TaggingInspector['tags'][number]['engineDecision']) {
  switch (value) {
    case 'add':
      return 'engine add';
    case 'keep':
      return 'engine keep';
    case 'remove':
      return 'engine remove';
    case 'skip_suppressed':
      return 'suppressed';
    default:
      return 'below threshold';
  }
}

export function TicketTaggingDebug({ inspector }: TicketTaggingDebugProps) {
  if (!inspector) return null;

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="tagging-debug">
        <AccordionTrigger className="py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:no-underline">
          Tagging Debug
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border bg-background px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Inputs
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  <div>Threshold: {inspector.threshold}</div>
                  <div>Paths: {inspector.consideredPaths.length}</div>
                  <div>Commands: {inspector.consideredCommands.length}</div>
                  <div>Assignments: {inspector.assignments.length}</div>
                  <div>Suppressions: {inspector.suppressions.length}</div>
                </div>
              </div>
              <div className="rounded-md border bg-background px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Execution Metadata
                </div>
                <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <div>
                    {inspector.consideredPaths.length > 0
                      ? inspector.consideredPaths.slice(0, 6).join(', ')
                      : 'No execution paths recorded.'}
                  </div>
                  <div>
                    {inspector.consideredCommands.length > 0
                      ? inspector.consideredCommands.slice(0, 3).join(' | ')
                      : 'No command metadata recorded.'}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {inspector.tags.map(tag => (
                <div key={tag.tagKey} className="rounded-md border bg-background px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">{tag.label}</div>
                    <div className="text-xs text-muted-foreground">
                      score {tag.score} • {formatEngineDecision(tag.engineDecision)}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>matched: {tag.matched ? 'yes' : 'no'}</span>
                    <span>
                      assignments:{' '}
                      {tag.assignments.length > 0
                        ? tag.assignments.map(item => item.source).join(', ')
                        : 'none'}
                    </span>
                    <span>
                      suppressions:{' '}
                      {tag.suppressions.length > 0
                        ? tag.suppressions.map(item => item.reason ?? 'suppressed').join(', ')
                        : 'none'}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {tag.evidence.length > 0 ? (
                      tag.evidence.map(item => (
                        <div key={`${tag.tagKey}-${item.source}-${item.signal}`}>
                          [{item.source}] {item.kind} +{item.weight}: {item.signal}
                        </div>
                      ))
                    ) : (
                      <div>No evidence.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
