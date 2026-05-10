'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';

type HotkeyItem = {
  action: string;
  shortcut: string;
};

type QuickTaskApi = {
  getHotkey: () => Promise<{ accelerator: string; defaultAccelerator: string }>;
  setHotkey: (accelerator: string) => Promise<{ ok: boolean; accelerator: string; error?: string }>;
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

function keyFromPhysicalCode(event: globalThis.KeyboardEvent): string | null {
  const { code } = event;
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  if (/^Digit\d$/.test(code)) {
    return code.slice(5);
  }
  if (/^Numpad\d$/.test(code)) {
    return `num${code.slice(6)}`;
  }
  return null;
}

function eventToAccelerator(event: globalThis.KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }

  let key = keyFromPhysicalCode(event) ?? event.key;
  if (key.length === 1) {
    key = key.toUpperCase();
  } else if (/^F\d{1,2}$/.test(key)) {
    // F-keys pass through
  } else if (key === ' ') {
    key = 'Space';
  } else if (key === 'ArrowUp') {
    key = 'Up';
  } else if (key === 'ArrowDown') {
    key = 'Down';
  } else if (key === 'ArrowLeft') {
    key = 'Left';
  } else if (key === 'ArrowRight') {
    key = 'Right';
  } else if (key === 'Escape') {
    return null;
  }

  if (parts.length === 0) {
    // Disallow non-modified shortcuts to avoid system conflicts.
    return null;
  }

  parts.push(key);
  return parts.join('+');
}

function formatAcceleratorForDisplay(accel: string): string {
  return accel
    .replace(/Command/gi, '⌘')
    .replace(/Cmd/gi, '⌘')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Alt/gi, '⌥')
    .replace(/Option/gi, '⌥')
    .replace(/Shift/gi, '⇧')
    .replace(/\+/g, ' ');
}

export function HotkeysPage() {
  const { isElectron } = useElectron();
  const [items, setItems] = useState<HotkeyItem[]>([]);

  const [quickTaskAccelerator, setQuickTaskAccelerator] = useState<string | null>(null);
  const [defaultQuickTaskAccelerator, setDefaultQuickTaskAccelerator] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSavingHotkey, setIsSavingHotkey] = useState(false);

  useEffect(() => {
    const isMac =
      typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
    setItems([
      { action: 'Focus ticket search', shortcut: isMac ? '⌘F' : 'Ctrl+F' },
      { action: 'Create new ticket', shortcut: isMac ? '⌘N' : 'Ctrl+N' },
      {
        action: 'Toggle current changes (project pages)',
        shortcut: isMac ? '⇧⌘.' : 'Shift+Ctrl+.'
      },
      { action: 'Hard refresh app', shortcut: isMac ? '⌘R (Cmd+R)' : 'Ctrl+R' }
    ]);
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    const api = (window as unknown as { electronAPI?: { quickTask?: QuickTaskApi } }).electronAPI
      ?.quickTask;
    if (!api) return;
    api
      .getHotkey()
      .then(result => {
        setQuickTaskAccelerator(result.accelerator);
        setDefaultQuickTaskAccelerator(result.defaultAccelerator);
      })
      .catch(() => {
        // ignore
      });
  }, [isElectron]);

  async function persistHotkey(accelerator: string) {
    const api = (window as unknown as { electronAPI?: { quickTask?: QuickTaskApi } }).electronAPI
      ?.quickTask;
    if (!api) return;
    setIsSavingHotkey(true);
    try {
      const result = await api.setHotkey(accelerator);
      if (result.ok) {
        setQuickTaskAccelerator(result.accelerator);
        toast.success('Quick task hotkey updated');
      } else {
        toast.error(result.error ?? 'Failed to register hotkey');
      }
    } finally {
      setIsSavingHotkey(false);
    }
  }

  function handleStartCapture() {
    setIsCapturing(true);
  }

  useEffect(() => {
    if (!isCapturing) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCapturing(false);
        event.preventDefault();
        return;
      }
      const accel = eventToAccelerator(event);
      if (!accel) return;
      event.preventDefault();
      event.stopPropagation();
      setIsCapturing(false);
      void persistHotkey(accel);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isCapturing]);

  return (
    <div className="grid gap-6">
      {isElectron && quickTaskAccelerator !== null ? (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Global hotkey</h3>
            <p className="text-xs text-muted-foreground">
              These shortcuts work even when Overlord is not the active app.
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="grid gap-0.5">
                <span className="text-sm text-foreground">Open quick task window</span>
                <span className="text-xs text-muted-foreground">
                  Open a small floating widget to send a new task from anywhere.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleStartCapture}
                  disabled={isSavingHotkey}
                  className="min-w-[80px] rounded border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/70"
                >
                  {isCapturing ? (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Press keys…
                    </span>
                  ) : (
                    formatAcceleratorForDisplay(quickTaskAccelerator)
                  )}
                </button>
                {quickTaskAccelerator !== defaultQuickTaskAccelerator ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void persistHotkey(defaultQuickTaskAccelerator)}
                    disabled={isSavingHotkey || isCapturing}
                  >
                    Reset
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Keyboard shortcuts</h3>
          <p className="text-xs text-muted-foreground">
            Use these shortcuts anywhere in Overlord to move faster.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border">
          {items.map((item, index) => (
            <div
              key={item.action}
              className={`flex items-center justify-between px-3 py-2.5 ${
                index < items.length - 1 ? 'border-b' : ''
              }`}
            >
              <span className="text-sm text-foreground">{item.action}</span>
              <kbd className="rounded border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                {item.shortcut}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
