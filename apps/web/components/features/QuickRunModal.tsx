'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { generateTicketTitleAction } from '@/lib/actions/generate-title';
import {
  useCreateTicketMutation,
  useUpdateTicketAssignmentMutation,
  useUpdateTicketFieldsMutation
} from '@/lib/client-data/tickets/mutations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { buildTicketPath } from '@/lib/helpers/ticket-path';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import type { EditableTextareaHandle } from '@/lib/types/text-control';
import { cn } from '@/lib/utils';

const EMPTY_FILE_MENTION_PATHS: string[] = [];
const PERSONAL_PROJECT_VALUE = '__personal__';
const generateTicketTitleActionWithRetry = withElectronActionRetry(generateTicketTitleAction);

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
  organization_id?: number;
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
  const resolvedDefaultProjectId = defaultProjectId ?? PERSONAL_PROJECT_VALUE;
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(resolvedDefaultProjectId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitButtonState, setSubmitButtonState] = useState<ButtonLoadingState>('default');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { launchAgent } = useTerminal();
  const { selection, setSelection, loaded: selectionLoaded } = useAgentModelPreference();
  const createTicketMutation = useCreateTicketMutation();
  const updateAssignmentMutation = useUpdateTicketAssignmentMutation();
  const updateFieldsMutation = useUpdateTicketFieldsMutation();

  const selectedProjectForFileTree =
    selectedProjectId === PERSONAL_PROJECT_VALUE
      ? null
      : projects.find(p => p.id === selectedProjectId);
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
    setSelectedProjectId(current => {
      if (isOpen && current) return current;
      return current === resolvedDefaultProjectId ? current : resolvedDefaultProjectId;
    });
  }, [isOpen, resolvedDefaultProjectId]);

  // Focus textarea once ticket creation finishes
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        (textareaRef.current as EditableTextareaHandle | null)?.focus();
        autoResize();
      });
    }
  }, [isOpen, autoResize]);

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitButtonState('loading');

    try {
      const isPersonalTicket = selectedProjectId === PERSONAL_PROJECT_VALUE;
      const selectedProject = isPersonalTicket
        ? null
        : (projects.find(p => p.id === selectedProjectId) ?? null);
      // Project tickets adopt the project's org. Personal tickets need an
      // explicit org from the calling route/scope; in All-orgs mode there is
      // no canonical default, so creation must surface a clear error rather
      // than silently picking projects[0].
      const resolvedOrganizationId = isPersonalTicket
        ? organizationId
        : selectedProject?.organization_id;
      if (!resolvedOrganizationId) {
        throw new Error(
          isPersonalTicket
            ? 'Select a workspace before creating a personal ticket.'
            : 'Project organization not found.'
        );
      }
      const trimmedObjective = objective.trim();
      const clientTicketId = crypto.randomUUID();

      const createPromise = createTicketMutation.mutateAsync({
        optimisticTicket: {
          id: clientTicketId,
          title: deriveTitleFromObjective(trimmedObjective),
          objective: trimmedObjective,
          organization_id: resolvedOrganizationId,
          project_id: isPersonalTicket ? null : selectedProjectId,
          project_name: isPersonalTicket ? 'Personal' : (selectedProject?.name ?? null),
          project_color: isPersonalTicket ? null : (selectedProject?.color ?? null),
          project_everhour_project_id: isPersonalTicket
            ? null
            : (selectedProject?.everhour_project_id ?? null),
          everhour_task_id: null,
          agent_session_state: null,
          status: 'next-up',
          priority: 'medium',
          execution_target: 'agent',
          assigned_agent: null,
          board_position: 0,
          waiting_for_response_at: null,
          has_unopened_waiting_response: false,
          is_read: true
        },
        status: 'next-up',
        objective: trimmedObjective,
        organizationId,
        projectId: isPersonalTicket ? null : selectedProjectId,
        placement: 'top',
        generateServerTitle: false
      });

      setSubmitButtonState('success');
      onOpenChange(false);

      // Reset for next use
      setObjective('');
      setSelectedProjectId(resolvedDefaultProjectId);
      setSubmitButtonState('default');

      void (async () => {
        try {
          const createdTicket = await createPromise;
          await updateAssignmentMutation.mutateAsync({ ticketId: createdTicket.id, selection });
          if (trimmedObjective) {
            const title = await generateTicketTitleActionWithRetry(trimmedObjective);
            await updateFieldsMutation.mutateAsync({
              ticketId: createdTicket.id,
              patch: { title, objective: trimmedObjective }
            });
          }

          await launchAgent({
            ticketId: createdTicket.id,
            agent: selection.agent,
            organizationId: createdTicket.organizationId,
            cwd: selectedProject?.local_working_directory ?? undefined,
            launchMode: 'run',
            model: selection.model ?? undefined,
            thinking: selection.thinking ?? undefined,
            projectId: isPersonalTicket ? undefined : selectedProjectId
          });
          router.push(
            buildTicketPath({
              projectId: isPersonalTicket ? null : selectedProjectId,
              ticketId: createdTicket.id
            })
          );
        } catch (error) {
          console.error('Failed to run ticket:', error);
          toast.error('Failed to launch agent', {
            description:
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'Check your terminal settings and sign in again, then try again.'
          });
        }
      })();
    } catch (error) {
      setSubmitButtonState('error');
      console.error('Failed to run ticket:', error);
      toast.error('Failed to launch agent', {
        description:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Check your terminal settings and sign in again, then try again.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
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

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto sm:flex-1 sm:min-h-0">
          <div className="flex gap-3">
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
                      {selectedProject?.name ?? 'Personal'}
                    </span>
                  </span>
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value={PERSONAL_PROJECT_VALUE}>No project / Personal</SelectItem>
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
                ticketId={null}
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
              disabled={isSubmitting}
            />
          </div>
        </div>

        <DialogFooter className="mt-2 shrink-0 gap-2 sm:mt-4">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
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
            disabled={!objective.trim() || isSubmitting || !selectedProject || !selectionLoaded}
            className="flex-1 sm:flex-none"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
