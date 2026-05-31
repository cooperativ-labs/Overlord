'use client';

import { ArrowUp, Bot, Loader2, Plus, User, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AgentModelChooserTrigger } from '@/components/features/AgentModelChooserTrigger';
import {
  AgentModelSelector,
  useAgentModelPreference
} from '@/components/features/AgentModelSelector';
import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useWorkspaceFileTree } from '@/components/features/projects/useWorkspaceFileTree';
import { useWorkspacePreference } from '@/components/features/projects/useWorkspacePreference';
import { useTerminal } from '@/components/features/terminal/TerminalProvider';
import {
  finalizeObjectiveAttachmentUploadAction,
  prepareObjectiveAttachmentUploadAction
} from '@/lib/actions/attachments';
import { generateTicketTitleAction } from '@/lib/actions/generate-title';
import { requestTicketObjectiveExecutionAction } from '@/lib/actions/tickets';
import {
  useCreateTicketMutation,
  useUpdateTicketAssignmentMutation,
  useUpdateTicketFieldsMutation,
  useUpdateTicketForHumanMutation
} from '@/lib/client-data/tickets/mutations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { isLaunchAgentTypeValue } from '@/lib/helpers/agent-types';
import { dispatchTicketCreatedEvent } from '@/lib/helpers/ticket-board-events';
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
  local_working_directory?: string | null;
  ssh_command?: string | null;
  remote_working_directory?: string | null;
};

type QuickTaskBarProps = {
  defaultProjectId: string | null;
  projects: ProjectOption[];
  sshEnabled?: boolean;
};

type StagedFile = {
  id: string;
  file: File;
};

type QuickTaskWindowApi = {
  close: () => Promise<unknown>;
  setHeight: (height: number) => Promise<unknown>;
  setBounds?: (args: { height: number; barOffsetTop: number }) => Promise<unknown>;
  onShown: (cb: () => void) => () => void;
};

type IdleCallbackHandle = number;
type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};
type IdleScheduler = {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: { timeout: number }
  ) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
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

export function QuickTaskBar({ defaultProjectId, projects, sshEnabled }: QuickTaskBarProps) {
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() =>
    resolveProjectId(projects, defaultProjectId)
  );
  const [forHuman, setForHuman] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeMenu, setActiveMenu] = useState<null | 'project' | 'model'>(null);
  const [mentionPathsEnabled, setMentionPathsEnabled] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);

  const { selection: defaultSelection, loaded: selectionLoaded } = useAgentModelPreference();
  const [objectiveSelection, setObjectiveSelection] = useState(defaultSelection);
  const { isElectron } = useTerminal();
  const createTicketMutation = useCreateTicketMutation();
  const updateAssignmentMutation = useUpdateTicketAssignmentMutation();
  const updateFieldsMutation = useUpdateTicketFieldsMutation();
  const updateForHumanMutation = useUpdateTicketForHumanMutation();

  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const resolvedDefaultProjectId = resolveProjectId(projects, defaultProjectId);
  const workspace = useWorkspacePreference({
    projectId: selectedProject?.id ?? null,
    workingDirectory: selectedProject?.local_working_directory ?? null,
    sshCommand: selectedProject?.ssh_command ?? null,
    remoteWorkingDirectory: selectedProject?.remote_working_directory ?? null,
    isElectron,
    sshEnabled
  });

  const { files: mentionPaths } = useWorkspaceFileTree({
    workingDirectory: workspace.effectiveWorkingDirectory,
    enabled: mentionPathsEnabled
  });

  useEffect(() => {
    if (mentionPathsEnabled) return;
    const scheduler = window as Window & IdleScheduler;
    if (typeof scheduler.requestIdleCallback === 'function') {
      const handle = scheduler.requestIdleCallback(
        () => {
          setMentionPathsEnabled(true);
        },
        { timeout: 1500 }
      );
      return () => {
        scheduler.cancelIdleCallback?.(handle);
      };
    }

    const timeoutId = window.setTimeout(() => {
      setMentionPathsEnabled(true);
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [mentionPathsEnabled]);

  useEffect(() => {
    if (!mentionPathsEnabled && objective.includes('@')) {
      setMentionPathsEnabled(true);
    }
  }, [mentionPathsEnabled, objective]);

  // Auto-resize textarea + window height.
  // We send the bar's offsetTop so the Electron host can pin the bar to a
  // constant screen Y — text above grows the window upward, menus below grow
  // it downward, but the bar itself never shifts on screen.
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;

    const container = containerRef.current;
    const bar = controlBarRef.current;
    const api = getQuickTaskApi();
    if (!container || !api) return;

    if (bar && typeof api.setBounds === 'function') {
      const containerTop = container.getBoundingClientRect().top;
      const barTop = bar.getBoundingClientRect().top;
      api
        .setBounds({
          height: container.offsetHeight,
          barOffsetTop: Math.round(barTop - containerTop)
        })
        .catch(() => {});
    } else {
      api.setHeight(container.offsetHeight).catch(() => {});
    }
  }, []);

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
  }, [autoResize, objective, stagedFiles.length, activeMenu, objectiveSelection]);

  // Focus the field on mount and after inline menus close — not while a panel is open.
  useEffect(() => {
    if (activeMenu) return;
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      autoResize();
    });
  }, [activeMenu, autoResize]);

  // Re-focus when window is reshown
  useEffect(() => {
    const api = getQuickTaskApi();
    if (!api) return;
    const off = api.onShown(() => {
      requestAnimationFrame(() => {
        setSelectedProjectId(resolvedDefaultProjectId);
        setObjectiveSelection(defaultSelection);
        setActiveMenu(null);
        textareaRef.current?.focus();
        autoResize();
      });
    });
    return () => {
      off?.();
    };
  }, [autoResize, defaultSelection, resolvedDefaultProjectId]);

  const handleClose = useCallback(() => {
    const api = getQuickTaskApi();
    if (api) {
      api.close().catch(() => {});
      return;
    }
    setObjective('');
  }, []);

  // Escape closes an open inline menu first, otherwise the window
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (activeMenu) {
          setActiveMenu(null);
          return;
        }
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMenu, handleClose]);

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

  const handleMentionMenuOpenChange = useCallback(() => {
    requestAnimationFrame(() => autoResize());
  }, [autoResize]);

  async function uploadStagedFiles(ticketId: string, objectiveId: string): Promise<void> {
    if (stagedFiles.length === 0) return;
    try {
      const supabase = createClient();
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

  async function handleSubmit(shouldLaunch = false) {
    const trimmed = objective.trim();
    if (!trimmed || !selectedProject || isSubmitting || !selectionLoaded) return;

    setIsSubmitting(true);
    const clientTicketId = crypto.randomUUID();
    const filesToUpload = stagedFiles;

    try {
      const createdTicket = await createTicketMutation.mutateAsync({
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
          for_human: forHuman,
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

      dispatchTicketCreatedEvent({
        ticketId: createdTicket.id,
        organizationId: createdTicket.organizationId,
        projectId: createdTicket.projectId
      });

      // Background tasks: assignment, execution target, title, attachments
      if (shouldLaunch && isLaunchAgentTypeValue(objectiveSelection.agent) && !forHuman) {
        try {
          await updateAssignmentMutation.mutateAsync({
            ticketId: createdTicket.id,
            selection: objectiveSelection,
            objectiveId: createdTicket.objectiveId
          });

          const result = await requestTicketObjectiveExecutionAction({
            ticketId: createdTicket.id,
            objectiveId: createdTicket.objectiveId,
            workingDirectory:
              workspace.executionWorkspace === 'local'
                ? (workspace.effectiveWorkingDirectory ?? null)
                : null,
            sshCommand:
              workspace.executionWorkspace === 'ssh'
                ? (workspace.effectiveSshCommand ?? null)
                : null,
            remoteWorkingDirectory:
              workspace.executionWorkspace === 'ssh'
                ? (workspace.effectiveRemoteWorkingDirectory ?? null)
                : null
          });
          if ('error' in result) {
            throw new Error(result.error);
          }
        } catch (error) {
          console.error('Failed to queue execution:', error);
          toast.error('Failed to queue execution.', {
            description:
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : 'Check your runner configuration and try again.'
          });
        }
      }

      void (async () => {
        try {
          if (!forHuman && !shouldLaunch) {
            await updateAssignmentMutation.mutateAsync({
              ticketId: createdTicket.id,
              selection: objectiveSelection,
              objectiveId: createdTicket.objectiveId
            });
          } else if (forHuman) {
            await updateForHumanMutation.mutateAsync({
              ticketId: createdTicket.id,
              forHuman: true
            });
          }

          const title = await generateTicketTitleActionWithRetry(trimmed);
          await updateFieldsMutation.mutateAsync({
            ticketId: createdTicket.id,
            patch: { title }
          });
        } catch (error) {
          console.error('Failed to finalize ticket:', error);
        }

        if (filesToUpload.length > 0) {
          await uploadStagedFiles(createdTicket.id, createdTicket.objectiveId);
        }
      })();
      setObjective('');
      setStagedFiles([]);
      handleClose();
    } catch (error) {
      console.error('Failed to create ticket:', error);
      toast.error('Failed to create ticket.');
    } finally {
      setObjectiveSelection(defaultSelection);
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit(event.metaKey);
    }
  }

  const canSubmit = !!objective.trim() && !isSubmitting && !!selectedProject && selectionLoaded;

  // Drag-to-move support: container is a drag region (only inside Electron via
  // the html[data-electron] gate); interactive children opt out so clicks and
  // text selection still work.
  return (
    <div
      ref={containerRef}
      className="electron-drag-region flex w-full flex-col gap-2 bg-neutral-50 dark:bg-neutral-900"
    >
      <div
        className={cn(
          'flex w-full flex-col gap-2 rounded-2xl border border-border/40',
          'bg-background/95 px-4 py-3 shadow-2xl backdrop-blur-md'
        )}
      >
        <MentionableTextarea
          ref={textareaRef}
          autoListContinuation="shift-enter"
          value={objective}
          onValueChange={nextValue => {
            setObjective(nextValue);
            autoResize();
          }}
          onMentionSelect={() => {
            requestAnimationFrame(() => autoResize());
          }}
          mentionPaths={mentionPaths}
          mentionMenuMode="inline"
          onMentionMenuOpenChange={handleMentionMenuOpenChange}
          onKeyDown={handleKeyDown}
          placeholder="Write an objective"
          rows={1}
          containerClassName="electron-no-drag"
          menuClassName="electron-no-drag"
          className={cn(
            'w-full resize-none border-none bg-transparent text-base leading-relaxed',
            'focus:outline-none focus:ring-0',
            'placeholder:text-muted-foreground/70'
          )}
          disabled={isSubmitting}
        />

        {stagedFiles.length > 0 ? (
          <div className="electron-no-drag flex flex-wrap gap-1.5">
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

        <div
          ref={controlBarRef}
          className="electron-no-drag flex items-center justify-between gap-2"
        >
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

            {/* Project chooser — opens inline panel below */}
            <button
              type="button"
              aria-label="Choose project"
              aria-expanded={activeMenu === 'project'}
              onClick={() => setActiveMenu(current => (current === 'project' ? null : 'project'))}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                activeMenu === 'project' && 'bg-muted text-foreground'
              )}
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

            {/* Human/Agent toggle */}
            <div className="ml-1 flex items-center rounded-full border border-border/40 bg-muted/40 p-0.5">
              <button
                type="button"
                aria-label="Assign to agent"
                onClick={() => setForHuman(false)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                  !forHuman
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Bot className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Assign to human"
                onClick={() => setForHuman(true)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
                  forHuman
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <User className="h-3.5 w-3.5" />
              </button>
            </div>

            <AgentModelChooserTrigger
              selection={objectiveSelection}
              active={activeMenu === 'model'}
              onToggle={() => setActiveMenu(current => (current === 'model' ? null : 'model'))}
              disabled={isSubmitting}
              className="border-0 bg-transparent px-2 shadow-none hover:bg-muted"
            />
          </div>

          {/* Send */}
          <button
            type="button"
            aria-label={isSubmitting ? 'Submitting' : 'Send'}
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground/60'
            )}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {activeMenu === 'project' ? (
        <div className="electron-no-drag max-h-[260px] overflow-y-auto rounded-xl border  bg-background/95 p-1  backdrop-blur-md m-4">
          {projects.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">No projects</div>
          ) : (
            projects.map(project => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setSelectedProjectId(project.id);
                  setActiveMenu(null);
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
        </div>
      ) : null}

      {activeMenu === 'model' ? (
        <div className="electron-no-drag rounded-xl border  bg-background/95 p-2  backdrop-blur-md m-4">
          <AgentModelSelector value={objectiveSelection} onChange={setObjectiveSelection} />
        </div>
      ) : null}
    </div>
  );
}
