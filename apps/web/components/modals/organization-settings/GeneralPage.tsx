'use client';

import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { GitProvider } from '@/lib/actions/organizations';
import {
  updateOrganizationGitProviderAction,
  updateOrganizationNameAction
} from '@/lib/actions/organizations';

type GeneralPageProps = {
  open: boolean;
  organizationId: number;
  initialName: string;
  initialGitProvider: GitProvider | null;
  onNameChange: (name: string) => void;
};

export function GeneralPage({
  open,
  organizationId,
  initialName,
  initialGitProvider,
  onNameChange
}: GeneralPageProps) {
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);

  const [gitProvider, setGitProvider] = useState<GitProvider | 'none'>(
    initialGitProvider ?? 'none'
  );
  const [gitProviderSaveState, setGitProviderSaveState] = useState<ButtonLoadingState>('default');
  const [gitProviderError, setGitProviderError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSavedName(initialName);
      setSaveState('default');
      setError(null);
      setGitProvider(initialGitProvider ?? 'none');
      setGitProviderSaveState('default');
      setGitProviderError(null);
    }
  }, [open, initialName, initialGitProvider]);

  async function handleSave() {
    const trimmed = name.trim();
    if (trimmed === savedName || !trimmed) return;
    setSaveState('loading');
    setError(null);
    try {
      const next = await updateOrganizationNameAction(organizationId, trimmed);
      setSavedName(next);
      setName(next);
      onNameChange(next);
      setSaveState('success');
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Failed to update name.');
    }
  }

  async function handleSaveGitProvider() {
    setGitProviderSaveState('loading');
    setGitProviderError(null);
    try {
      const next = await updateOrganizationGitProviderAction(
        organizationId,
        gitProvider === 'none' ? null : gitProvider
      );
      setGitProvider(next ?? 'none');
      setGitProviderSaveState('success');
    } catch (err) {
      setGitProviderSaveState('error');
      setGitProviderError(err instanceof Error ? err.message : 'Failed to update git provider.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Organization name"
            className="h-8"
            onBlur={handleSave}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSave();
            }}
            disabled={saveState === 'loading'}
          />
          <LoadingButton
            buttonState={saveState}
            setButtonState={setSaveState}
            text="Save"
            loadingText="Saving…"
            successText="Saved"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={handleSave}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <Separator />

      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">Git provider</label>
        <p className="text-xs text-muted-foreground">
          Select which git provider this organization uses. This determines how pull requests are
          created from the Changes panel.
        </p>
        <div className="flex gap-2">
          <Select
            value={gitProvider}
            onValueChange={value => setGitProvider(value as GitProvider | 'none')}
          >
            <SelectTrigger className="h-8 w-48">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              <SelectItem value="github">GitHub</SelectItem>
              <SelectItem value="bitbucket">Bitbucket</SelectItem>
            </SelectContent>
          </Select>
          <LoadingButton
            buttonState={gitProviderSaveState}
            setButtonState={setGitProviderSaveState}
            text="Save"
            loadingText="Saving…"
            successText="Saved"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={handleSaveGitProvider}
          />
        </div>
        {gitProviderError ? <p className="text-xs text-destructive">{gitProviderError}</p> : null}
      </div>
    </div>
  );
}
