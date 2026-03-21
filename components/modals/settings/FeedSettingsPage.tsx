'use client';

import { useCallback, useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { getFeedRetentionDaysAction, updateFeedRetentionDaysAction } from '@/lib/actions/feed';

export function FeedSettingsPage({ open }: { open: boolean }) {
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = await getFeedRetentionDaysAction();
      setRetentionDays(days);
    } catch (err) {
      console.error('Failed to load feed settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load feed settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setSaveState('default');
      setError(null);
      return;
    }
    void loadSettings();
  }, [open, loadSettings]);

  async function handleSave() {
    if (loading) return;
    setSaveState('loading');
    setError(null);
    try {
      const saved = await updateFeedRetentionDaysAction(retentionDays);
      setRetentionDays(saved);
      setSaveState('success');
    } catch (err) {
      console.error('Failed to save feed settings:', err);
      setSaveState('error');
      setError(err instanceof Error ? err.message : 'Failed to save feed settings.');
    }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Feed</h3>
        <p className="text-xs text-muted-foreground">
          Configure how the activity feed works for your organization.
        </p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="feed-retention-days">Post retention (days)</Label>
        <div className="flex items-center gap-3">
          <Input
            id="feed-retention-days"
            type="number"
            min={1}
            max={365}
            className="w-24"
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value) || 30)}
            disabled={loading}
          />
          <span className="text-xs text-muted-foreground">days</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Feed posts older than this will be automatically cleaned up. Range: 1–365 days.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

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
