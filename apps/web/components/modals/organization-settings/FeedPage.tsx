'use client';

import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { updateOrganizationFeedRetentionDaysAction } from '@/lib/actions/organizations';

type FeedPageProps = {
  open: boolean;
  organizationId: number;
  initialRetentionDays: number;
};

export function FeedPage({ open, organizationId, initialRetentionDays }: FeedPageProps) {
  const [retentionDays, setRetentionDays] = useState(initialRetentionDays);
  const [savedRetentionDays, setSavedRetentionDays] = useState(initialRetentionDays);
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (open) {
      setRetentionDays(initialRetentionDays);
      setSavedRetentionDays(initialRetentionDays);
      setSaveState('default');
      setError(null);
    }
  }, [open, initialRetentionDays]);

  async function handleSave() {
    if (inFlightRef.current || retentionDays === savedRetentionDays) return;
    inFlightRef.current = true;
    setSaveState('loading');
    setError(null);
    try {
      const saved = await updateOrganizationFeedRetentionDaysAction(organizationId, retentionDays);
      setRetentionDays(saved);
      setSavedRetentionDays(saved);
      setSaveState('success');
    } catch (err) {
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Failed to save feed settings.');
    } finally {
      inFlightRef.current = false;
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-sm font-medium">Feed</h3>
        <p className="text-xs text-muted-foreground">
          Configure how the activity feed works for this organization.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="org-feed-retention-days">Post retention (days)</Label>
        <div className="flex items-center gap-3">
          <Input
            id="org-feed-retention-days"
            type="number"
            min={1}
            max={365}
            className="w-24"
            value={retentionDays}
            onChange={e => setRetentionDays(Number(e.target.value) || 30)}
            onBlur={handleSave}
          />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Feed posts older than this will be automatically cleaned up. Range: 1–365 days.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div>
        <LoadingButton
          buttonState={saveState}
          setButtonState={setSaveState}
          text="Save"
          loadingText="Saving..."
          successText="Saved"
          errorText="Retry"
          reset
          variant="outline"
          onClick={handleSave}
        />
      </div>
    </div>
  );
}
