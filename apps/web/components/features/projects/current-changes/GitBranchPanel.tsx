'use client';

import { ArrowDownToLine, ArrowUpToLine, GitBranchPlus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import type { GitBranchEntry } from './types';

type GitBranchPanelProps = {
  branches: GitBranchEntry[];
  currentBranch: string | null;
  defaultBranch: string | null;
  workingDirectory: string;
  onChanged?: () => void;
};

export function GitBranchPanel({
  branches,
  currentBranch,
  defaultBranch,
  workingDirectory,
  onChanged
}: GitBranchPanelProps) {
  const { api } = useElectron();
  const [selectedBranch, setSelectedBranch] = useState(currentBranch ?? '');
  const [newBranchName, setNewBranchName] = useState('');
  const [switchButtonState, setSwitchButtonState] = useState<ButtonLoadingState>('default');
  const [createButtonState, setCreateButtonState] = useState<ButtonLoadingState>('default');
  const [pullButtonState, setPullButtonState] = useState<ButtonLoadingState>('default');
  const [pushButtonState, setPushButtonState] = useState<ButtonLoadingState>('default');

  useEffect(() => {
    setSelectedBranch(currentBranch ?? '');
  }, [currentBranch]);

  async function handleSwitchBranch() {
    if (!api?.filesystem?.gitCheckoutBranch) {
      toast.error('Branch switching requires the desktop app.');
      setSwitchButtonState('error');
      return;
    }
    if (!selectedBranch) {
      toast.error('Choose a branch to switch to.');
      setSwitchButtonState('error');
      return;
    }

    setSwitchButtonState('loading');
    try {
      const result = await api.filesystem.gitCheckoutBranch({
        directory: workingDirectory,
        options: { name: selectedBranch }
      });
      if (!result.ok || result.error) {
        toast.error(result.error ?? 'Failed to switch branches.');
        setSwitchButtonState('error');
        return;
      }
      toast.success(`Switched to ${result.branch ?? selectedBranch}.`);
      setSwitchButtonState('success');
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to switch branches.');
      setSwitchButtonState('error');
    }
  }

  async function handleCreateBranch() {
    if (!api?.filesystem?.gitCreateBranch) {
      toast.error('Branch creation requires the desktop app.');
      setCreateButtonState('error');
      return;
    }

    const branchName = newBranchName.trim();
    if (!branchName) {
      toast.error('Enter a new branch name.');
      setCreateButtonState('error');
      return;
    }

    setCreateButtonState('loading');
    try {
      const result = await api.filesystem.gitCreateBranch({
        directory: workingDirectory,
        options: { name: branchName }
      });
      if (!result.ok || result.error) {
        toast.error(result.error ?? 'Failed to create the branch.');
        setCreateButtonState('error');
        return;
      }
      toast.success(`Created and switched to ${result.branch ?? branchName}.`);
      setNewBranchName('');
      setCreateButtonState('success');
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create the branch.');
      setCreateButtonState('error');
    }
  }

  async function handlePull() {
    if (!api?.filesystem?.gitPull) {
      toast.error('Pull requires the desktop app.');
      setPullButtonState('error');
      return;
    }

    setPullButtonState('loading');
    try {
      const result = await api.filesystem.gitPull({ directory: workingDirectory });
      if (!result.ok || result.error) {
        toast.error(result.error ?? 'Failed to pull the current branch.');
        setPullButtonState('error');
        return;
      }
      toast.success(result.output || `Pulled ${result.branch ?? 'current branch'}.`);
      setPullButtonState('success');
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to pull the current branch.');
      setPullButtonState('error');
    }
  }

  async function handlePush() {
    if (!api?.filesystem?.gitPush) {
      toast.error('Push requires the desktop app.');
      setPushButtonState('error');
      return;
    }

    setPushButtonState('loading');
    try {
      const result = await api.filesystem.gitPush({ directory: workingDirectory });
      if (!result.ok || result.error) {
        toast.error(result.error ?? 'Failed to push the current branch.');
        setPushButtonState('error');
        return;
      }
      toast.success(result.output || `Pushed ${result.branch ?? 'current branch'}.`);
      setPushButtonState('success');
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to push the current branch.');
      setPushButtonState('error');
    }
  }

  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3">
        <p className="text-sm font-medium text-foreground">Branch controls</p>
        <p className="text-xs text-muted-foreground">
          {currentBranch ? `Current: ${currentBranch}` : 'No active branch detected.'}
          {defaultBranch ? ` Default base: ${defaultBranch}.` : null}
        </p>
      </div>

      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map(branch => (
                <SelectItem key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.upstream ? ` (${branch.upstream})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <LoadingButton
            buttonState={switchButtonState}
            disabled={!selectedBranch || selectedBranch === currentBranch}
            loadingText="Switching..."
            onClick={handleSwitchBranch}
            reset
            setButtonState={setSwitchButtonState}
            size="sm"
            text={
              <>
                <RefreshCw className="h-4 w-4" />
                Switch
              </>
            }
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            placeholder="feature/branch-name"
            value={newBranchName}
            onChange={event => setNewBranchName(event.target.value)}
          />
          <LoadingButton
            buttonState={createButtonState}
            disabled={!newBranchName.trim()}
            loadingText="Creating..."
            onClick={handleCreateBranch}
            reset
            setButtonState={setCreateButtonState}
            size="sm"
            text={
              <>
                <GitBranchPlus className="h-4 w-4" />
                Create
              </>
            }
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <LoadingButton
            buttonState={pullButtonState}
            disabled={!currentBranch}
            loadingText="Pulling..."
            onClick={handlePull}
            reset
            setButtonState={setPullButtonState}
            size="sm"
            text={
              <>
                <ArrowDownToLine className="h-4 w-4" />
                Pull
              </>
            }
            variant="outline"
          />
          <LoadingButton
            buttonState={pushButtonState}
            disabled={!currentBranch}
            loadingText="Pushing..."
            onClick={handlePush}
            reset
            setButtonState={setPushButtonState}
            size="sm"
            text={
              <>
                <ArrowUpToLine className="h-4 w-4" />
                Push
              </>
            }
            variant="outline"
          />
        </div>
      </div>
    </div>
  );
}
