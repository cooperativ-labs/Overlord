'use client';

import { Upload } from 'lucide-react';
import {
  type ComponentPropsWithoutRef,
  type DragEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState
} from 'react';

import { cn } from '@/lib/utils';

export type UseFileDropZoneOptions = {
  onDrop: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
};

export type FileDropZoneRootProps = {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

export function useFileDropZone({ onDrop, disabled = false }: UseFileDropZoneOptions): {
  isDragOver: boolean;
  rootProps: FileDropZoneRootProps;
} {
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const resetDragState = useCallback(() => {
    dragCounterRef.current = 0;
    setIsDragOver(false);
  }, []);

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      dragCounterRef.current += 1;
      setIsDragOver(true);
    },
    [disabled]
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      setIsDragOver(true);
    },
    [disabled]
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      resetDragState();
      if (disabled) return;

      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) {
        await onDrop(files);
      }
    },
    [disabled, onDrop, resetDragState]
  );

  return {
    isDragOver: disabled ? false : isDragOver,
    rootProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    }
  };
}

export type FileDropZoneDragState = {
  isDragOver: boolean;
  rootProps: FileDropZoneRootProps;
};

type FileDropZoneProps = Omit<ComponentPropsWithoutRef<'div'>, 'onDrop'> & {
  children: ReactNode;
  onDrop: (files: File[]) => void | Promise<void>;
  disabled?: boolean;
  /** Reuse drag state from `useFileDropZone` when a parent already owns file-drop handling. */
  dragState?: FileDropZoneDragState;
  /** Custom overlay; pass `null` to hide. Omit for the default overlay. */
  overlay?: ReactNode | null;
  label?: string;
  overlayClassName?: string;
};

export function FileDropZone({
  children,
  onDrop,
  disabled = false,
  dragState,
  className,
  overlay,
  label = 'Drop to upload',
  overlayClassName,
  ...rest
}: FileDropZoneProps) {
  const internalDragState = useFileDropZone({ onDrop, disabled });
  const { isDragOver, rootProps } = dragState ?? internalDragState;

  const defaultOverlay = (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[inherit] bg-primary/10 backdrop-blur-sm ring-2 ring-inset ring-primary/25',
        overlayClassName
      )}
      aria-hidden
    >
      <Upload className="h-8 w-8 text-primary" />
      <span className="text-sm font-medium text-primary">{label}</span>
    </div>
  );

  return (
    <div className={cn('relative', className)} {...rootProps} {...rest}>
      {children}
      {isDragOver && overlay !== null ? (overlay === undefined ? defaultOverlay : overlay) : null}
    </div>
  );
}
