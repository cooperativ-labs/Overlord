import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { FileText, ImageIcon, Loader2, Plus, Trash2, X } from 'lucide-react';
import {
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useRef,
  useState
} from 'react';

import type { ObjectiveAttachmentDto } from '../../../shared/contract.ts';
import { api } from '../../lib/api.ts';
import {
  keys,
  useDeleteObjectiveAttachment,
  useObjectiveAttachments,
  useUploadObjectiveAttachment
} from '../../lib/queries.ts';
import { downloadStorageObject } from '../../lib/storage-download.ts';
import { storageUrlNeedsAuthenticatedFetch } from '../../lib/storage-url.ts';
import { cn } from '../../lib/utils.ts';
import { Button } from '../ui/button.tsx';
import { type FileDropZoneDragState, useFileDropZone } from '../ui/file-drop-zone.tsx';

/**
 * Client-side mirror of the server's per-attachment ceiling. Exported so the
 * ghost composer (GhostObjective) can apply the same guard before an
 * objective exists to attach to.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_LABEL = '25 MB';

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Owns the attachment data + upload/remove flow for one objective, plus the
 * drag-and-drop state so a parent can wrap its whole surface in a
 * {@link import('../ui/file-drop-zone').FileDropZone}. File picking is exposed
 * via `inputRef` + `handleInputChange` for a trigger button.
 */
export function useObjectiveAttachmentState(
  objectiveId: string,
  { dropDisabled = false }: { dropDisabled?: boolean } = {}
) {
  const { data: attachments = [], isLoading } = useObjectiveAttachments(objectiveId);
  const upload = useUploadObjectiveAttachment(objectiveId);
  const remove = useDeleteObjectiveAttachment(objectiveId);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError(`File too large. Attachments can be no longer than ${MAX_ATTACHMENT_LABEL}.`);
          continue;
        }
        try {
          await upload.mutateAsync(file);
        } catch (err) {
          setError(err instanceof Error ? err.message : `Failed to upload "${file.name}".`);
          break;
        }
      }
    },
    [upload]
  );

  const dragState = useFileDropZone({
    onDrop: handleFiles,
    disabled: dropDisabled || upload.isPending
  });

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        void handleFiles(Array.from(event.target.files));
        // Reset so picking the same file again still fires onChange.
        event.target.value = '';
      }
    },
    [handleFiles]
  );

  const handleRemove = useCallback(
    (id: string) => {
      setError(null);
      setRemovingId(id);
      remove.mutate(id, {
        onError: err =>
          setError(err instanceof Error ? err.message : 'Failed to remove attachment.'),
        onSettled: () => setRemovingId(null)
      });
    },
    [remove]
  );

  return {
    attachments,
    isLoading,
    error,
    removingId,
    isUploading: upload.isPending,
    inputRef,
    handleFiles,
    handleInputChange,
    handleRemove,
    dragState
  };
}

export type ObjectiveAttachmentState = ReturnType<typeof useObjectiveAttachmentState>;
export type { FileDropZoneDragState };

/**
 * Upload files to an objective that was created a moment ago (a new mission's
 * first objective) and refresh its attachment list. Composer surfaces that
 * hold files before any objective exists — BlankMissionCard, NewMissionModal —
 * call this right after the create succeeds. Oversized files are skipped, and
 * the first upload failure aborts the rest so the error surfaces promptly.
 */
export async function uploadPendingAttachments(
  objectiveId: string,
  files: File[],
  qc?: QueryClient
): Promise<void> {
  if (files.length === 0) return;
  try {
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) continue;
      await api.uploadObjectiveAttachment(objectiveId, file);
    }
  } finally {
    void qc?.invalidateQueries({ queryKey: keys.objectiveAttachments(objectiveId) });
  }
}

/**
 * Client-only attachment queue for composers that create the objective on
 * submit rather than editing an existing one. Mirrors
 * {@link useObjectiveAttachmentState} — same size guard, drag state, and file
 * picker wiring — but holds the `File`s in memory until `upload(objectiveId)`
 * is called with the id the create returned.
 */
export function usePendingAttachments({ dropDisabled = false }: { dropDisabled?: boolean } = {}) {
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    setError(null);
    const accepted: File[] = [];
    for (const file of incoming) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`File too large. Attachments can be no longer than ${MAX_ATTACHMENT_LABEL}.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) setFiles(prev => [...prev, ...accepted]);
  }, []);

  const removeAt = useCallback((index: number) => {
    setError(null);
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clear = useCallback(() => {
    setFiles([]);
    setError(null);
  }, []);

  const dragState = useFileDropZone({ onDrop: addFiles, disabled: dropDisabled });

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        addFiles(Array.from(event.target.files));
        // Reset so picking the same file again still fires onChange.
        event.target.value = '';
      }
    },
    [addFiles]
  );

  const upload = useCallback(
    (objectiveId: string, pending: File[] = files) =>
      uploadPendingAttachments(objectiveId, pending, qc),
    [files, qc]
  );

  return {
    files,
    error,
    inputRef,
    addFiles,
    removeAt,
    clear,
    handleInputChange,
    upload,
    dragState
  };
}

export type PendingAttachmentState = ReturnType<typeof usePendingAttachments>;

type PendingAttachmentListProps = {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
  className?: string;
  /** Match Overlord toolbar padding when rendered above the upload trigger row. */
  toolbar?: boolean;
};

/**
 * Rows for files queued by {@link usePendingAttachments} — the same shape as
 * {@link ObjectiveAttachmentList}, minus download links since nothing has been
 * uploaded yet.
 */
export function PendingAttachmentList({
  files,
  onRemove,
  disabled = false,
  className,
  toolbar = false
}: PendingAttachmentListProps) {
  if (files.length === 0) return null;

  return (
    <div className={cn('space-y-0.5', toolbar ? 'px-2 pb-0 pt-1' : undefined, className)}>
      {files.map((file, index) => (
        <div
          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
          className="group flex min-h-8 items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
        >
          <AttachmentIcon contentType={file.type || null} />
          <span className="min-w-0 flex-1 truncate text-left text-xs" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={disabled}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
            aria-label={`Remove ${file.name}`}
            title="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachmentIcon({ contentType }: { contentType: string | null }) {
  if (contentType?.startsWith('image/')) {
    return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

type ObjectiveAttachmentListProps = {
  attachments: ObjectiveAttachmentDto[];
  removingId?: string | null;
  onRemove?: (id: string) => void;
  className?: string;
  /** Match Overlord toolbar padding when rendered above the upload trigger row. */
  toolbar?: boolean;
  /** Render as a plain download list with no remove control (e.g. read-only history views). */
  readOnly?: boolean;
};

/**
 * Compact attachment rows: type icon, downloadable filename, size, and a
 * hover-revealed remove button — matching Overlord's attachment list look.
 */
export function ObjectiveAttachmentList({
  attachments,
  removingId = null,
  onRemove,
  className,
  toolbar = false,
  readOnly = false
}: ObjectiveAttachmentListProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={cn('space-y-0.5', toolbar ? 'px-2 pb-0 pt-1' : undefined, className)}>
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className="group flex min-h-8 items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
        >
          <AttachmentIcon contentType={attachment.contentType} />
          <a
            href={attachment.url}
            download={attachment.filename}
            onClick={event => {
              if (!storageUrlNeedsAuthenticatedFetch({ url: attachment.url })) return;
              event.preventDefault();
              void downloadStorageObject({
                url: attachment.url,
                filename: attachment.filename
              }).catch(() => undefined);
            }}
            className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
            title={attachment.filename}
          >
            {attachment.filename}
          </a>
          {attachment.sizeBytes !== null ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatFileSize(attachment.sizeBytes)}
            </span>
          ) : null}
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => onRemove?.(attachment.id)}
              disabled={removingId === attachment.id}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
              aria-label={`Remove ${attachment.filename}`}
              title="Remove"
            >
              {removingId === attachment.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type ObjectiveAttachmentUploadTriggerProps = {
  attachmentsCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  children?: ReactNode;
};

/**
 * Footer row with a + button that opens the file picker. Drop handling is owned
 * by a parent {@link import('../ui/file-drop-zone').FileDropZone}.
 */
export function ObjectiveAttachmentUploadTrigger({
  attachmentsCount,
  inputRef,
  onInputChange,
  disabled = false,
  children
}: ObjectiveAttachmentUploadTriggerProps) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 shrink-0"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="Upload objective attachment"
        title="Upload attachment"
      >
        <Plus size={18} />
      </Button>
      {attachmentsCount > 0 ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none">
          {attachmentsCount}
        </span>
      ) : null}
      <input ref={inputRef} type="file" multiple className="hidden" onChange={onInputChange} />
      {children ? (
        <div className="@container/objective-toolbar flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}
