'use client';

import { ImagePlus, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import { submitFeedbackAction, uploadFeedbackScreenshot } from '@/lib/actions/feedback';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const uploadFeedbackScreenshotWithRetry = withElectronActionRetry(uploadFeedbackScreenshot);
const submitFeedbackActionWithRetry = withElectronActionRetry(submitFeedbackAction);

type Screenshot = {
  file: File;
  preview: string;
  path?: string;
  uploading: boolean;
};

type FeedbackModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FeedbackModal({ open, onOpenChange }: FeedbackModalProps) {
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [submitState, setSubmitState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setDescription('');
    setScreenshots(prev => {
      for (const s of prev) URL.revokeObjectURL(s.preview);
      return [];
    });
    setSubmitState('default');
    setError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const newScreenshots: Screenshot[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      newScreenshots.push({
        file,
        preview: URL.createObjectURL(file),
        uploading: true
      });
    }

    setScreenshots(prev => [...prev, ...newScreenshots]);

    // Upload each file
    for (const screenshot of newScreenshots) {
      const formData = new FormData();
      formData.append('file', screenshot.file);
      const result = await uploadFeedbackScreenshotWithRetry(formData);

      setScreenshots(prev =>
        prev.map(s =>
          s.preview === screenshot.preview ? { ...s, uploading: false, path: result.path } : s
        )
      );

      if (result.error) {
        setError(result.error);
      }
    }

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function removeScreenshot(preview: string) {
    setScreenshots(prev => {
      const updated = prev.filter(s => s.preview !== preview);
      const removed = prev.find(s => s.preview === preview);
      if (removed) URL.revokeObjectURL(removed.preview);
      return updated;
    });
  }

  async function handleSubmit() {
    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }

    const stillUploading = screenshots.some(s => s.uploading);
    if (stillUploading) {
      setError('Please wait for screenshots to finish uploading.');
      return;
    }

    setSubmitState('loading');
    setError(null);

    const paths = screenshots.filter(s => s.path).map(s => s.path!);
    const result = await submitFeedbackActionWithRetry(description, paths);

    if (result.error) {
      setSubmitState('error');
      setError(result.error);
      setTimeout(() => setSubmitState('default'), 2000);
    } else {
      setSubmitState('success');
      setTimeout(() => {
        handleOpenChange(false);
      }, 1500);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Send Feedback</DialogTitle>
        <DialogDescription>
          Let us know about bugs, feature requests, or anything else.
        </DialogDescription>

        <div className="mt-2 space-y-4">
          <Textarea
            placeholder="Describe your feedback..."
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="min-h-[120px] resize-none"
          />

          {/* Screenshot previews */}
          {screenshots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {screenshots.map(s => (
                <div key={s.preview} className="relative group">
                  <img
                    src={s.preview}
                    alt="Screenshot"
                    className="h-20 w-20 rounded-md border object-cover"
                  />
                  {s.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeScreenshot(s.preview)}
                    className="absolute -right-1 -top-1 hidden rounded-full bg-destructive p-0.5 text-destructive-foreground group-hover:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="mr-1.5 h-4 w-4" />
              Add Screenshot
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <LoadingButton
                size="sm"
                buttonState={submitState}
                setButtonState={setSubmitState}
                text="Submit"
                loadingText="Sending..."
                successText="Sent!"
                errorText="Failed"
                onClick={handleSubmit}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
