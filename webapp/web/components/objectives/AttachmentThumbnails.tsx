import { Loader2, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { useAuthenticatedMediaUrl } from '@/lib/use-authenticated-media-url.ts';

import type { ObjectiveAttachmentDto } from '../../../shared/contract.ts';
import { cn } from '../../lib/utils.ts';

import {
  AttachmentIcon,
  formatFileSize,
  handleAttachmentDownloadClick
} from './ObjectiveAttachments.tsx';

function isImageType(contentType: string | null | undefined): boolean {
  return Boolean(contentType?.startsWith('image/'));
}

type AttachmentThumbnailsProps = {
  /** Files already stored on the server. */
  attachments?: ObjectiveAttachmentDto[];
  /** Files held client-side until the capture is created. */
  files?: File[];
  removingId?: string | null;
  onRemoveAttachment?: (id: string) => void;
  onRemoveFile?: (index: number) => void;
  /** Shows a spinner tile while an upload is in flight. */
  isUploading?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Composer-style attachment strip, matching the mobile composer: images render
 * as square thumbnails and other files as a tile with their filename, each with
 * an X badge to remove it. Renders nothing when there is nothing to show.
 */
export function AttachmentThumbnails({
  attachments = [],
  files = [],
  removingId = null,
  onRemoveAttachment,
  onRemoveFile,
  isUploading = false,
  disabled = false,
  className
}: AttachmentThumbnailsProps) {
  if (attachments.length === 0 && files.length === 0 && !isUploading) return null;

  return (
    <div className={cn('flex flex-wrap gap-2 px-3 pb-1 pt-2', className)}>
      {attachments.map(attachment => (
        <SavedAttachmentThumbnail
          key={attachment.id}
          attachment={attachment}
          removing={removingId === attachment.id}
          disabled={disabled}
          onRemove={onRemoveAttachment ? () => onRemoveAttachment(attachment.id) : undefined}
        />
      ))}
      {files.map((file, index) => (
        <PendingAttachmentThumbnail
          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
          file={file}
          disabled={disabled}
          onRemove={onRemoveFile ? () => onRemoveFile(index) : undefined}
        />
      ))}
      {isUploading ? (
        <div
          className="flex h-16 w-16 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground"
          role="status"
          aria-label="Uploading attachment"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}
    </div>
  );
}

function SavedAttachmentThumbnail({
  attachment,
  removing,
  disabled,
  onRemove
}: {
  attachment: ObjectiveAttachmentDto;
  removing: boolean;
  disabled: boolean;
  onRemove?: () => void;
}) {
  const isImage = isImageType(attachment.contentType);
  const imageUrl = useAuthenticatedMediaUrl(isImage ? attachment.url : null);

  return (
    <ThumbnailTile
      name={attachment.filename}
      contentType={attachment.contentType}
      sizeBytes={attachment.sizeBytes}
      imageUrl={imageUrl}
      removing={removing}
      disabled={disabled}
      onRemove={onRemove}
      wrap={content => (
        <a
          href={attachment.url}
          download={attachment.filename}
          onClick={event => handleAttachmentDownloadClick(event, attachment)}
          title={attachment.filename}
          className="block h-full w-full focus-visible:outline-none"
        >
          {content}
        </a>
      )}
    />
  );
}

function PendingAttachmentThumbnail({
  file,
  disabled,
  onRemove
}: {
  file: File;
  disabled: boolean;
  onRemove?: () => void;
}) {
  const isImage = isImageType(file.type);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const objectUrl = URL.createObjectURL(file);
    setImageUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, isImage]);

  return (
    <ThumbnailTile
      name={file.name}
      contentType={file.type || null}
      sizeBytes={file.size}
      imageUrl={imageUrl}
      removing={false}
      disabled={disabled}
      onRemove={onRemove}
      wrap={content => (
        <div title={file.name} className="h-full w-full">
          {content}
        </div>
      )}
    />
  );
}

function ThumbnailTile({
  name,
  contentType,
  sizeBytes,
  imageUrl,
  removing,
  disabled,
  onRemove,
  wrap
}: {
  name: string;
  contentType: string | null;
  sizeBytes: number | null;
  imageUrl: string | null;
  removing: boolean;
  disabled: boolean;
  onRemove?: () => void;
  wrap: (content: ReactNode) => ReactNode;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const isImage = isImageType(contentType);
  const showImage = isImage && imageUrl !== null && !imageFailed;

  const content = showImage ? (
    <img
      src={imageUrl}
      alt={name}
      onError={() => setImageFailed(true)}
      className="h-full w-full object-cover"
    />
  ) : isImage ? (
    // Image still resolving (or unreadable): keep the square footprint.
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <AttachmentIcon contentType={contentType} />
    </div>
  ) : (
    <div className="flex h-full w-full flex-col justify-center gap-1 py-2 pl-2.5 pr-6 text-left">
      <div className="flex min-w-0 items-center gap-1.5">
        <AttachmentIcon contentType={contentType} />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{name}</span>
      </div>
      {sizeBytes !== null ? (
        <span className="text-[10px] text-muted-foreground">{formatFileSize(sizeBytes)}</span>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        'group relative h-16 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-muted/40',
        isImage ? 'w-16' : 'w-44',
        removing && 'opacity-50'
      )}
    >
      {wrap(content)}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled || removing}
          className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/35 bg-black/60 text-white transition-opacity hover:bg-black/75 disabled:opacity-50"
          aria-label={`Remove ${name}`}
          title="Remove"
        >
          {removing ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <X className="h-2.5 w-2.5" strokeWidth={3} />
          )}
        </button>
      ) : null}
    </div>
  );
}
