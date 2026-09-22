import {
  AlertTriangle,
  ArrowUp,
  Bot,
  ChevronDown,
  FolderOpen,
  Loader2,
  Play,
  Plus
} from 'lucide-react';

import { AgentIcon } from '@/components/objectives/AgentIcon.tsx';
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea.tsx';
import { cn } from '@/lib/utils';

import { AgentModelPickerPanel } from './AgentModelPickerPanel.tsx';
import { ProjectPickerPanel } from './ProjectPickerPanel.tsx';
import { ResourcePickerPanel } from './ResourcePickerPanel.tsx';
import { StagedFilesRow } from './StagedFilesRow.tsx';
import { useQuickTaskBar } from './use-quick-task-bar.ts';

type QuickTaskBarProps = {
  defaultProjectId?: string | null;
};

export function QuickTaskBar({ defaultProjectId = null }: QuickTaskBarProps) {
  const {
    isLoadingProjects,
    projects,
    lastManualProjectIdRef,
    objective,
    setObjective,
    selectedProjectId,
    setSelectedProjectId,
    stagedFiles,
    isSubmitting,
    activeMenu,
    setActiveMenu,
    selectedResourceKey,
    setSelectedResourceKey,
    submitError,
    fileInputRef,
    containerRef,
    controlBarRef,
    selectedProject,
    catalog,
    agentConfigs,
    selectionLoaded,
    objectiveSelection,
    setExplicitLaunchConfigs,
    selectedAgentFullLabel,
    selectedAgentIconKey,
    hasSelectedAgentIcon,
    primaryConnection,
    resources,
    hasMultipleResources,
    selectedResourceLabel,
    targetAvailability,
    selectProject,
    autoResize,
    handleFilesSelected,
    handleRemoveFile,
    handleMentionMenuOpenChange,
    handleSelectionChange,
    handleSubmit,
    handleKeyDown,
    canSubmit,
    canLaunch
  } = useQuickTaskBar(defaultProjectId);

  if (isLoadingProjects) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading projects…
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="electron-drag-region flex w-full flex-col gap-2 bg-neutral-50 dark:bg-neutral-900"
    >
      <div
        className={cn(
          'flex w-full flex-col gap-2 rounded-2xl border border-border/40',
          'bg-neutral-50/95 px-4 py-3 shadow-2xl backdrop-blur-md',
          'overflow-hidden'
        )}
      >
        <RepositoryMentionTextarea
          autoListContinuation="shift-enter"
          projectId={selectedProject?.id ?? ''}
          value={objective}
          onValueChange={nextValue => {
            setObjective(nextValue);
            autoResize();
          }}
          projectMentionOptions={projects}
          projectMentionSelectionBehavior="select"
          onProjectMentionSelect={project => {
            selectProject(project.id);
          }}
          onMentionSelect={() => {
            requestAnimationFrame(() => autoResize());
          }}
          mentionMenuMode="inline"
          onMentionMenuOpenChange={handleMentionMenuOpenChange}
          onKeyDown={handleKeyDown}
          placeholder="Write an objective (# selects project)"
          rows={1}
          containerClassName="electron-no-drag"
          menuClassName="electron-no-drag"
          className={cn(
            'w-full resize-none border-none bg-transparent text-base leading-relaxed shadow-none',
            'focus:outline-none focus:ring-0',
            'placeholder:text-muted-foreground/70'
          )}
          disabled={isSubmitting}
        />

        <StagedFilesRow stagedFiles={stagedFiles} onRemoveFile={handleRemoveFile} />

        <div ref={controlBarRef} className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 ">
            <button
              type="button"
              aria-label="Attach files"
              onClick={() => fileInputRef.current?.click()}
              className="electron-no-drag flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              disabled={!selectedProject || isSubmitting}
            >
              <Plus className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden electron-no-drag"
              multiple
              onChange={event => {
                handleFilesSelected(event.target.files);
                event.target.value = '';
              }}
            />

            <button
              type="button"
              aria-label="Choose project"
              aria-expanded={activeMenu === 'project'}
              onClick={() => setActiveMenu(current => (current === 'project' ? null : 'project'))}
              className={cn(
                'electron-no-drag',
                'flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                activeMenu === 'project' && 'bg-muted text-foreground'
              )}
            >
              {selectedProject ? (
                <span
                  className="h-3 w-3 rounded-[4px] border"
                  style={{
                    backgroundColor: selectedProject.color ?? undefined,
                    borderColor: selectedProject.color ?? undefined
                  }}
                />
              ) : (
                <span className="h-3 w-3 rounded-[4px] border border-border bg-muted" />
              )}
              <span className="max-w-[110px] truncate text-foreground/80">
                {selectedProject?.name ?? 'No project'}
              </span>
            </button>

            {hasMultipleResources ? (
              <button
                type="button"
                aria-label={`Choose resource: ${selectedResourceLabel ?? 'default'}`}
                aria-expanded={activeMenu === 'resource'}
                title={selectedResourceLabel ?? undefined}
                onClick={() =>
                  setActiveMenu(current => (current === 'resource' ? null : 'resource'))
                }
                disabled={isSubmitting}
                className={cn(
                  'electron-no-drag flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm text-muted-foreground transition-colors',
                  activeMenu === 'resource' && 'bg-muted text-foreground',
                  isSubmitting
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-muted hover:text-foreground'
                )}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[110px] truncate text-foreground/80">
                  {selectedResourceLabel}
                </span>
              </button>
            ) : null}

            {selectedProject ? (
              <button
                type="button"
                aria-label={`Choose agent and model: ${selectedAgentFullLabel}`}
                aria-expanded={activeMenu === 'agent'}
                title={selectedAgentFullLabel}
                onClick={() => setActiveMenu(current => (current === 'agent' ? null : 'agent'))}
                disabled={isSubmitting || !catalog}
                className={cn(
                  'electron-no-drag flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground shadow-sm transition-colors',
                  activeMenu === 'agent' && 'bg-muted text-foreground',
                  isSubmitting || !catalog
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:bg-muted hover:text-foreground'
                )}
              >
                {hasSelectedAgentIcon ? (
                  <AgentIcon
                    agentKey={selectedAgentIconKey}
                    size={14}
                    alt=""
                    className="h-3.5 w-3.5 shrink-0"
                  />
                ) : (
                  <Bot className="h-3.5 w-3.5 shrink-0" />
                )}
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {selectedProject ? (
              <button
                type="button"
                aria-label={isSubmitting ? 'Submitting' : 'Run'}
                title="Save and run (cmd+enter)"
                onClick={() => void handleSubmit(true)}
                disabled={!canLaunch}
                className={cn(
                  'electron-no-drag flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
                  canLaunch
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-muted text-muted-foreground/60'
                )}
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <div className="flex items-center gap-1">
                    <Play className="h-3.5 w-3.5" /> Run
                  </div>
                )}
              </button>
            ) : null}

            <button
              type="button"
              aria-label={isSubmitting ? 'Submitting' : 'Save'}
              title="Save (Enter)"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className={cn(
                'electron-no-drag flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors',
                canSubmit
                  ? 'bg-emerald-600 text-white hover:bg-emerald-600/90'
                  : 'bg-muted text-muted-foreground/60'
              )}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <div className="flex items-center gap-1">
                  <ArrowUp className="h-3.5 w-3.5" /> Save
                </div>
              )}
            </button>
          </div>
        </div>

        {submitError ? <p className="text-xs text-red-400">{submitError}</p> : null}
        {!primaryConnection.connected && selectionLoaded ? (
          <div
            role="alert"
            className="electron-no-drag flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>{primaryConnection.message}</p>
          </div>
        ) : !targetAvailability.available && selectionLoaded ? (
          <div
            role="alert"
            className="electron-no-drag flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>{targetAvailability.message}</p>
          </div>
        ) : null}
      </div>

      {activeMenu === 'project' ? (
        <ProjectPickerPanel
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={projectId => {
            selectProject(projectId);
            setActiveMenu(null);
          }}
          onSelectInbox={() => {
            lastManualProjectIdRef.current = null;
            setSelectedProjectId('');
            setSelectedResourceKey(null);
            setActiveMenu(null);
          }}
        />
      ) : activeMenu === 'resource' && hasMultipleResources ? (
        <ResourcePickerPanel
          resources={resources}
          value={selectedResourceKey}
          onSelect={resourceKey => {
            setSelectedResourceKey(resourceKey);
            setActiveMenu(null);
          }}
        />
      ) : activeMenu === 'agent' && selectedProject && catalog ? (
        <AgentModelPickerPanel
          catalog={catalog}
          selection={objectiveSelection}
          onChange={handleSelectionChange}
          agentConfigs={agentConfigs}
          onLaunchConfigCommit={(agentKey, config) => {
            setExplicitLaunchConfigs(previous => ({ ...previous, [agentKey]: config }));
          }}
        />
      ) : null}
    </div>
  );
}
