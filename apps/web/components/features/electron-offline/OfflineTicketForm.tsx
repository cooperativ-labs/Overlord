'use client';

import { CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ProjectSelector } from '@/components/features/projects/ProjectSelector';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { CachedProject } from '@/lib/offline/offline-projects-cache';
import { getCachedProjects } from '@/lib/offline/offline-projects-cache';
import {
  enqueueOfflineTicket,
  getQueuedTickets,
  type QueuedTicket,
  removeQueuedTicket
} from '@/lib/offline/offline-ticket-queue';

const PERSONAL_PROJECT_VALUE = '__personal__';

export function OfflineTicketForm() {
  const [projects] = useState<CachedProject[]>(() => getCachedProjects());
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(PERSONAL_PROJECT_VALUE);
  const [queue, setQueue] = useState<QueuedTicket[]>(() => getQueuedTickets());
  const [justQueued, setJustQueued] = useState(false);

  const handleQueue = useCallback(() => {
    if (!objective.trim()) return;

    const isPersonalTicket = selectedProjectId === PERSONAL_PROJECT_VALUE;
    const project = isPersonalTicket ? null : projects.find(p => p.id === selectedProjectId);
    const entry = enqueueOfflineTicket({
      objective: objective.trim(),
      organizationId: project?.organizationId,
      projectId: isPersonalTicket ? null : selectedProjectId,
      projectName: project?.name ?? 'Inbox',
      projectColor: project?.color
    });

    setQueue(prev => [...prev, entry]);
    setObjective('');
    setJustQueued(true);
    setTimeout(() => setJustQueued(false), 2000);
  }, [objective, selectedProjectId, projects]);

  const handleRemove = useCallback((id: string) => {
    removeQueuedTicket(id);
    setQueue(prev => prev.filter(t => t.id !== id));
  }, []);

  if (projects.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Project data is not available offline. Connect to the internet first so projects can be
        cached for future offline use.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="offline-objective" className="text-sm font-medium">
            What needs to be done?
          </Label>
          <Textarea
            id="offline-objective"
            value={objective}
            onChange={e => setObjective(e.target.value)}
            placeholder="Describe the ticket objective..."
            className="min-h-20 resize-none"
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleQueue();
              }
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="offline-project" className="text-sm font-medium">
            Project
          </Label>
          <ProjectSelector
            projects={projects}
            value={selectedProjectId}
            onValueChange={setSelectedProjectId}
            nullOption={{ value: PERSONAL_PROJECT_VALUE, label: 'No project / Inbox' }}
            triggerClassName="!rounded-full h-auto py-1.5"
          />
        </div>

        <Button
          onClick={handleQueue}
          disabled={!objective.trim()}
          variant="default"
          size="default"
          className="w-full"
        >
          {justQueued ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Queued!
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Queue Ticket
            </>
          )}
        </Button>
      </div>

      {queue.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {queue.length} ticket{queue.length !== 1 ? 's' : ''} queued — will submit when back
            online
          </p>
          <div className="flex flex-col gap-1.5 overflow-y-auto">
            {[...queue]
              .sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime())
              .map(ticket => (
                <div
                  key={ticket.id}
                  className="group flex items-start gap-2 rounded-md border border-border/40 bg-muted/50 px-3 py-2"
                >
                  <p className="flex-1 text-xs text-foreground line-clamp-2">{ticket.objective}</p>
                  <button
                    onClick={() => handleRemove(ticket.id)}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label="Remove queued ticket"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
