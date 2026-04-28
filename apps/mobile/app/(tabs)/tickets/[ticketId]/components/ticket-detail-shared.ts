import { Platform } from 'react-native';

import { isLiquidGlassAvailable } from 'expo-glass-effect';

import type { ThemeColors } from '@/lib/colors';

export type Project = {
  id: string;
  name: string;
  color: string;
};

export type TicketDocument = {
  id: string;
  label: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  createdAt: string;
};

export const glassAvailable = Platform.OS === 'ios' && isLiquidGlassAvailable();

export function getEventIcons(colors: ThemeColors): Record<string, { name: string; color: string }> {
  return {
    system: { name: 'settings-outline', color: colors.mutedForeground },
    question: { name: 'help-circle-outline', color: '#f59e0b' },
    answer: { name: 'chatbubble-outline', color: colors.primary },
    update: { name: 'create-outline', color: colors.primary },
    context_write: { name: 'push-outline', color: colors.mutedForeground },
    context_read: { name: 'download-outline', color: colors.mutedForeground },
    artifact: { name: 'attach-outline', color: '#8b5cf6' },
    deliver: { name: 'checkmark-circle-outline', color: colors.success },
    status_change: { name: 'swap-horizontal-outline', color: colors.primary },
    alert: { name: 'warning-outline', color: colors.destructive },
    user_follow_up: { name: 'person-outline', color: '#f59e0b' },
    ticket_reopened: { name: 'refresh-outline', color: '#f59e0b' }
  };
}

export const eventLabels: Record<string, string> = {
  update: 'Update',
  question: 'Question',
  answer: 'Answer',
  deliver: 'Delivered',
  artifact: 'Artifact',
  status_change: 'Status Changed',
  alert: 'Notification',
  user_follow_up: 'Follow-up',
  context_write: 'Context Written',
  context_read: 'Context Read',
  ticket_reopened: 'Reopened'
};

export function getObjectiveStateColors(colors: ThemeColors): Record<string, string> {
  return {
    draft: colors.mutedForeground,
    executing: colors.primary,
    blocked: colors.destructive,
    complete: colors.success
  };
}

export function statusPillColor(status: string, colors: ThemeColors): string {
  const map: Record<string, string> = {
    draft: colors.mutedForeground,
    'next-up': colors.primary,
    execute: colors.success,
    review: '#f59e0b',
    complete: colors.success,
    blocked: colors.destructive,
    cancelled: colors.mutedForeground,
    icebox: colors.mutedForeground
  };
  return map[status] ?? colors.mutedForeground;
}
