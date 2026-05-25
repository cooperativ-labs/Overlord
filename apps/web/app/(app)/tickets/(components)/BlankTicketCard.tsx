'use client';

import { Check, Tag } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { MentionableTextarea } from '@/components/features/MentionableTextarea';
import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { useWorkspaceFileTree } from '@/components/features/projects/useWorkspaceFileTree';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useProjectTagDefinitions } from '@/lib/client-data/tags/hooks';
import type { TextareaHandle } from '@/lib/types/text-control';
import { cn } from '@/lib/utils';

import { IsHumanToggle } from './IsHumanToggle';
import { ProjectColorDot } from './TicketCardPrimitives';
import type { BlankTicketCreateOptions } from './ticket-view-helpers';

type BlankTicketCardProps = {
  inputId: string;
  status: string;
  position: 'top' | 'bottom';
  expand?: boolean;
  closeOnSubmit?: boolean;
  boardProjectId?: string;
  fileMentionPaths: string[];
  workingDirectory?: string | null;
  onCreateTicket: (
    status: string,
    objective: string,
    position: 'top' | 'bottom',
    options?: BlankTicketCreateOptions
  ) => Promise<void> | void;
  onCreateAndOpenTicket?: (
    status: string,
    objective: string,
    position: 'top' | 'bottom',
    options?: BlankTicketCreateOptions
  ) => Promise<void> | void;
  onClose: () => void;
  onSubmitted?: () => void;
  focusTrigger?: number;
};

function resolveInitialProjectId({
  boardProjectId,
  defaultProjectId
}: {
  boardProjectId?: string;
  defaultProjectId: string | null;
}): string | null {
  if (boardProjectId) return boardProjectId;
  return defaultProjectId;
}

export default function BlankTicketCard({
  inputId,
  status,
  position,
  expand = true,
  closeOnSubmit = false,
  boardProjectId,
  fileMentionPaths,
  workingDirectory = null,
  onCreateTicket,
  onCreateAndOpenTicket,
  onClose,
  onSubmitted,
  focusTrigger = 0
}: BlankTicketCardProps) {
  const { defaultProject, defaultProjectId, projects } = useDefaultProject();
  const initialProjectId = resolveInitialProjectId({
    boardProjectId,
    defaultProjectId
  });
  const [value, setValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProjectId);
  const [forHuman, setForHuman] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const handleDismissRef = useRef<(currentValue: string) => Promise<void>>(async () => {});
  const instanceId = useId().replace(/:/g, '');
  const projectMenuScopeClass = `blank-ticket-project-menu-${instanceId}`;
  const tagMenuScopeClass = `blank-ticket-tag-menu-${instanceId}`;

  valueRef.current = value;

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );
  const selectedProjectWorkingDirectory =
    selectedProject?.localWorkingDirectory ?? workingDirectory ?? null;

  const { files: effectiveMentionPaths } = useWorkspaceFileTree({
    fileMentionPaths,
    workingDirectory: selectedProjectWorkingDirectory
  });

  const { data: tagDefinitions } = useProjectTagDefinitions(selectedProjectId);
  const activeTagDefinitions = useMemo(
    () => (tagDefinitions ?? []).filter(definition => definition.is_active),
    [tagDefinitions]
  );

  useEffect(() => {
    setSelectedProjectId(current => {
      if (current && projects.some(project => project.id === current)) {
        return current;
      }
      return resolveInitialProjectId({ boardProjectId, defaultProjectId });
    });
  }, [boardProjectId, defaultProjectId, projects]);

  useEffect(() => {
    setSelectedTagIds([]);
  }, [selectedProjectId]);

  useEffect(() => {
    if (focusTrigger === 0) return;
    const textArea = inputRef.current as TextareaHandle | null;
    if (!textArea) return;
    textArea.focus();
    const cursor = textArea.value.length;
    textArea.setSelectionRange(cursor, cursor);
  }, [focusTrigger]);

  const createOptions = useMemo<BlankTicketCreateOptions>(
    () => ({
      projectId: selectedProjectId,
      forHuman,
      tagDefinitionIds: selectedTagIds.length > 0 ? selectedTagIds : undefined
    }),
    [forHuman, selectedProjectId, selectedTagIds]
  );

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTagIds(current =>
      current.includes(tagId) ? current.filter(id => id !== tagId) : [...current, tagId]
    );
  }, []);

  const handleBlur = useCallback(
    async (currentValue: string) => {
      if (isCreating) return;
      const trimmed = currentValue.trim();
      onClose();
      setValue('');
      setForHuman(false);
      setSelectedTagIds([]);
      setSelectedProjectId(
        resolveInitialProjectId({ boardProjectId, defaultProjectId: defaultProject?.id ?? null })
      );
      if (trimmed) {
        setIsCreating(true);
        try {
          await onCreateTicket(status, trimmed, position, createOptions);
        } finally {
          setIsCreating(false);
        }
      }
    },
    [
      boardProjectId,
      createOptions,
      defaultProject?.id,
      isCreating,
      onCreateTicket,
      onClose,
      position,
      status
    ]
  );

  handleDismissRef.current = handleBlur;

  useEffect(() => {
    const isInsideCardUi = (target: Node) => {
      if (cardRef.current?.contains(target)) return true;
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(`.${projectMenuScopeClass}`) || target.closest(`.${tagMenuScopeClass}`)
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || isInsideCardUi(target)) return;

      const active = document.activeElement;
      const isThisCardFocused =
        active === inputRef.current || Boolean(cardRef.current?.contains(active));
      if (!isThisCardFocused) return;

      void handleDismissRef.current(valueRef.current);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [projectMenuScopeClass, tagMenuScopeClass]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        setValue('');
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (isCreating) return;
        const trimmed = e.currentTarget.value.trim();
        if (!trimmed) {
          onClose();
          setValue('');
          return;
        }
        setIsCreating(true);
        setValue('');
        try {
          if (e.metaKey && onCreateAndOpenTicket) {
            await onCreateAndOpenTicket(status, trimmed, position, createOptions);
          } else {
            await onCreateTicket(status, trimmed, position, createOptions);
          }
        } finally {
          setIsCreating(false);
        }
        setForHuman(false);
        setSelectedTagIds([]);
        setSelectedProjectId(
          resolveInitialProjectId({ boardProjectId, defaultProjectId: defaultProject?.id ?? null })
        );
        if (closeOnSubmit) {
          onClose();
        }
        onSubmitted?.();
      }
    },
    [
      boardProjectId,
      closeOnSubmit,
      createOptions,
      defaultProject?.id,
      onClose,
      isCreating,
      onCreateTicket,
      onCreateAndOpenTicket,
      status,
      position,
      onSubmitted
    ]
  );

  const showProjectPicker = projects.length > 0;
  const showTagPicker = Boolean(selectedProjectId) && activeTagDefinitions.length > 0;

  return (
    <Card
      ref={cardRef}
      className={
        expand
          ? 'border-border/40 overflow-visible scale-110 shadow-2xl'
          : 'border-border/40 overflow-hidden shadow-sm'
      }
    >
      <CardContent className="relative p-2">
        <MentionableTextarea
          ref={inputRef}
          id={inputId}
          autoFocus
          disabled={isCreating}
          placeholder="Write an objective…"
          value={value}
          onValueChange={setValue}
          mentionPaths={effectiveMentionPaths}
          onKeyDown={e => {
            void handleKeyDown(e);
          }}
          className={
            expand
              ? 'min-h-[156px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0'
              : 'min-h-[78px] resize-none border-0 p-1 text-sm shadow-none focus-visible:ring-0'
          }
          rows={expand ? 7 : 4}
        />
        <div
          className="mt-1 flex items-center justify-between gap-2 px-1"
          onMouseDown={event => event.preventDefault()}
        >
          {onCreateAndOpenTicket ? (
            <p className="text-[11px] text-muted-foreground/50">⌘↵ to save &amp; open</p>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            {showProjectPicker ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    aria-label={
                      selectedProject
                        ? `Project: ${selectedProject.name}`
                        : 'Choose project for new ticket'
                    }
                    disabled={isCreating}
                  >
                    <ProjectColorDot
                      color={selectedProject?.color ?? defaultProject?.color}
                      name={selectedProject?.name ?? defaultProject?.name}
                      size="sm"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className={cn('w-52', projectMenuScopeClass)}
                >
                  {projects.map(project => (
                    <DropdownMenuItem
                      key={project.id}
                      className="gap-2"
                      onSelect={event => {
                        event.preventDefault();
                        setSelectedProjectId(project.id);
                      }}
                    >
                      <ProjectColorDot color={project.color} name={project.name} size="sm" />
                      <span className="flex-1 truncate">{project.name}</span>
                      {selectedProjectId === project.id ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {showTagPicker ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-6 w-6 shrink-0',
                      selectedTagIds.length > 0 && 'text-foreground'
                    )}
                    aria-label="Add tags to new ticket"
                    disabled={isCreating}
                  >
                    <Tag className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={cn('w-48', tagMenuScopeClass)}>
                  {activeTagDefinitions.map(definition => (
                    <DropdownMenuCheckboxItem
                      key={definition.id}
                      checked={selectedTagIds.includes(definition.id)}
                      onCheckedChange={() => toggleTag(definition.id)}
                      onSelect={event => event.preventDefault()}
                      className="gap-2"
                    >
                      {definition.color ? (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full border"
                          style={{
                            backgroundColor: definition.color,
                            borderColor: definition.color
                          }}
                        />
                      ) : null}
                      <span className="truncate">{definition.label}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <IsHumanToggle forHuman={forHuman} onForHumanChange={setForHuman} size="sm" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
