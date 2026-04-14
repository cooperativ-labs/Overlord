'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { AgentModelChooserButton } from '@/components/features/AgentModelChooserButton';
import { useAgentModelPreference } from '@/components/features/AgentModelSelector';
import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useWorkspaceFileTree } from '@/components/features/projects/useWorkspaceFileTree';
import { useTerminal } from '@/components/features/terminal/TerminalProvider';
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
import { ensureAgentTokenAction } from '@/lib/actions/agent-tokens';
import { generateTicketTitleAction } from '@/lib/actions/generate-title';
import {
  createBlankTicketAction,
  deleteTicketAction,
  setTicketProjectAction,
  updateTicketAssignedAgentAction,
  updateTicketFieldAction,
  updateTicketStatusAction
} from '@/lib/actions/tickets';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import type { EditableTextareaHandle } from '@/lib/types/text-control';
import { cn } from '@/lib/utils';

const EMPTY_FILE_MENTION_PATHS: string[] = [];

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
  local_working_directory?: string | null;
};

type QuickRunModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  organizationId?: number;
  projects: ProjectOption[];
  fileMentionPaths?: string[];
};

export function QuickRunModal({
  isOpen,
  onOpenChange,
  defaultProjectId,
  organizationId,
  projects,
  fileMentionPaths = EMPTY_FILE_MENTION_PATHS
}: QuickRunModalProps) {
  const router = useRouter();
  const resolvedDefaultProjectId = defaultProjectId || projects[0]?.id || '';
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(resolvedDefaultProjectId);
  const [isCreating, startCreating] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitButtonState, setSubmitButtonState] = useState<ButtonLoadingState>('default');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const creatingTicketRef = useRef(false);
  const { launchAgent } = useTerminal();
  const { selection, setSelection, loaded: selectionLoaded } = useAgentModelPreference();

  const selectedProjectForFileTree = projects.find(p => p.id === selectedProjectId);
  const { files: effectiveMentionPaths } = useWorkspaceFileTree({
    fileMentionPaths,
    workingDirectory: selectedProjectForFileTree?.local_working_directory
  });

  const autoResize = useCallback(() => {
    const el = textareaRef.current as EditableTextareaHandle | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (ticketId) return;

    setSelectedProjectId(current => {
      if (isOpen && current) return current;
      return current === resolvedDefaultProjectId ? current : resolvedDefaultProjectId;
    });
  }, [isOpen, resolvedDefaultProjectId, ticketId]);

  // Initialize ticket on modal open
  useEffect(() => {
    if (isOpen && !ticketId && !creatingTicketRef.current) {
      creatingTicketRef.current = true;
      startCreating(async () => {
        try {
          const created = await createBlankTicketAction(
            organizationId,
            resolvedDefaultProjectId || selectedProjectId
          );
          setTicketId(created.id);
          setSelectedProjectId(created.projectId);
        } catch (error) {
          console.error('Failed to create blank ticket:', error);
        } finally {
          creatingTicketRef.current = false;
        }
      });
    }
  }, [isOpen, ticketId, organizationId, resolvedDefaultProjectId, selectedProjectId]);

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

  // Focus textarea once ticket creation finishes
  useEffect(() => {
    if (isOpen && !isCreating) {
      requestAnimationFrame(() => {
        (textareaRef.current as EditableTextareaHandle | null)?.focus();
        autoResize();
      });
    }
  }, [isOpen, isCreating, autoResize]);

  async function handleSubmit() {
    if (!ticketId) return;

    setIsSubmitting(true);
    setSubmitButtonState('loading');

    try {
      const selectedProject = projects.find(p => p.id === selectedProjectId);
      if (!selectedProject) throw new Error('Selected project not found');

      // Persist final project selection
      await setTicketProjectAction(ticketId, selectedProjectId);
      await updateTicketAssignedAgentAction(ticketId, selection);

      // Save objective and generate title
      if (objective.trim()) {
        await updateTicketFieldAction(ticketId, 'objective', objective);
        const title = await generateTicketTitleAction(objective);
        await updateTicketFieldAction(ticketId, 'title', title);
      }

      // Move ticket to next-up so the agent can pick it up
      await updateTicketStatusAction(ticketId, 'next-up');

      // Ensure we have an agent token, then launch
      const agentToken = await ensureAgentTokenAction(organizationId);
      await launchAgent(
        ticketId,
        selection.agent,
        selectedProject.local_working_directory ?? undefined,
        agentToken,
        'run',
        undefined,
        selection.model ?? undefined,
        selection.thinking ?? undefined
      );

      setSubmitButtonState('success');
      onOpenChange(false);

      // Reset for next use
      setTicketId(null);
      setObjective('');
      setSelectedProjectId(resolvedDefaultProjectId);
      setSubmitButtonState('default');

      router.push(buildTicketPath({ projectId: selectedProjectId, ticketId }));
      router.refresh();
    } catch (error) {
      setSubmitButtonState('error');
      console.error('Failed to run ticket:', error);
      toast.error('Failed to launch agent', {
        description:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Check your terminal settings and agent token, then try again.'
      });
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
    setSelectedProjectId(resolvedDefaultProjectId);
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
          <DialogTitle>Run Ticket</DialogTitle>
          <DialogDescription>
            Describe the task — the agent will start immediately after you submit.
          </DialogDescription>
        </DialogHeader>

        {isCreating ? (
          <div className="flex flex-1 items-center justify-center py-8 sm:flex-none">
            <p className="text-sm text-muted-foreground">Creating ticket…</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto sm:flex-1 sm:min-h-0">
            <div className="flex flex-col gap-3">
              {/* Project selector */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="quick-run-project" className="text-sm font-medium">
                  Project
                </Label>
                <Select
                  value={selectedProjectId}
                  onValueChange={setSelectedProjectId}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="quick-run-project"
                    className="h-8 w-full border-border bg-background px-3 text-left shadow-sm hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="flex min-w-0 items-center gap-2 pr-2">
                      {selectedProject ? (
                        <span
                          className="h-3 w-3 shrink-0 rounded-[6px] border"
                          style={projectIndicatorStyle}
                        />
                      ) : (
                        <span className="h-3 w-3 shrink-0 rounded-[6px] border border-muted-foreground/50 bg-muted" />
                      )}
                      <span className="truncate text-sm font-medium">
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

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Agent & Model</Label>
                <AgentModelChooserButton
                  ticketId={ticketId}
                  initialSelection={null}
                  disabled={isSubmitting}
                  onSelectionChange={setSelection}
                  persistSelection={false}
                />
              </div>
            </div>

            {/* Objective textarea */}
            <div className="relative flex flex-1 flex-col">
              <Label htmlFor="quick-run-objective" className="mb-2 block text-sm font-medium">
                Objective
              </Label>
              <MentionableTextarea
                ref={textareaRef}
                id="quick-run-objective"
                value={objective}
                onValueChange={setObjective}
                mentionPaths={effectiveMentionPaths}
                onChange={() => autoResize()}
                onMentionSelect={() => {
                  requestAnimationFrame(() => autoResize());
                }}
                placeholder="Describe what needs to be done…"
                className={cn(
                  'w-full min-h-24 flex-1 rounded-md border border-border/40 bg-background px-3 py-2 text-sm',
                  'focus:outline-none focus:ring-1 focus:ring-ring/40',
                  'resize-none leading-relaxed',
                  'sm:min-h-32'
                )}
                disabled={isCreating || isSubmitting}
              />
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
            text="Run"
            loadingText="Launching…"
            successText="Launched"
            errorText="Failed"
            onClick={handleSubmit}
            disabled={isCreating || !objective.trim() || !ticketId || !selectionLoaded}
            className="flex-1 sm:flex-none"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
