'use client';

import { useEffect, useState } from 'react';

type HotkeyItem = {
  action: string;
  shortcut: string;
};

export function HotkeysPage() {
  const [items, setItems] = useState<HotkeyItem[]>([
    { action: 'Focus ticket search', shortcut: '⌘F' },
    { action: 'Create new ticket', shortcut: '⌘N' },
    { action: 'Toggle terminal', shortcut: 'Ctrl+`' }
  ]);

  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    setItems([
      { action: 'Focus ticket search', shortcut: isMac ? '⌘F' : 'Ctrl+F' },
      { action: 'Create new ticket', shortcut: isMac ? '⌘N' : 'Ctrl+N' },
      { action: 'Toggle terminal', shortcut: 'Ctrl+`' }
    ]);
  }, []);

  return (
    <div className="grid gap-5">
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
  );
}
