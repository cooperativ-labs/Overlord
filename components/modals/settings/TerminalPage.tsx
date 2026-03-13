'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteSshServerProfileAction,
  listSshServerProfilesAction,
  type SshServerProfileSummary,
  upsertSshServerProfileAction
} from '@/lib/actions/ssh-servers';
import type { ButtonLoadingState } from '@/components/ui/loading-button';

const externalTerminalAppOptions = [
  { value: 'default', label: 'System Default' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm2' },
  { value: 'warp', label: 'Warp' },
  { value: 'ghostty', label: 'Ghostty' },
  { value: 'alacritty', label: 'Alacritty' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'hyper', label: 'Hyper' },
  { value: 'cmux', label: 'cmux' },
  { value: 'custom', label: 'Custom…' }
] as const;

const externalTerminalLaunchModeOptions = [
  { value: 'window', label: 'New window' },
  { value: 'tab', label: 'New tab' },
  { value: 'custom', label: 'Custom' }
] as const;

type SshServerFormState = {
  id?: string;
  name: string;
  host: string;
  port: string;
  username: string;
  privateKey: string;
  workingDirectory: string;
};

const EMPTY_FORM: SshServerFormState = {
  name: '',
  host: '',
  port: '22',
  username: '',
  privateKey: '',
  workingDirectory: '/home'
};

export function TerminalPage({ open }: { open: boolean }) {
  const { api, isElectron } = useElectron();

  // ── Electron-only: external terminal settings ──────────────────────────────
  const [terminalApp, setTerminalApp] = useState('default');
  const [terminalLaunchMode, setTerminalLaunchMode] = useState('window');
  const [terminalCustomHotkey, setTerminalCustomHotkey] = useState('');
  const [customTerminalApp, setCustomTerminalApp] = useState('');

  const supportsLaunchModeSelection =
    terminalApp !== 'ghostty' && terminalApp !== 'alacritty' && terminalApp !== 'kitty';

  const selectedTerminalLabel =
    externalTerminalAppOptions.find(opt => opt.value === terminalApp)?.label ?? 'your terminal';

  useEffect(() => {
    if (!api || !open) return;
    Promise.all([
      api.settings.get<string>('externalTerminalApp'),
      api.settings.get<string>('externalTerminalLaunchMode'),
      api.settings.get<string>('customExternalTerminalApp'),
      api.settings.get<string>('externalTerminalCustomHotkey')
    ]).then(([appValue, launchModeValue, customAppValue, customHotkeyValue]) => {
      if (appValue) setTerminalApp(appValue);
      if (launchModeValue) setTerminalLaunchMode(launchModeValue);
      if (typeof customAppValue === 'string') setCustomTerminalApp(customAppValue);
      if (typeof customHotkeyValue === 'string') setTerminalCustomHotkey(customHotkeyValue);
    });
  }, [api, open]);

  async function handleTerminalAppChange(value: string) {
    setTerminalApp(value);
    await api?.settings.set('externalTerminalApp', value);
  }

  async function handleTerminalLaunchModeChange(value: string) {
    setTerminalLaunchMode(value);
    await api?.settings.set('externalTerminalLaunchMode', value);
  }

  async function handleTerminalCustomHotkeyChange(value: string) {
    setTerminalCustomHotkey(value);
    await api?.settings.set('externalTerminalCustomHotkey', value);
  }

  function handleTerminalCustomHotkeyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Tab') return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      void handleTerminalCustomHotkeyChange('');
      return;
    }

    const isMac =
      typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

    const parts: string[] = [];
    if (event.metaKey) parts.push(isMac ? 'Cmd' : 'Meta');
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push(isMac ? 'Option' : 'Alt');
    if (event.shiftKey) parts.push('Shift');

    const modifierKeys = ['Meta', 'Control', 'Alt', 'Shift'];
    let key = event.key;

    if (!modifierKeys.includes(key)) {
      if (key.length === 1) {
        key = key.toUpperCase();
      } else if (key === ' ') {
        key = 'Space';
      }
      parts.push(key);
    }

    if (parts.length === 0) return;

    void handleTerminalCustomHotkeyChange(parts.join(' + '));
  }

  async function handleCustomTerminalAppChange(value: string) {
    setCustomTerminalApp(value);
    await api?.settings.set('customExternalTerminalApp', value);
  }

  // ── SSH server profiles ────────────────────────────────────────────────────
  const [profiles, setProfiles] = useState<SshServerProfileSummary[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<SshServerFormState>(EMPTY_FORM);
  const [saveState, setSaveState] = useState<ButtonLoadingState>('default');
  const [testState, setTestState] = useState<ButtonLoadingState>('default');

  const loadProfiles = useCallback(async () => {
    try {
      const data = await listSshServerProfilesAction();
      setProfiles(data);
    } catch {
      // Non-fatal — show empty list
    }
  }, []);

  useEffect(() => {
    if (open) void loadProfiles();
  }, [open, loadProfiles]);

  function openAddDrawer() {
    setForm(EMPTY_FORM);
    setSaveState('default');
    setTestState('default');
    setDrawerOpen(true);
  }

  function openEditDrawer(profile: SshServerProfileSummary) {
    setForm({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      username: profile.username,
      privateKey: '',
      workingDirectory: profile.working_directory
    });
    setSaveState('default');
    setTestState('default');
    setDrawerOpen(true);
  }

  async function handleDelete(id: string) {
    try {
      await deleteSshServerProfileAction(id);
      setProfiles(prev => prev.filter(p => p.id !== id));
      toast.success('Server removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete server');
    }
  }

  async function handleTest() {
    if (!form.host || !form.username || !form.privateKey) {
      toast.error('Fill in host, username, and private key before testing');
      return;
    }
    setTestState('loading');
    try {
      const res = await fetch('/api/ssh/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: form.host,
          port: Number(form.port) || 22,
          username: form.username,
          privateKey: form.privateKey
        })
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Connection failed');
      }
      setTestState('success');
      toast.success('Connection successful');
    } catch (error) {
      setTestState('error');
      toast.error(error instanceof Error ? error.message : 'Connection failed');
    }
  }

  async function handleSave() {
    if (!form.name || !form.host || !form.username) {
      toast.error('Name, host, and username are required');
      return;
    }
    if (!form.id && !form.privateKey) {
      toast.error('Private key is required');
      return;
    }
    setSaveState('loading');
    try {
      const saved = await upsertSshServerProfileAction({
        id: form.id,
        name: form.name,
        host: form.host,
        port: Number(form.port) || 22,
        username: form.username,
        privateKey: form.privateKey,
        workingDirectory: form.workingDirectory
      });
      setProfiles(prev => {
        const idx = prev.findIndex(p => p.id === saved.id);
        return idx >= 0 ? prev.with(idx, saved) : [...prev, saved];
      });
      setSaveState('success');
      setTimeout(() => {
        setDrawerOpen(false);
        setSaveState('default');
      }, 600);
    } catch (error) {
      setSaveState('error');
      toast.error(error instanceof Error ? error.message : 'Failed to save');
    }
  }

  return (
    <div className="grid gap-6">
      {/* ── Electron-only: external terminal ─────────────────────────────── */}
      {isElectron && (
        <>
          <div className="grid gap-2">
            <Label>Where to run terminal commands</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground">
              External terminal
            </div>
            <p className="text-xs text-muted-foreground">
              Overlord now launches agents in your system terminal instead of an in-app terminal.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="terminal-app">External terminal application</Label>
            <Select value={terminalApp} onValueChange={handleTerminalAppChange}>
              <SelectTrigger id="terminal-app">
                <SelectValue placeholder="Select terminal" />
              </SelectTrigger>
              <SelectContent>
                {externalTerminalAppOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {terminalApp === 'custom' && (
              <div className="grid gap-2">
                <Label htmlFor="custom-terminal-app">Custom terminal name or path</Label>
                <Input
                  id="custom-terminal-app"
                  placeholder="Example: cmux or /Applications/cmux.app"
                  value={customTerminalApp}
                  onChange={event => void handleCustomTerminalAppChange(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Overlord will open this app and type the launch command into the active terminal
                  session.
                </p>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            {supportsLaunchModeSelection && (
              <>
                <Label htmlFor="terminal-launch-mode">When opening a terminal</Label>
                <Select
                  value={terminalLaunchMode}
                  onValueChange={handleTerminalLaunchModeChange}
                >
                  <SelectTrigger id="terminal-launch-mode">
                    <SelectValue placeholder="Select behavior" />
                  </SelectTrigger>
                  <SelectContent>
                    {externalTerminalLaunchModeOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            {supportsLaunchModeSelection && terminalLaunchMode === 'custom' && (
              <div className="mt-2 grid gap-2">
                <Label htmlFor="terminal-custom-hotkey">Custom hotkey</Label>
                <Input
                  id="terminal-custom-hotkey"
                  placeholder="Press the key combination to use (e.g. Cmd + D)"
                  value={terminalCustomHotkey}
                  onKeyDown={handleTerminalCustomHotkeyKeyDown}
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Overlord will activate {selectedTerminalLabel}, send this hotkey to trigger your
                  preferred split or focus behavior, then type the launch command.
                </p>
              </div>
            )}
            {supportsLaunchModeSelection && terminalLaunchMode !== 'custom' && (
              <p className="text-xs text-muted-foreground">
                Choose the app and whether launches open in a new window or tab.
              </p>
            )}
          </div>
          <Separator />
        </>
      )}

      {/* ── SSH server profiles (all users) ──────────────────────────────── */}
      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>SSH servers</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Configure remote servers. Overlord will SSH in and start agents in a tmux session
              you can attach to from Termius or any SSH client.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={openAddDrawer} className="shrink-0">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add server
          </Button>
        </div>

        {profiles.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">No SSH servers configured yet.</p>
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {profiles.map(profile => (
              <div key={profile.id} className="flex items-center justify-between px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{profile.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {profile.username}@{profile.host}:{profile.port}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {profile.last_tested_at && (
                    <span className="text-xs text-emerald-600 mr-2">Connected</span>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => openEditDrawer(profile)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(profile.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Add / Edit drawer ─────────────────────────────────────────────── */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit SSH server' : 'Add SSH server'}</DialogTitle>
            <DialogDescription>
              Overlord will SSH into this server and start agents in a tmux session.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ssh-name">Display name</Label>
              <Input
                id="ssh-name"
                placeholder="Dev Box"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 grid gap-1.5">
                <Label htmlFor="ssh-host">Host</Label>
                <Input
                  id="ssh-host"
                  placeholder="192.168.1.100"
                  value={form.host}
                  onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ssh-port">Port</Label>
                <Input
                  id="ssh-port"
                  type="number"
                  placeholder="22"
                  value={form.port}
                  onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ssh-username">Username</Label>
              <Input
                id="ssh-username"
                placeholder="ubuntu"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ssh-key">
                Private key (PEM){form.id && <span className="text-muted-foreground"> — leave blank to keep existing</span>}
              </Label>
              <Textarea
                id="ssh-key"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                className="font-mono text-xs h-28 resize-none"
                value={form.privateKey}
                onChange={e => setForm(f => ({ ...f, privateKey: e.target.value }))}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ssh-dir">Working directory</Label>
              <Input
                id="ssh-dir"
                placeholder="/home/ubuntu/myproject"
                value={form.workingDirectory}
                onChange={e => setForm(f => ({ ...f, workingDirectory: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Agent runs from this directory on the remote server.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <LoadingButton
              buttonState={testState}
              setButtonState={setTestState}
              text="Test connection"
              loadingText="Testing…"
              successText="Connected"
              errorText="Failed"
              variant="outline"
              onClick={handleTest}
            />
            <LoadingButton
              buttonState={saveState}
              setButtonState={setSaveState}
              text="Save"
              loadingText="Saving…"
              successText="Saved"
              errorText="Error"
              onClick={handleSave}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
