import { useTheme } from 'next-themes';
import { useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
] as const;

export function ApplicationPage() {
  const { theme, setTheme } = useTheme();
  const [projectWindowMinutes, setProjectWindowMinutes] = useState(
    () => window.localStorage.getItem('overlord.defaultProjectWindowMinutes') ?? '15'
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Application</h2>
        <p className="text-sm text-muted-foreground">
          Appearance preferences for this browser session.
        </p>
      </div>

      <div className="max-w-md space-y-2">
        <Label htmlFor="theme-select">Theme</Label>
        <Select
          value={theme ?? 'system'}
          onValueChange={value => {
            if (value) setTheme(value);
          }}
        >
          <SelectTrigger id="theme-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themeOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          System follows your OS appearance setting. Stored locally in this browser.
        </p>
      </div>

      <div className="max-w-md space-y-2">
        <Label htmlFor="default-project-window">Recent project window (minutes)</Label>
        <Input
          id="default-project-window"
          type="number"
          min="0"
          value={projectWindowMinutes}
          onChange={event => {
            const value = event.target.value;
            setProjectWindowMinutes(value);
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed >= 0) {
              window.localStorage.setItem('overlord.defaultProjectWindowMinutes', String(parsed));
            }
          }}
        />
        <p className="text-xs text-muted-foreground">
          A mission composer uses your default project only when it was modified within this window;
          otherwise it starts in Inbox. Stored locally in this browser.
        </p>
      </div>
    </div>
  );
}
