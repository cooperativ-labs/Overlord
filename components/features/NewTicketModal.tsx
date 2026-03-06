'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import {
  createBlankTicketAction,
  deleteTicketAction,
  updateTicketFieldAction
} from '@/lib/actions/tickets';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';

const MAX_MENTION_RESULTS = 8;

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
};

type NewTicketModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  organizationId?: number;
  projects: ProjectOption[];
};

export function NewTicketModal({
  isOpen,
  onOpenChange,
  defaultProjectId,
  organizationId,
  projects
}: NewTicketModalProps) {
  const router = useRouter();
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(
    defaultProjectId || projects[0]?.id || ''
  );
  const [isCreating, startCreating] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitButtonState, setSubmitButtonState] = useState<ButtonLoadingState>('default');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Mention menu state
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);

  const mentionResults: string[] = [];
  const mentionMenuOpen = false;

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Initialize ticket on modal open
  useEffect(() => {
    if (isOpen && !ticketId) {
      startCreating(async () => {
        try {
          const created = await createBlankTicketAction(organizationId, selectedProjectId);
          setTicketId(created.id);
        } catch (error) {
          console.error('Failed to create blank ticket:', error);
        }
      });
    }
  }, [isOpen, ticketId, organizationId, selectedProjectId]);

  // Auto-save objective
  useEffect(() => {
    if (!ticketId || !objective.trim()) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await updateTicketFieldAction(ticketId, 'objective', objective);
      } catch (error) {
        console.error('Failed to auto-save objective:', error);
      }
    }, 1000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [ticketId, objective]);

  // Focus textarea and resize on modal open
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
        autoResize();
      }, 0);
    }
  }, [isOpen, autoResize]);

  function clearMentionState() {
    setMentionStart(null);
    setMentionQuery('');
    setMentionIndex(0);
  }

  function updateMentionState() {
    clearMentionState();
  }

  function insertMentionAtCursor(filePath: string) {
    const el = textareaRef.current;
    if (!el || mentionStart === null || !filePath) return;

    const cursor = el.selectionStart ?? objective.length;
    let mentionText = `@${filePath}`;
    const suffix = objective.slice(cursor);
    if (suffix.length === 0 || (!suffix.startsWith(' ') && !suffix.startsWith('\n'))) {
      mentionText += ' ';
    }

    const nextValue = `${objective.slice(0, mentionStart)}${mentionText}${suffix}`;
    const nextCursor = mentionStart + mentionText.length;

    setObjective(nextValue);
    clearMentionState();

    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      autoResize();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (mentionMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(current => (current + 1) % mentionResults.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(current => (current - 1 + mentionResults.length) % mentionResults.length);
        return;
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMentionAtCursor(mentionResults[mentionIndex] ?? mentionResults[0] ?? '');
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        clearMentionState();
        return;
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const newValue = e.target.value;
    setObjective(newValue);
    updateMentionState();
    autoResize();
  }

  async function handleSubmit() {
    if (!ticketId) return;

    setIsSubmitting(true);
    setSubmitButtonState('loading');

    try {
      const ticket = projects.find(p => p.id === selectedProjectId);
      if (!ticket) throw new Error('Selected project not found');

      // Set the title from the first 60 characters of the description
      if (objective.trim()) {
        await updateTicketFieldAction(ticketId, 'title', deriveTitleFromObjective(objective));
      }

      setSubmitButtonState('success');
      onOpenChange(false);

      // Reset state for next use
      setTicketId(null);
      setObjective('');
      setSelectedProjectId(defaultProjectId || projects[0]?.id || '');
      setSubmitButtonState('default');

      // Navigate to board view
      router.push(`${buildProjectPath({ projectId: selectedProjectId })}?view=board`);
      router.refresh();
    } catch (error) {
      setSubmitButtonState('error');
      console.error('Failed to submit ticket:', error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    if (ticketId) {
      try {
        await deleteTicketAction(ticketId);
      } catch (error) {
        console.error('Failed to delete unsaved ticket:', error);
      }
    }

    setTicketId(null);
    setObjective('');
    setSelectedProjectId(defaultProjectId || projects[0]?.id || '');
    setSubmitButtonState('default');
    onOpenChange(false);
  }

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const projectIndicatorStyle = selectedProject
    ? { backgroundColor: selectedProject.color, borderColor: selectedProject.color }
    : undefined;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-screen w-full flex-col gap-4 rounded-lg sm:h-auto sm:max-h-[90vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Ticket</DialogTitle>
          <DialogDescription>
            Create a new ticket with details and assign it to a project.
          </DialogDescription>
        </DialogHeader>

        {isCreating ? (
          <div className="flex flex-1 items-center justify-center py-8 sm:flex-none">
            <p className="text-sm text-muted-foreground">Creating ticket…</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto sm:flex-none">
            {/* Objective textarea */}
            <div className="relative flex flex-1 flex-col">
              <Label htmlFor="ticket-objective" className="mb-2 block text-sm font-medium">
                Ticket Description
              </Label>
              <textarea
                ref={textareaRef}
                id="ticket-objective"
                value={objective}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Describe what needs to be done…"
                className={cn(
                  'w-full min-h-48 flex-1 rounded-md border border-border/40 bg-background px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-1 focus:ring-ring/40',
                  'resize-none leading-relaxed',
                  'sm:min-h-64'
                )}
                disabled={isCreating || isSubmitting}
              />
            </div>

            {/* Project selector */}
            <div className="space-y-2">
              <Label htmlFor="ticket-project" className="text-sm font-medium">
                Project
              </Label>
              <Select
                value={selectedProjectId}
                onValueChange={setSelectedProjectId}
                disabled={isSubmitting}
              >
                <SelectTrigger
                  id="ticket-project"
                  className="h-auto w-full rounded-full border-border bg-background px-3 py-1.5 text-left shadow-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <span className="flex items-center gap-2 pr-2">
                    {selectedProject ? (
                      <span
                        className="h-3 w-3 rounded-[6px] border"
                        style={projectIndicatorStyle}
                      />
                    ) : (
                      <span className="h-3 w-3 rounded-[6px] border border-muted-foreground/50 bg-muted" />
                    )}
                    <span className="text-sm font-medium">
                      {selectedProject?.name ?? 'Select project'}
                    </span>
                  </span>
                </SelectTrigger>
                <SelectContent align="start">
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2 flex-shrink-0 gap-2 sm:mt-4">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isCreating || isSubmitting}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <LoadingButton
            buttonState={submitButtonState}
            setButtonState={setSubmitButtonState}
            text="Create Ticket"
            loadingText="Creating…"
            successText="Created"
            errorText="Failed"
            onClick={handleSubmit}
            disabled={isCreating || !objective.trim() || !ticketId}
            className="flex-1 sm:flex-none"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
