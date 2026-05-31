'use client';

import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { getEditorSchemeAction, saveEditorSchemeAction } from '@/lib/actions/profile-settings';
import {
  DEFAULT_EDITOR_SCHEME,
  EDITOR_SCHEME_OPTIONS,
  getEditorSchemeLabel
} from '@/lib/helpers/editor-scheme';

export function TerminalPage({
  open: _open,
  onNavigate
}: {
  open: boolean;
  onNavigate?: (section: string) => void;
}) {
  const [editorScheme, setEditorScheme] = useState(DEFAULT_EDITOR_SCHEME);
  const [editorSchemeLoading, setEditorSchemeLoading] = useState(false);
  const [editorSchemeError, setEditorSchemeError] = useState<string | null>(null);
  const [editorSchemeSaveState, setEditorSchemeSaveState] = useState<ButtonLoadingState>('default');

  const loadEditorScheme = useCallback(async () => {
    setEditorSchemeLoading(true);
    setEditorSchemeError(null);
    try {
      const savedScheme = await getEditorSchemeAction();
      if (savedScheme) {
        setEditorScheme(savedScheme);
      }
    } catch (error) {
      console.error('Failed to load editor scheme:', error);
      setEditorSchemeError(
        error instanceof Error ? error.message : 'Failed to load editor scheme.'
      );
    } finally {
      setEditorSchemeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEditorScheme();
  }, [loadEditorScheme]);

  async function handleSaveEditorScheme() {
    setEditorSchemeSaveState('loading');
    setEditorSchemeError(null);
    try {
      const saved = await saveEditorSchemeAction(editorScheme);
      setEditorScheme(saved);
      setEditorSchemeSaveState('success');
    } catch (error) {
      console.error('Failed to save editor scheme:', error);
      setEditorSchemeSaveState('error');
      setEditorSchemeError(
        error instanceof Error ? error.message : 'Failed to save editor scheme.'
      );
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Terminal settings</h3>
          <p className="text-xs text-muted-foreground">
            Terminal launch settings are now configured per device on the Execution Targets page, so
            you can choose how Overlord opens a terminal for each machine you run agents on.
          </p>
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onNavigate?.('Execution Targets')}
          >
            Configure terminal settings
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="editor-scheme-select">File links</Label>
        <Select value={editorScheme} onValueChange={setEditorScheme} disabled={editorSchemeLoading}>
          <SelectTrigger id="editor-scheme-select">
            <SelectValue placeholder="Select an editor" />
          </SelectTrigger>
          <SelectContent>
            {EDITOR_SCHEME_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          File links in ticket artifacts will open in {getEditorSchemeLabel(editorScheme)}.
        </p>
        {editorSchemeLoading ? (
          <p className="text-xs text-muted-foreground">Loading saved editor preference…</p>
        ) : null}
        {editorSchemeError ? <p className="text-sm text-destructive">{editorSchemeError}</p> : null}
        <div className="flex justify-end">
          <LoadingButton
            buttonState={editorSchemeSaveState}
            setButtonState={setEditorSchemeSaveState}
            text="Save editor"
            loadingText="Saving..."
            successText="Saved"
            errorText="Retry"
            reset
            variant="outline"
            onClick={handleSaveEditorScheme}
          />
        </div>
      </div>
    </div>
  );
}
