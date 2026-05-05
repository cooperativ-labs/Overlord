'use client';

import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  deleteObjectiveAttachmentAction,
  finalizeObjectiveAttachmentUploadAction,
  getObjectiveAttachmentSignedUrlAction,
  type ObjectiveAttachment,
  type ObjectiveAttachmentUploadDraft,
  prepareObjectiveAttachmentUploadAction
} from '@/lib/actions/attachments';
import { cn } from '@/lib/utils';
import { createClient } from '@/supabase/utils/client';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/')) {
    return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

type UploadingFile = {
  id: string;
  name: string;
  progress: 'uploading' | 'error';
  error?: string;
};

type ObjectiveAttachmentUploadProps = {
  ticketId: string;
  objectiveId: string;
  initialAttachments: ObjectiveAttachment[];
  compact?: boolean;
};

export function ObjectiveAttachmentUpload({
  ticketId,
  objectiveId,
  initialAttachments,
  compact = false
}: ObjectiveAttachmentUploadProps) {
  const [attachments, setAttachments] = useState<ObjectiveAttachment[]>(initialAttachments);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0 || !objectiveId) return;

      const pending: UploadingFile[] = fileArray.map(file => ({
        id: `${Date.now()}-${file.name}`,
        name: file.name,
        progress: 'uploading' as const
      }));
      setUploading(prev => [...prev, ...pending]);

      await Promise.all(
        fileArray.map(async (file, index) => {
          const uploadId = pending[index].id;
          try {
            const draft = await prepareObjectiveAttachmentUploadAction(ticketId, objectiveId, {
              contentType: file.type || 'application/octet-stream',
              fileName: file.name,
              fileSize: file.size
            });
            const supabase = createClient();
            const { error: uploadError } = await supabase.storage
              .from('artifacts')
              .uploadToSignedUrl(draft.storagePath, draft.token, file, {
                cacheControl: '3600',
                contentType: draft.contentType,
                upsert: false
              });

            if (uploadError) {
              throw new Error(uploadError.message ?? 'Failed to upload file.');
            }

            const finalizedDraft: Omit<ObjectiveAttachmentUploadDraft, 'token'> = {
              contentType: draft.contentType,
              fileSize: draft.fileSize,
              label: draft.label,
              storagePath: draft.storagePath
            };
            const attachment = await finalizeObjectiveAttachmentUploadAction(
              ticketId,
              objectiveId,
              finalizedDraft
            );
            setAttachments(prev => [attachment, ...prev]);
            setUploading(prev => prev.filter(item => item.id !== uploadId));
          } catch (error) {
            setUploading(prev =>
              prev.map(item =>
                item.id === uploadId
                  ? { ...item, progress: 'error', error: (error as Error).message }
                  : item
              )
            );
          }
        })
      );
    },
    [objectiveId, ticketId]
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (objectiveId) setIsDragOver(true);
    },
    [objectiveId]
  );

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      if (event.dataTransfer.files.length > 0) {
        handleFiles(event.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        handleFiles(event.target.files);
        event.target.value = '';
      }
    },
    [handleFiles]
  );

  const handleDownload = useCallback(async (attachment: ObjectiveAttachment) => {
    try {
      const url = await getObjectiveAttachmentSignedUrlAction(attachment.storagePath);
      window.open(url, '_blank');
    } catch {
      // User can retry the attachment link.
    }
  }, []);

  const handleDelete = useCallback(
    async (attachment: ObjectiveAttachment) => {
      setDeletingIds(prev => new Set(prev).add(attachment.id));
      try {
        await deleteObjectiveAttachmentAction(ticketId, objectiveId, attachment.id);
        setAttachments(prev => prev.filter(item => item.id !== attachment.id));
      } finally {
        setDeletingIds(prev => {
          const next = new Set(prev);
          next.delete(attachment.id);
          return next;
        });
      }
    },
    [objectiveId, ticketId]
  );

  const hasItems = attachments.length > 0 || uploading.length > 0;

  if (!objectiveId) {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-2 rounded-md border border-dashed transition-colors',
        isDragOver ? 'border-primary bg-primary/5' : 'border-border/70',
        compact ? 'px-2 py-2' : 'px-3 py-2'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={() => inputRef.current?.click()}
          aria-label="Upload objective attachment"
        >
          <Upload className="h-3.5 w-3.5" />
        </Button>
        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {isDragOver ? 'Drop to upload' : hasItems ? 'Attachments' : 'Attach files'}
        </div>
        {attachments.length > 0 ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none">
            {attachments.length}
          </span>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {hasItems ? (
        <div className="mt-2 space-y-1">
          {uploading.map(item => (
            <div
              key={item.id}
              className={cn(
                'flex min-h-8 items-center gap-2 rounded px-2 py-1 text-xs',
                item.progress === 'error' ? 'bg-destructive/5 text-destructive' : 'bg-muted/30'
              )}
            >
              {item.progress === 'uploading' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {item.progress === 'error' ? (
                <>
                  <span className="shrink truncate">{item.error ?? 'Upload failed'}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={() => setUploading(prev => prev.filter(u => u.id !== item.id))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </>
              ) : null}
            </div>
          ))}

          {attachments.map(attachment => (
            <div
              key={attachment.id}
              className="group flex min-h-8 items-center gap-2 rounded px-2 py-1 hover:bg-muted/40"
            >
              <AttachmentIcon contentType={attachment.contentType} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-xs hover:underline"
                onClick={() => handleDownload(attachment)}
              >
                {attachment.label}
              </button>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatFileSize(attachment.fileSize)}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                disabled={deletingIds.has(attachment.id)}
                onClick={() => handleDelete(attachment)}
              >
                {deletingIds.has(attachment.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
