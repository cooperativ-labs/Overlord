'use client';

import { useEffect } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import type { SettingsNavSection } from '@/components/modals/SettingsModal';

import { useSystemNotifications } from './SystemNotificationContext';

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'OpenCode'
};

/**
 * Checks agent bundle statuses on mount and surfaces a system notification
 * when any installed bundle is stale (needs updating) or partial (needs repair).
 */
export function useAgentBundleNotifications(
  onOpenSettings?: (section?: SettingsNavSection) => void
) {
  const { isElectron } = useElectron();
  const { addNotification } = useSystemNotifications();

  useEffect(() => {
    if (!isElectron || !window.electronAPI?.agentBundle) return;

    let cancelled = false;

    void window.electronAPI.agentBundle.getAllStatuses().then(statuses => {
      if (cancelled) return;

      const staleAgents = statuses.filter(s => s.status === 'stale');
      const partialAgents = statuses.filter(s => s.status === 'partial');

      if (staleAgents.length > 0) {
        const names = staleAgents.map(s => AGENT_LABELS[s.agent] ?? s.agent).join(', ');
        // Include content hashes in dismiss key so new template changes always surface a fresh notification
        const dismissFingerprint = staleAgents
          .map(s => `${s.agent}:${s.currentContentHash ?? s.version}`)
          .join('-');

        addNotification({
          id: 'agent-bundle-stale',
          type: 'update',
          title: 'Agent plugin update available',
          message: `${names} ${staleAgents.length === 1 ? 'has' : 'have'} a newer plugin or connector version. Update to get the latest workflow instructions.`,
          dismissKey: `overlord-bundle-stale-dismissed-${dismissFingerprint}`,
          action: onOpenSettings
            ? {
                label: 'Open CLI settings',
                onClick: () => onOpenSettings('CLI & Local Agents')
              }
            : undefined
        });
      }

      if (partialAgents.length > 0) {
        const names = partialAgents.map(s => AGENT_LABELS[s.agent] ?? s.agent).join(', ');

        addNotification({
          id: 'agent-bundle-partial',
          type: 'warning',
          title: 'Agent plugin needs repair',
          message: `${names} ${partialAgents.length === 1 ? 'has' : 'have'} an incomplete plugin or connector setup. Repair to ensure agents work correctly.`,
          dismissKey: `overlord-bundle-partial-dismissed-${partialAgents.map(s => s.agent).join('-')}`,
          action: onOpenSettings
            ? {
                label: 'Open CLI settings',
                onClick: () => onOpenSettings('CLI & Local Agents')
              }
            : undefined
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isElectron, addNotification, onOpenSettings]);
}
