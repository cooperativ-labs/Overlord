'use client';

import { useTheme } from 'next-themes';

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

export function AppearancePage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Label htmlFor="theme-select">Theme</Label>
        <Select value={theme ?? 'system'} onValueChange={setTheme}>
          <SelectTrigger id="theme-select">
            <SelectValue placeholder="Select theme" />
          </SelectTrigger>
          <SelectContent>
            {themeOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">System follows your OS appearance setting.</p>
      </div>
    </div>
  );
}
