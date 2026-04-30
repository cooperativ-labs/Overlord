'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AgentModelChooserButton } from '@/components/features/AgentModelChooserButton';
import { useAgentModelPreference } from '@/components/features/AgentModelSelector';
import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useWorkspaceFileTree } from '@/components/features/projects/useWorkspaceFileTree';
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

type NewTicketModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  organizationId?: number;
  projects: ProjectOption[];
  fileMentionPaths?: string[];
};

export function NewTicketModal({
  isOpen,
  onOpenChange,
  defaultProjectId,
  organizationId,
  projects,
  fileMentionPaths = EMPTY_FILE_MENTION_PATHS
}: NewTicketModalProps) {
  const resolvedDefaultProjectId = defaultProjectId ?? PERSONAL_PROJECT_VALUE;
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(resolvedDefaultProjectId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitButtonState, setSubmitButtonState] = useState<ButtonLoadingState>('default');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Auto-resize textarea
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

  // Focus textarea once ticket creation finishes and textarea is rendered
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        (textareaRef.current as EditableTextareaHandle | null)?.focus();
        autoResize();
      });
    }
  }, [isOpen, autoResize]);

  function handleChange() {
    autoResize();
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitButtonState('loading');

    try {
      const isPersonalTicket = selectedProjectId === PERSONAL_PROJECT_VALUE;
      const selectedProject = isPersonalTicket
        ? null
        : (projects.find(p => p.id === selectedProjectId) ?? null);
      // For project tickets the org is always the project's org. For personal
      // tickets we require an explicit org from the route/scope: in All-orgs
      // mode there is no canonical default, so creation must not silently
      // fall back to projects[0]'s org.
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
          status: 'draft',
          priority: 'medium',
          execution_target: 'agent',
          assigned_agent: null,
          board_position: 0,
          waiting_for_response_at: null,
          has_unopened_waiting_response: false,
          is_read: true
        },
        status: 'draft',
        objective: trimmedObjective,
        organizationId,
        projectId: isPersonalTicket ? null : selectedProjectId,
        placement: 'top',
        generateServerTitle: false
      });

      setSubmitButtonState('success');
      onOpenChange(false);

      // Reset state for next use
      setObjective('');
      setSelectedProjectId(resolvedDefaultProjectId);
      setSubmitButtonState('default');

      void (async () => {
        try {
          await createPromise;
          await updateAssignmentMutation.mutateAsync({ ticketId: clientTicketId, selection });
          if (trimmedObjective) {
            const title = await generateTicketTitleActionWithRetry(trimmedObjective);
            await updateFieldsMutation.mutateAsync({
              ticketId: clientTicketId,
              patch: { title, objective: trimmedObjective }
            });
          }
        } catch (error) {
          console.error('Failed to finish ticket creation:', error);
          toast.error('Failed to create ticket.');
        }
      })();
    } catch (error) {
      setSubmitButtonState('error');
      console.error('Failed to submit ticket:', error);
      toast.error('Failed to create ticket.');
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
          <DialogTitle>New Ticket</DialogTitle>
          <DialogDescription>
            Create a new private personal ticket or assign it to a project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto sm:flex-1 sm:min-h-0">
          <div className="flex gap-3">
            <div className="flex flex-col gap-2">
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
              <Label className="text-sm font-medium">Agent &amp; Model</Label>
              <AgentModelChooserButton
                ticketId={null}
                initialSelection={selection}
                disabled={isSubmitting}
                onSelectionChange={setSelection}
                persistSelection={false}
              />
            </div>
          </div>

          {/* Objective textarea */}
          <div className="relative flex flex-1 flex-col">
            <Label htmlFor="ticket-objective" className="mb-2 block text-sm font-medium">
              Objective
            </Label>
            <MentionableTextarea
              ref={textareaRef}
              id="ticket-objective"
              value={objective}
              onValueChange={setObjective}
              mentionPaths={effectiveMentionPaths}
              onChange={handleChange}
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

        <DialogFooter className="mt-2 flex-shrink-0 gap-2 sm:mt-4">
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
            text="Create Ticket"
            loadingText="Creating…"
            successText="Created"
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
