'use client';

import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { removeProfileImageAction, uploadProfileImageAction } from '@/lib/actions/account';
import { cn } from '@/lib/utils';

type ProfileImageFormProps = {
  fallbackName: string;
  initialImageUrl: string;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (parts.length === 0) {
    return 'U';
  }

  return parts.map(part => part[0]?.toUpperCase() ?? '').join('');
}

export function ProfileImageForm({ fallbackName, initialImageUrl }: ProfileImageFormProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [imageUrl, setImageUrl] = useState(initialImageUrl);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [removeButtonState, setRemoveButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setImageUrl(initialImageUrl);
    setIsUploading(false);
    setIsDragOver(false);
    setRemoveButtonState('default');
    setErrorMessage(null);
  }, [initialImageUrl]);

  const uploadFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) {
        return;
      }

      setIsUploading(true);
      setErrorMessage(null);
      setRemoveButtonState('default');

      try {
        const formData = new FormData();
        formData.set('file', file);
        const nextImageUrl = await uploadProfileImageAction(formData);
        setImageUrl(nextImageUrl);
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to upload image.');
      } finally {
        setIsUploading(false);
      }
    },
    [router]
  );

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await uploadFile(file);
  };

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isDragOver) {
        setIsDragOver(true);
      }
    },
    [isDragOver]
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);

    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      await uploadFile(event.dataTransfer.files?.[0]);
    },
    [uploadFile]
  );

  const handleRemove = async () => {
    setRemoveButtonState('loading');
    setErrorMessage(null);

    try {
      await removeProfileImageAction();
      setImageUrl('');
      setRemoveButtonState('success');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to remove image.');
      setRemoveButtonState('error');
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'flex flex-col gap-4 rounded-lg border border-dashed p-4 transition-colors sm:flex-row sm:items-center',
          isDragOver ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-border'
        )}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="relative w-fit">
          <Avatar className="h-20 w-20 border">
            <AvatarImage src={imageUrl} alt={fallbackName} />
            <AvatarFallback className="text-lg font-medium">
              {getInitials(fallbackName)}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-full bg-background/90 text-primary transition-opacity',
              isDragOver ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            aria-hidden="true"
          >
            <Upload className="size-5" />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-medium">Profile image</p>
            <p className="text-muted-foreground text-sm">
              Public avatar shown anywhere your account is displayed. Drag an image here or click to
              browse.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <ImagePlus className="size-4" />
                  {imageUrl ? 'Change image' : 'Upload image'}
                </>
              )}
            </Button>
            <LoadingButton
              buttonState={removeButtonState}
              setButtonState={setRemoveButtonState}
              variant="ghost"
              text={
                <>
                  <Trash2 className="size-4" />
                  Remove image
                </>
              }
              loadingText="Removing..."
              successText="Removed"
              errorText="Retry remove"
              reset
              onClick={handleRemove}
              disabled={!imageUrl || isUploading}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            JPG, PNG, GIF, or WEBP up to 5 MB. Dropped files upload immediately.
          </p>
        </div>
      </div>
      {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
    </div>
  );
}
