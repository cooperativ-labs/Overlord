'use client';

import { useEffect, useState } from 'react';

import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
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
import { getUserOrganizations, type UserOrganization } from '@/lib/actions/organizations';
import {
  useMoveProjectToOrganizationMutation,
  useUpdateProjectColorMutation,
  useUpdateProjectNameMutation
} from '@/lib/client-data/projects/mutations';

type GeneralPageProps = {
  open: boolean;
  projectId: string;
  organizationId: number;
  initialName: string;
  initialColor: string;
};

export function GeneralPage({
  open,
  projectId,
  organizationId,
  initialName,
  initialColor
}: GeneralPageProps) {
  const updateProjectNameMutation = useUpdateProjectNameMutation();
  const updateProjectColorMutation = useUpdateProjectColorMutation();
  const moveProjectMutation = useMoveProjectToOrganizationMutation();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [savedColor, setSavedColor] = useState(initialColor);
  const [nameSaveState, setNameSaveState] = useState<ButtonLoadingState>('default');
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<UserOrganization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(String(organizationId));
  const [moveSaveState, setMoveSaveState] = useState<ButtonLoadingState>('default');
  const [moveError, setMoveError] = useState<string | null>(null);

  useEffect(() => {
    setSavedColor(initialColor);
  }, [initialColor]);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSavedName(initialName);
      setSelectedOrgId(String(organizationId));
      setMoveSaveState('default');
      setMoveError(null);
    }
  }, [open, initialName, organizationId]);

  useEffect(() => {
    if (!open) return;
    getUserOrganizations()
      .then(setOrganizations)
      .catch(() => {});
  }, [open]);

  async function handleSaveName() {
    const trimmed = name.trim();
    if (trimmed === savedName) return;

    setNameSaveState('loading');
    setNameError(null);
    try {
      await updateProjectNameMutation.mutateAsync({ projectId, name: trimmed });
      setSavedName(trimmed);
      setNameSaveState('success');
    } catch (error) {
      setNameSaveState('error');
      setNameError(error instanceof Error ? error.message : 'Failed to update name.');
    }
  }

  async function handleSelectColor(color: string) {
    if (color.toLowerCase() === savedColor.toLowerCase()) return;

    setColorError(null);
    try {
      await updateProjectColorMutation.mutateAsync({ projectId, color: color.toLowerCase() });
      setSavedColor(color.toLowerCase());
    } catch (error) {
      setColorError(error instanceof Error ? error.message : 'Failed to update color.');
    }
  }

  async function handleMoveOrganization() {
    const targetOrganizationId = Number(selectedOrgId);
    if (targetOrganizationId === organizationId) return;

    setMoveSaveState('loading');
    setMoveError(null);
    try {
      await moveProjectMutation.mutateAsync({ projectId, targetOrganizationId });
      setMoveSaveState('success');
    } catch (error) {
      setMoveSaveState('error');
      setMoveError(error instanceof Error ? error.message : 'Failed to move project.');
    }
  }

  const hasOrgChanged = Number(selectedOrgId) !== organizationId;

  return (
    <>
      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Mobile App"
            className="h-8"
            onBlur={handleSaveName}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSaveName();
            }}
            disabled={nameSaveState === 'loading'}
          />
          <LoadingButton
            buttonState={nameSaveState}
            setButtonState={setNameSaveState}
            text="Save"
            loadingText="Saving…"
            successText="Saved"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={handleSaveName}
          />
        </div>
        {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
      </div>

      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">Color</label>
        <ProjectColorSetter value={savedColor} onSelect={handleSelectColor} />
        {colorError ? <p className="text-xs text-destructive">{colorError}</p> : null}
      </div>

      {organizations.length > 1 ? (
        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">Organization</label>
          <div className="flex gap-2">
            <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {organizations.map(org => (
                  <SelectItem key={org.id} value={String(org.id)}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LoadingButton
              buttonState={moveSaveState}
              setButtonState={setMoveSaveState}
              text="Move"
              loadingText="Moving…"
              successText="Moved"
              errorText="Retry"
              reset
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              disabled={!hasOrgChanged}
              onClick={handleMoveOrganization}
            />
          </div>
          {moveError ? <p className="text-xs text-destructive">{moveError}</p> : null}
        </div>
      ) : null}
    </>
  );
}
