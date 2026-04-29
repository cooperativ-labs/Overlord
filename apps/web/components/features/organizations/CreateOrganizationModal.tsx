'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { createOrganizationAction } from '@/lib/actions/organizations';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const createOrganizationWithRetry = withElectronActionRetry(createOrganizationAction);

type CreateOrganizationModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (organizationId: number) => void;
};

export function CreateOrganizationModal({
  open,
  onOpenChange,
  onCreated
}: CreateOrganizationModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setName('');
      setError(null);
      setButtonState('default');
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Organization name is required.');
      return;
    }
    setButtonState('loading');
    setError(null);
    try {
      const result = await createOrganizationWithRetry({ name: trimmed });
      setButtonState('success');
      onCreated(result.organizationId);
      handleOpenChange(false);
    } catch (err) {
      setButtonState('error');
      setError(err instanceof Error ? err.message : 'Failed to create organization.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Give your new workspace a name. You can invite teammates later.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-org-name">Organization name</FieldLabel>
            <Input
              id="new-org-name"
              value={name}
              onChange={e => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleSubmit();
              }}
              placeholder="Acme Inc."
              aria-invalid={!!error}
              aria-describedby={error ? 'new-org-error' : undefined}
              autoFocus
            />
          </Field>
          {error ? (
            <Alert id="new-org-error" variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            buttonState={buttonState}
            setButtonState={setButtonState}
            text="Create organization"
            loadingText="Creating…"
            successText="Created"
            errorText="Retry"
            onClick={handleSubmit}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
