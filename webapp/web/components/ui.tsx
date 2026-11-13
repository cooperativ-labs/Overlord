import type { ObjectiveState, StatusType } from '@overlord/contract';
import { Ban, CheckCheck, Circle, CircleSlash, Eye, type LucideIcon, Play } from 'lucide-react';
import {
  type ButtonHTMLAttributes,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes
} from 'react';

import { Badge as ShadcnBadge } from '@/components/ui/badge';
import { Button as ShadcnButton } from '@/components/ui/button';
import { Card as ShadcnCard } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ---- Status / priority vocab → presentation ------------------------------

export interface StatusStyle {
  label: string;
  icon: LucideIcon;
  text: string;
  bg: string;
  rail: string;
  /** Faint, status-tinted fill for the horizontal divider line in list headers. */
  rule: string;
}

// Single source of truth for stage → icon/color across the board, list, and
// workflow settings views.
export const STATUS_CONFIG: Record<StatusType, StatusStyle> = {
  draft: {
    label: 'Draft',
    icon: Circle,
    text: 'text-muted-foreground',
    bg: 'bg-muted',
    rail: 'border-l-border',
    rule: 'bg-border'
  },
  next: {
    label: 'Next',
    icon: Circle,
    text: 'text-indigo-600 dark:text-indigo-400',
    bg: 'bg-indigo-500/15',
    rail: 'border-l-indigo-500/40',
    rule: 'bg-indigo-500/25'
  },
  execute: {
    label: 'Execute',
    icon: Play,
    text: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/15',
    rail: 'border-l-blue-500/40',
    rule: 'bg-blue-500/25'
  },
  review: {
    label: 'Review',
    icon: Eye,
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/15',
    rail: 'border-l-amber-500/40',
    rule: 'bg-amber-500/25'
  },
  complete: {
    label: 'Complete',
    icon: CheckCheck,
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/15',
    rail: 'border-l-emerald-500/40',
    rule: 'bg-emerald-500/25'
  },
  blocked: {
    label: 'Blocked',
    icon: Ban,
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/15',
    rail: 'border-l-red-500/40',
    rule: 'bg-red-500/25'
  },
  cancelled: {
    label: 'Cancelled',
    icon: CircleSlash,
    text: 'text-zinc-500 dark:text-zinc-400',
    bg: 'bg-zinc-500/15',
    rail: 'border-l-zinc-500/40',
    rule: 'bg-zinc-500/25'
  }
};

export const STATUS_LABEL: Record<StatusType, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([type, style]) => [type, style.label])
) as Record<StatusType, string>;

export function statusClasses(type: StatusType): string {
  switch (type) {
    case 'draft':
      return 'text-slate-600';
    case 'next':
      return 'text-indigo-700';
    case 'execute':
      return 'text-blue-700';
    case 'review':
      return 'text-amber-700';
    case 'complete':
      return 'text-emerald-700';
    case 'blocked':
      return 'text-red-700';
    case 'cancelled':
      return 'text-zinc-600';
  }
}

export const OBJECTIVE_STATE_LABEL: Record<ObjectiveState, string> = {
  future: 'Future',
  draft: 'Draft',
  submitted: 'Submitted',
  launching: 'Launching',
  executing: 'Executing',
  pending_delivery: 'Pending delivery',
  complete: 'Complete'
};

// ---- Primitives (shadcn-backed app wrappers) ------------------------------

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <ShadcnBadge variant="outline" className={cn('rounded-full ring-1 ring-inset', className)}>
      {children}
    </ShadcnBadge>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonVariantMap: Record<ButtonVariant, ComponentProps<typeof ShadcnButton>['variant']> = {
  primary: 'default',
  secondary: 'secondary',
  ghost: 'ghost',
  danger: 'destructive'
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <ShadcnButton variant={buttonVariantMap[variant]} className={className} {...props} />;
}

export function Card({
  children,
  className = '',
  onClick
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <ShadcnCard
      onClick={onClick}
      className={cn(onClick && 'cursor-pointer transition hover:ring-primary/50', className)}
    >
      {children}
    </ShadcnCard>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <Input className={className} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <Textarea className={className} {...rest} />;
}

export function EmptyState({
  title,
  hint,
  action
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary" />
      {label ?? 'Loading…'}
    </div>
  );
}

// Inline click-to-edit text now lives in its own component; import it from
// `./InlineEditField` (exported as `InlineEditField`, with an `EditableText`
// backwards-compatible alias).
