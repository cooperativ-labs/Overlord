'use client';

import { Check, ChevronDown, Cloud, Monitor } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type WebAgentMode = 'local' | 'cloud';

const options: { value: WebAgentMode; label: string; description: string; Icon: typeof Monitor }[] =
  [
    { value: 'local', label: 'Local', description: 'For local agents', Icon: Monitor },
    { value: 'cloud', label: 'Cloud', description: 'For cloud agents', Icon: Cloud }
  ];

export function WebAgentModeButton({
  mode,
  onModeChange
}: {
  mode: WebAgentMode;
  onModeChange: (mode: WebAgentMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === mode)!;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="h-8 gap-1.5 px-3 text-xs" size="sm" variant="outline">
          <current.Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {current.label}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1.5">
        <div className="flex flex-col gap-0.5">
          {options.map(({ value, description, Icon }) => (
            <button
              key={value}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                mode === value && 'bg-accent text-accent-foreground'
              )}
              onClick={() => {
                onModeChange(value);
                setOpen(false);
              }}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">{description}</span>
              {mode === value && <Check className="h-3 w-3 shrink-0 text-muted-foreground" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
