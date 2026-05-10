'use client';

import { ArrowUp, Bot, Plus, User, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AgentModelChooserButton } from '@/components/features/AgentModelChooserButton';
import { useAgentModelPreference } from '@/components/features/AgentModelSelector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  finalizeObjectiveAttachmentUploadAction,
  prepareObjectiveAttachmentUploadAction
} from '@/lib/actions/attachments';
import { generateTicketTitleAction } from '@/lib/actions/generate-title';
import {
  useCreateTicketMutation,
  useUpdateTicketAssignmentMutation,
  useUpdateTicketExecutionTargetMutation,
  useUpdateTicketFieldsMutation
} from '@/lib/client-data/tickets/mutations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { deriveTitleFromObjective } from '@/lib/helpers/tickets';
import { cn } from '@/lib/utils';
import { createClient } from '@/supabase/utils/client';

const generateTicketTitleActionWithRetry = withElectronActionRetry(generateTicketTitleAction);

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
  organization_id: number;
};

type ExecutionTarget = 'agent' | 'human';

type QuickTaskBarProps = {
  defaultProjectId: string | null;
  projects: ProjectOption[];
};

type StagedFile = {
  id: string;
  file: File;
};

type QuickTaskWindowApi = {
  close: () => Promise<unknown>;
  setHeight: (height: number) => Promise<unknown>;
  onShown: (cb: () => void) => () => void;
};

function getQuickTaskApi(): QuickTaskWindowApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { quickTask?: QuickTaskWindowApi } })
    .electronAPI;
  return api?.quickTask ?? null;
}

function resolveProjectId(projects: ProjectOption[], defaultProjectId: string | null): string {
  if (defaultProjectId && projects.some(project => project.id === defaultProjectId)) {
    return defaultProjectId;
  }
  return projects[0]?.id ?? '';
}

export function QuickTaskBar({ defaultProjectId, projects }: QuickTaskBarProps) {
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() =>
    resolveProjectId(projects, defaultProjectId)
  );
  const [executionTarget, setExecutionTarget] = useState<ExecutionTarget>('agent');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { selection, setSelection, loaded: selectionLoaded } = useAgentModelPreference();
  const createTicketMutation = useCreateTicketMutation();
  const updateAssignmentMutation = useUpdateTicketAssignmentMutation();
  const updateFieldsMutation = useUpdateTicketFieldsMutation();
  const updateExecutionTargetMutation = useUpdateTicketExecutionTargetMutation();

  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const resolvedDefaultProjectId = resolveProjectId(projects, defaultProjectId);

  // Auto-resize textarea + window height
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;

    const container = containerRef.current;
    const api = getQuickTaskApi();
    if (container && api) {
      const chooserAllowance = projectMenuOpen || modelMenuOpen ? 360 : 0;
      const target = container.offsetHeight + chooserAllowance;
      api.setHeight(target).catch(() => {});
    }
  }, [modelMenuOpen, projectMenuOpen]);

  useEffect(() => {
    setSelectedProjectId(current => {
      if (current && projects.some(project => project.id === current)) {
        return current;
      }
      return resolvedDefaultProjectId;
    });
  }, [projects, resolvedDefaultProjectId]);

  useEffect(() => {
    autoResize();
  }, [autoResize, stagedFiles.length]);

  useEffect(() => {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autoResize();
    });
  }, [autoResize]);

  // Re-focus when window is reshown
  useEffect(() => {
    const api = getQuickTaskApi();
    if (!api) return;
    const off = api.onShown(() => {
      requestAnimationFrame(() => {
        setSelectedProjectId(resolvedDefaultProjectId);
        setProjectMenuOpen(false);
        setModelMenuOpen(false);
        textareaRef.current?.focus();
        autoResize();
      });
    });
    return () => {
      off?.();
    };
  }, [autoResize, resolvedDefaultProjectId]);

  const handleClose = useCallback(() => {
    const api = getQuickTaskApi();
    if (api) {
      api.close().catch(() => {});
      return;
    }
    setObjective('');
  }, []);

  // Escape closes the window
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const handleFilesSelected = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const next = Array.from(fileList).map(file => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`,
      file
    }));
    setStagedFiles(prev => [...prev, ...next]);
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setStagedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  async function uploadStagedFiles(ticketId: string): Promise<void> {
    if (stagedFiles.length === 0) return;
    try {
      const supabase = createClient();
      const { data: objectiveRow } = await supabase
        .from('objectives')
        .select('id')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const objectiveId = objectiveRow?.id;
      if (!objectiveId) return;

      await Promise.all(
        stagedFiles.map(async ({ file }) => {
          const draft = await prepareObjectiveAttachmentUploadAction(ticketId, objectiveId, {
            contentType: file.type || 'application/octet-stream',
            fileName: file.name,
            fileSize: file.size
          });
          const { error: uploadError } = await supabase.storage
            .from('artifacts')
            .uploadToSignedUrl(draft.storagePath, draft.token, file, {
              cacheControl: '3600',
              contentType: draft.contentType,
              upsert: false
            });
          if (uploadError) throw new Error(uploadError.message ?? 'Failed to upload file.');
          await finalizeObjectiveAttachmentUploadAction(ticketId, objectiveId, {
            contentType: draft.contentType,
            fileSize: draft.fileSize,
            label: draft.label,
            storagePath: draft.storagePath
          });
        })
      );
    } catch (error) {
      console.error('Failed to upload attachments:', error);
      toast.error('Some attachments failed to upload.');
    }
  }

  async function handleSubmit() {
    const trimmed = objective.trim();
    if (!trimmed || !selectedProject || isSubmitting || !selectionLoaded) return;

    setIsSubmitting(true);
    const clientTicketId = crypto.randomUUID();
    const filesToUpload = stagedFiles;

    try {
      await createTicketMutation.mutateAsync({
        optimisticTicket: {
          id: clientTicketId,
          title: deriveTitleFromObjective(trimmed),
          objective: trimmed,
          organization_id: selectedProject.organization_id,
          project_id: selectedProject.id,
          project_name: selectedProject.name,
          project_color: selectedProject.color,
          project_everhour_project_id: selectedProject.everhour_project_id,
          everhour_task_id: null,
          agent_session_state: null,
          status: 'draft',
          priority: 'medium',
          execution_target: executionTarget,
          assigned_agent: null,
          board_position: 0,
          waiting_for_response_at: null,
          has_unopened_waiting_response: false,
          is_read: true
        },
        status: 'draft',
        objective: trimmed,
        organizationId: selectedProject.organization_id,
        projectId: selectedProject.id,
        placement: 'top',
        generateServerTitle: false
      });

      // Background tasks: assignment, execution target, title, attachments
      void (async () => {
        try {
          if (executionTarget === 'agent') {
            await updateAssignmentMutation.mutateAsync({ ticketId: clientTicketId, selection });
          } else {
            await updateExecutionTargetMutation.mutateAsync({
              ticketId: clientTicketId,
              executionTarget: 'human'
            });
          }

          const title = await generateTicketTitleActionWithRetry(trimmed);
          await updateFieldsMutation.mutateAsync({
            ticketId: clientTicketId,
            patch: { title, objective: trimmed }
          });
        } catch (error) {
          console.error('Failed to finalize ticket:', error);
        }

        if (filesToUpload.length > 0) {
          await uploadStagedFiles(clientTicketId);
        }
      })();

      toast.success('Ticket created');
      setObjective('');
      setStagedFiles([]);
      handleClose();
    } catch (error) {
      console.error('Failed to create ticket:', error);
      toast.error('Failed to create ticket.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  }

  const canSubmit = !!objective.trim() && !isSubmitting && !!selectedProject && selectionLoaded;

  return (
    <div className="flex h-full w-full items-start justify-center p-0">
      <div
        ref={containerRef}
        className={cn(
          'flex w-full flex-col gap-2 rounded-2xl border border-border/40',
          'bg-background/95 px-4 py-3 shadow-2xl backdrop-blur-md'
        )}
      >
        <textarea
          ref={textareaRef}
          value={objective}
          onChange={event => {
            setObjective(event.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything"
          rows={1}
          className={cn(
            'w-full resize-none border-none bg-transparent text-base leading-relaxed',
            'focus:outline-none focus:ring-0',
            'placeholder:text-muted-foreground/70'
          )}
          disabled={isSubmitting}
        />

        {stagedFiles.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {stagedFiles.map(({ id, file }) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/60 px-2.5 py-0.5 text-xs"
              >
                <span className="max-w-[180px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {/* File upload */}
            <button
              type="button"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={event => {
                handleFilesSelected(event.target.files);
                event.target.value = '';
              }}
            />

            {/* Project chooser */}
            <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Choose project"
                  className="flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {selectedProject ? (
                    <span
                      className="h-3 w-3 rounded-[4px] border"
                      style={{
                        backgroundColor: selectedProject.color,
                        borderColor: selectedProject.color
                      }}
                    />
                  ) : (
                    <span className="h-3 w-3 rounded-[4px] border border-border bg-muted" />
                  )}
                  <span className="max-w-[110px] truncate text-foreground/80">
                    {selectedProject?.name ?? 'No project'}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={8}
                className="max-h-[260px] w-56 overflow-y-auto p-1"
              >
                {projects.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">No projects</div>
                ) : (
                  projects.map(project => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => {
                        setSelectedProjectId(project.id);
                        setProjectMenuOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                        project.id === selectedProjectId && 'bg-muted/60'
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-[4px] border"
                        style={{
                          backgroundColor: project.color,
                          borderColor: project.color
                        }}
                      />
                      <span className="truncate">{project.name}</span>
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>

            {/* Human/Agent toggle */}
            <div className="ml-1 flex items-center rounded-full border border-border/40 bg-muted/40 p-0.5">
              <button
                type="button"
                aria-label="Assign to agent"
                onClick={() => setExecutionTarget('agent')}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                  executionTarget === 'agent'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Bot className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Assign to human"
                onClick={() => setExecutionTarget('human')}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                  executionTarget === 'human'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <User className="h-3.5 w-3.5" />
              </button>
            </div>

            <AgentModelChooserButton
              ticketId={null}
              initialSelection={selection}
              disabled={isSubmitting}
              onSelectionChange={setSelection}
              persistSelection={false}
              onOpenChange={setModelMenuOpen}
              className="border-0 bg-transparent px-2 shadow-none hover:bg-muted"
            />
          </div>

          {/* Send */}
          <button
            type="button"
            aria-label="Send"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground/60'
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
