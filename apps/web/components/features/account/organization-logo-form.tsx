'use client';

import { Building2, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import {
  removeOrganizationLogoAction,
  uploadOrganizationLogoAction
} from '@/lib/actions/organizations';
import { cn } from '@/lib/utils';

type OrganizationLogoFormProps = {
  organizationId: number;
  organizationName: string;
  initialLogoUrl: string | null;
  onLogoChange?: (url: string | null) => void;
};

export function OrganizationLogoForm({
  organizationId,
  organizationName,
  initialLogoUrl,
  onLogoChange
}: OrganizationLogoFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl ?? '');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [removeButtonState, setRemoveButtonState] = useState<ButtonLoadingState>('default');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setLogoUrl(initialLogoUrl ?? '');
    setIsUploading(false);
    setIsDragOver(false);
    setRemoveButtonState('default');
    setErrorMessage(null);
  }, [initialLogoUrl]);

  const uploadFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setIsUploading(true);
      setErrorMessage(null);
      setRemoveButtonState('default');
      try {
        const formData = new FormData();
        formData.set('file', file);
        const nextLogoUrl = await uploadOrganizationLogoAction(organizationId, formData);
        setLogoUrl(nextLogoUrl);
        onLogoChange?.(nextLogoUrl);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to upload image.');
      } finally {
        setIsUploading(false);
      }
    },
    [onLogoChange, organizationId]
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
      if (!isDragOver) setIsDragOver(true);
    },
    [isDragOver]
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
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
      await removeOrganizationLogoAction(organizationId);
      setLogoUrl('');
      onLogoChange?.(null);
      setRemoveButtonState('success');
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
          <div className="bg-muted relative h-20 w-20 overflow-hidden rounded-lg border">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={organizationName}
                className="h-full w-full object-contain"
                onError={() => setLogoUrl('')}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Building2 className="size-8 text-muted-foreground" />
              </div>
            )}
          </div>
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-lg bg-background/90 text-primary transition-opacity',
              isDragOver ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
            aria-hidden="true"
          >
            <ImagePlus className="size-5" />
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-medium">Organization logo</p>
            <p className="text-muted-foreground text-sm">
              Logo shown in the app for this organization. Drag an image here or click to browse.
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
                  {logoUrl ? 'Change logo' : 'Upload logo'}
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
                  Remove logo
                </>
              }
              loadingText="Removing..."
              successText="Removed"
              errorText="Retry remove"
              reset
              onClick={handleRemove}
              disabled={!logoUrl || isUploading}
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
