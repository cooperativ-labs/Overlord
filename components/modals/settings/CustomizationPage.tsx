'use client';

import { useCallback, useEffect, useState } from 'react';

import { MarkdownContent } from '@/components/features/MarkdownContent';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Textarea } from '@/components/ui/textarea';
import {
  getCustomInstructionsAction,
  saveCustomInstructionsAction
} from '@/lib/actions/profile-settings';

export function CustomizationPage({ open }: { open: boolean }) {
  const [customInstructions, setCustomInstructions] = useState('');
  const [customInstructionsLoading, setCustomInstructionsLoading] = useState(false);
  const [customInstructionsError, setCustomInstructionsError] = useState<string | null>(null);
  const [customInstructionsSaveState, setCustomInstructionsSaveState] =
    useState<ButtonLoadingState>('default');
  const [customInstructionsLastLoadedAt, setCustomInstructionsLastLoadedAt] = useState<
    string | null
  >(null);

  const customInstructionsPreviewText =
    customInstructions.trim() || '_No custom instructions have been saved yet._';

  const loadCustomInstructions = useCallback(async () => {
    setCustomInstructionsLoading(true);
    setCustomInstructionsError(null);
    try {
      const loaded = await getCustomInstructionsAction();
      setCustomInstructions(loaded);
      setCustomInstructionsLastLoadedAt(new Date().toISOString());
    } catch (error) {
      console.error('Failed to load custom instructions:', error);
      setCustomInstructionsError(
        error instanceof Error ? error.message : 'Failed to load custom instructions.'
      );
    } finally {
      setCustomInstructionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setCustomInstructionsSaveState('default');
      setCustomInstructionsError(null);
      return;
    }
    void loadCustomInstructions();
  }, [open, loadCustomInstructions]);

  async function handleSave() {
    if (customInstructionsLoading) return;
    setCustomInstructionsSaveState('loading');
    setCustomInstructionsError(null);
    try {
      const saved = await saveCustomInstructionsAction(customInstructions);
      setCustomInstructions(saved);
      setCustomInstructionsLastLoadedAt(new Date().toISOString());
      setCustomInstructionsSaveState('success');
    } catch (error) {
      console.error('Failed to save custom instructions:', error);
      setCustomInstructionsSaveState('error');
      setCustomInstructionsError(
        error instanceof Error ? error.message : 'Failed to save custom instructions.'
      );
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="custom-instructions">Custom instructions</Label>
        <Textarea
          id="custom-instructions"
          placeholder="Example: Always prioritize security fixes, ask for missing context, and avoid pushing changes without tests."
          rows={8}
          value={customInstructions}
          onChange={event => setCustomInstructions(event.target.value)}
          disabled={customInstructionsLoading}
        />
        <p className="text-xs text-muted-foreground">
          These instructions support Markdown and are inserted at the beginning of every agent
          prompt whenever someone attaches to a ticket. Use them to share team conventions or
          priorities.
        </p>
        {customInstructionsLoading ? (
          <p className="text-xs text-muted-foreground">Loading current instructions…</p>
        ) : null}
        {customInstructionsLastLoadedAt ? (
          <p className="text-xs text-muted-foreground">
            Last refreshed {new Date(customInstructionsLastLoadedAt).toLocaleString()}
          </p>
        ) : null}
        {customInstructionsError ? (
          <p className="text-sm text-destructive">{customInstructionsError}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Preview</p>
        <LoadingButton
          buttonState={customInstructionsSaveState}
          setButtonState={setCustomInstructionsSaveState}
          text="Save instructions"
          loadingText="Saving..."
          successText="Saved"
          errorText="Retry"
          reset
          variant="outline"
          onClick={handleSave}
        />
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <MarkdownContent compact>{customInstructionsPreviewText}</MarkdownContent>
      </div>
    </div>
  );
}
