'use client';

import { Check, Fingerprint, Pencil, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deletePasskeyAction,
  type PasskeyEntry,
  renamePasskeyAction
} from '@/lib/actions/passkeys';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

type PasskeyRowProps = {
  passkey: PasskeyEntry;
  onDeleted?: () => void | Promise<void>;
  onRenamed?: () => void | Promise<void>;
};

function PasskeyRow({ passkey, onDeleted, onRenamed }: PasskeyRowProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(passkey.friendlyName);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      const result = await deletePasskeyAction(passkey.id);
      if (result.error) {
        setErrorMessage(result.error);
        return;
      }
      await onDeleted?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete passkey.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveRename = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === passkey.friendlyName) {
      setIsEditing(false);
      setEditName(passkey.friendlyName);
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const result = await renamePasskeyAction(passkey.id, trimmed);
      if (result.error) {
        setErrorMessage(result.error);
        return;
      }
      setIsEditing(false);
      await onRenamed?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to rename passkey.');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = () => {
    setEditName(passkey.friendlyName);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditName(passkey.friendlyName);
    setErrorMessage(null);
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted-foreground">
          <Fingerprint className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleSaveRename();
                  if (e.key === 'Escape') cancelEditing();
                }}
                className="h-7 text-sm"
                maxLength={120}
                disabled={isSaving}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => void handleSaveRename()}
                disabled={isSaving}
              >
                <Check className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={cancelEditing}
                disabled={isSaving}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <p className="text-sm font-medium">{passkey.friendlyName || 'Unnamed passkey'}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span>Added {formatDate(passkey.createdAt)}</span>
            {passkey.lastUsedAt && <span>Last used {formatDate(passkey.lastUsedAt)}</span>}
          </div>
        </div>
        {!isEditing && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={startEditing}
              title="Rename passkey"
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              title="Delete passkey"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </div>
  );
}

type PasskeysListProps = {
  passkeys: PasskeyEntry[];
  onChanged?: () => void | Promise<void>;
};

export function PasskeysList({ passkeys, onChanged }: PasskeysListProps) {
  if (passkeys.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        No passkeys registered yet. Add one to enable passwordless sign-in.
      </div>
    );
  }

  return (
    <div className="divide-y rounded-lg border">
      {passkeys.map(pk => (
        <PasskeyRow key={pk.id} passkey={pk} onDeleted={onChanged} onRenamed={onChanged} />
      ))}
    </div>
  );
}
