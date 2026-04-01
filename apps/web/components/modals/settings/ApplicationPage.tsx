'use client';

import { useTheme } from 'next-themes';
import { useCallback, useEffect, useState } from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  getAiTitleGenerationAction,
  saveAiTitleGenerationAction
} from '@/lib/actions/profile-settings';

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
] as const;

export function ApplicationPage() {
  const { theme, setTheme } = useTheme();
  const [aiTitleGeneration, setAiTitleGeneration] = useState(true);
  const [aiTitleLoading, setAiTitleLoading] = useState(false);

  const loadAiTitleGeneration = useCallback(async () => {
    try {
      const enabled = await getAiTitleGenerationAction();
      setAiTitleGeneration(enabled);
    } catch (error) {
      console.error('Failed to load AI title generation setting:', error);
    }
  }, []);

  useEffect(() => {
    void loadAiTitleGeneration();
  }, [loadAiTitleGeneration]);

  async function handleAiTitleToggle(checked: boolean) {
    setAiTitleLoading(true);
    try {
      const saved = await saveAiTitleGenerationAction(checked);
      setAiTitleGeneration(saved);
    } catch (error) {
      console.error('Failed to save AI title generation setting:', error);
    } finally {
      setAiTitleLoading(false);
    }
  }

  return (
    <div className="grid gap-8">
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

      <div className="flex items-center justify-between gap-4 rounded-md border p-4">
        <div className="space-y-1">
          <Label htmlFor="ai-title-generation" className="text-sm font-medium">
            AI ticket titles
          </Label>
          <p className="text-xs text-muted-foreground">
            When enabled, objectives longer than 100 characters are automatically summarised into a
            concise title using AI. Shorter objectives are used as-is.
          </p>
        </div>
        <Switch
          id="ai-title-generation"
          checked={aiTitleGeneration}
          onCheckedChange={handleAiTitleToggle}
          disabled={aiTitleLoading}
        />
      </div>
    </div>
  );
}
