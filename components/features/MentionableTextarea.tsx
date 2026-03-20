'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import type { TextareaHandle } from '@/lib/types/text-control';
import { cn } from '@/lib/utils';

const MAX_MENTION_RESULTS = 8;

type MentionableTextareaProps = Omit<
  React.ComponentProps<'textarea'>,
  'value' | 'onChange' | 'children'
> & {
  value: string;
  onValueChange: (nextValue: string) => void;
  mentionPaths?: string[];
  containerClassName?: string;
  menuClassName?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  onMentionSelect?: (filePath: string) => void;
};

export const MentionableTextarea = React.forwardRef<HTMLTextAreaElement, MentionableTextareaProps>(
  function MentionableTextarea(
    {
      value,
      onValueChange,
      mentionPaths = [],
      className,
      containerClassName,
      menuClassName,
      onKeyDown,
      onBlur,
      onClick,
      onSelect,
      onChange,
      onMentionSelect,
      ...props
    },
    forwardedRef
  ) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const [mentionStart, setMentionStart] = React.useState<number | null>(null);
    const [mentionQuery, setMentionQuery] = React.useState('');
    const [mentionIndex, setMentionIndex] = React.useState(0);
    const [mentionMenuPlacement, setMentionMenuPlacement] = React.useState<'top' | 'bottom'>(
      'bottom'
    );
    const [mentionMenuMaxHeight, setMentionMenuMaxHeight] = React.useState(224);
    const [menuPosition, setMenuPosition] = React.useState<{ top: number; left: number }>({
      top: 0,
      left: 0
    });

    const mentionResults = React.useMemo(
      () =>
        mentionPaths
          .filter(filePath => filePath.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, MAX_MENTION_RESULTS),
      [mentionPaths, mentionQuery]
    );
    const mentionMenuOpen = mentionStart !== null && mentionResults.length > 0;

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        if (!forwardedRef) return;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
          return;
        }
        forwardedRef.current = node;
      },
      [forwardedRef]
    );

    const clearMentionState = React.useCallback(() => {
      setMentionStart(null);
      setMentionQuery('');
      setMentionIndex(0);
    }, []);

    const updateMentionState = React.useCallback(
      (nextValue: string, cursorPosition: number) => {
        if (mentionPaths.length === 0) {
          clearMentionState();
          return;
        }

        const beforeCursor = nextValue.slice(0, cursorPosition);
        const tokenMatch = beforeCursor.match(/(^|[\s(])@([^\s@]*)$/);
        if (!tokenMatch) {
          clearMentionState();
          return;
        }

        const query = tokenMatch[2] ?? '';
        const atSymbolPosition = cursorPosition - query.length - 1;
        setMentionStart(atSymbolPosition);
        setMentionQuery(query);
        setMentionIndex(0);
      },
      [mentionPaths.length, clearMentionState]
    );

    const updateMentionMenuPosition = React.useCallback(() => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 4;
      const preferredMaxHeight = 224;
      const minMenuHeight = 96;
      const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
      const spaceAbove = rect.top - gap - viewportPadding;
      const shouldOpenAbove = spaceBelow < minMenuHeight && spaceAbove > spaceBelow;
      const availableSpace = shouldOpenAbove ? spaceAbove : spaceBelow;

      setMentionMenuPlacement(shouldOpenAbove ? 'top' : 'bottom');
      setMentionMenuMaxHeight(
        Math.max(minMenuHeight, Math.min(preferredMaxHeight, Math.floor(availableSpace)))
      );
      setMenuPosition({
        top: shouldOpenAbove ? rect.top - gap : rect.bottom + gap,
        left: rect.left
      });
    }, []);

    const insertMentionAtCursor = React.useCallback(
      (filePath: string) => {
        const textArea = textareaRef.current as
          | (TextareaHandle & {
              selectionStart: number | null;
            })
          | null;
        if (!textArea || mentionStart === null || !filePath) return;

        const cursor = textArea.selectionStart ?? value.length;
        let mentionText = `@${filePath}`;
        const suffix = value.slice(cursor);
        if (suffix.length === 0 || (!suffix.startsWith(' ') && !suffix.startsWith('\n'))) {
          mentionText += ' ';
        }

        const nextValue = `${value.slice(0, mentionStart)}${mentionText}${suffix}`;
        const nextCursor = mentionStart + mentionText.length;

        onValueChange(nextValue);
        onMentionSelect?.(filePath);
        clearMentionState();

        requestAnimationFrame(() => {
          textArea.focus();
          textArea.setSelectionRange(nextCursor, nextCursor);
        });
      },
      [mentionStart, value, onValueChange, onMentionSelect, clearMentionState]
    );

    React.useEffect(() => {
      if (!mentionMenuOpen) return;
      updateMentionMenuPosition();
      window.addEventListener('resize', updateMentionMenuPosition);
      window.addEventListener('scroll', updateMentionMenuPosition, true);
      return () => {
        window.removeEventListener('resize', updateMentionMenuPosition);
        window.removeEventListener('scroll', updateMentionMenuPosition, true);
      };
    }, [mentionMenuOpen, updateMentionMenuPosition]);

    React.useEffect(() => {
      if (mentionPaths.length > 0) return;
      clearMentionState();
    }, [mentionPaths.length, clearMentionState]);

    return (
      <div ref={containerRef} className={cn('relative w-full', containerClassName)}>
        <textarea
          ref={setRefs}
          className={cn('w-full focus:outline-none focus-visible:ring-0', className)}
          value={value}
          onChange={event => {
            const nextValue = event.target.value;
            onValueChange(nextValue);
            updateMentionState(nextValue, event.target.selectionStart ?? nextValue.length);
            onChange?.(event);
          }}
          onClick={event => {
            updateMentionState(value, event.currentTarget.selectionStart ?? value.length);
            onClick?.(event);
          }}
          onSelect={event => {
            updateMentionState(value, event.currentTarget.selectionStart ?? value.length);
            onSelect?.(event);
          }}
          onBlur={event => {
            clearMentionState();
            onBlur?.(event);
          }}
          onKeyDown={event => {
            if (mentionMenuOpen) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMentionIndex(current => (current + 1) % mentionResults.length);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setMentionIndex(
                  current => (current - 1 + mentionResults.length) % mentionResults.length
                );
                return;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                insertMentionAtCursor(mentionResults[mentionIndex] ?? mentionResults[0] ?? '');
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                clearMentionState();
                return;
              }
            }

            onKeyDown?.(event);
          }}
          {...props}
        />
        {mentionMenuOpen
          ? createPortal(
              <div
                className={cn(
                  'fixed z-50 w-max max-w-[min(64rem,calc(100vw-1rem))] overflow-x-auto overflow-y-auto rounded-md border bg-popover p-1 shadow-md',
                  menuClassName
                )}
                style={{
                  top: mentionMenuPlacement === 'top' ? undefined : menuPosition.top,
                  bottom:
                    mentionMenuPlacement === 'top'
                      ? window.innerHeight - menuPosition.top
                      : undefined,
                  left: menuPosition.left,
                  maxHeight: mentionMenuMaxHeight
                }}
              >
                {mentionResults.map((filePath, index) => (
                  <button
                    key={filePath}
                    className={cn(
                      'block w-full whitespace-nowrap rounded px-2 py-1.5 text-left text-sm',
                      index === mentionIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-accent/60'
                    )}
                    type="button"
                    onMouseDown={event => {
                      event.preventDefault();
                      insertMentionAtCursor(filePath);
                    }}
                  >
                    @{filePath}
                  </button>
                ))}
              </div>,
              document.body
            )
          : null}
      </div>
    );
  }
);

MentionableTextarea.displayName = 'MentionableTextarea';
