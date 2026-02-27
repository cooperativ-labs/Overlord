'use client';

import { Loader2, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  deleteTicketDocumentAction,
  getDocumentSignedUrlAction,
  type TicketDocument,
  uploadTicketDocumentAction
} from '@/lib/actions/artifacts';
import { cn } from '@/lib/utils';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeIcon(fileType: string): string {
  if (fileType.startsWith('image/')) return '🖼️';
  if (fileType === 'application/pdf') return '📄';
  if (fileType.includes('spreadsheet') || fileType.includes('csv')) return '📊';
  if (fileType.includes('word') || fileType.includes('document')) return '📝';
  return '📎';
}

type UploadingFile = {
  id: string;
  name: string;
  progress: 'uploading' | 'done' | 'error';
  error?: string;
};

export function TicketDocumentUpload({
  ticketId,
  initialDocuments
}: {
  ticketId: string;
  initialDocuments: TicketDocument[];
}) {
  const [documents, setDocuments] = useState<TicketDocument[]>(initialDocuments);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      const pending: UploadingFile[] = fileArray.map(f => ({
        id: `${Date.now()}-${f.name}`,
        name: f.name,
        progress: 'uploading' as const
      }));

      setUploading(prev => [...prev, ...pending]);

      await Promise.all(
        fileArray.map(async (file, i) => {
          const uploadId = pending[i].id;
          try {
            const formData = new FormData();
            formData.set('file', file);
            const doc = await uploadTicketDocumentAction(ticketId, formData);
            setDocuments(prev => [doc, ...prev]);
            setUploading(prev => prev.filter(u => u.id !== uploadId));
          } catch (err) {
            setUploading(prev =>
              prev.map(u =>
                u.id === uploadId ? { ...u, progress: 'error', error: (err as Error).message } : u
              )
            );
          }
        })
      );
    },
    [ticketId]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
        e.target.value = '';
      }
    },
    [handleFiles]
  );

  const handleDelete = useCallback(
    async (doc: TicketDocument) => {
      setDeletingIds(prev => new Set(prev).add(doc.id));
      try {
        await deleteTicketDocumentAction(ticketId, doc.id);
        setDocuments(prev => prev.filter(d => d.id !== doc.id));
      } catch {
        // Removal failed — un-mark
      } finally {
        setDeletingIds(prev => {
          const next = new Set(prev);
          next.delete(doc.id);
          return next;
        });
      }
    },
    [ticketId]
  );

  const handleDownload = useCallback(async (doc: TicketDocument) => {
    try {
      const url = await getDocumentSignedUrlAction(doc.storagePath);
      window.open(url, '_blank');
    } catch {
      // Silently fail — user can retry
    }
  }, []);

  const dismissError = useCallback((uploadId: string) => {
    setUploading(prev => prev.filter(u => u.id !== uploadId));
  }, []);

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Documents
      </h2>

      {/* Drop zone */}
      <div
        className={cn(
          'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors',
          isDragOver
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/40'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drag & drop files here, or <span className="text-primary underline">browse</span>
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />
      </div>

      {/* Uploading status */}
      {uploading.length > 0 && (
        <div className="mt-3 space-y-2">
          {uploading.map(u => (
            <div
              key={u.id}
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                u.progress === 'error' ? 'border-destructive/50 bg-destructive/5' : 'bg-muted/30'
              )}
            >
              {u.progress === 'uploading' ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
              <span className="flex-1 truncate">{u.name}</span>
              {u.progress === 'error' && (
                <>
                  <span className="text-xs text-destructive">{u.error ?? 'Upload failed'}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={e => {
                      e.stopPropagation();
                      dismissError(u.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Document list */}
      {documents.length > 0 && (
        <div className="mt-3 space-y-1">
          {documents.map(doc => (
            <div
              key={doc.id}
              className="group flex items-center gap-2 rounded-md px-3 py-2 hover:bg-muted/40"
            >
              <span className="shrink-0 text-sm" aria-hidden="true">
                {fileTypeIcon(doc.fileType)}
              </span>
              <button
                type="button"
                className="flex-1 truncate text-left text-sm text-foreground hover:underline"
                onClick={() => handleDownload(doc)}
              >
                {doc.label}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatFileSize(doc.fileSize)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                disabled={deletingIds.has(doc.id)}
                onClick={e => {
                  e.stopPropagation();
                  handleDelete(doc);
                }}
              >
                {deletingIds.has(doc.id) ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
