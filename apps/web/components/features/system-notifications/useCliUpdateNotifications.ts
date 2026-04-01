'use client';

import { useEffect } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import type { SettingsNavSection } from '@/components/modals/SettingsModal';

import { useSystemNotifications } from './SystemNotificationContext';

export function useCliUpdateNotifications(onOpenSettings?: (section?: SettingsNavSection) => void) {
  const { api, isElectron } = useElectron();
  const { addNotification, dismissNotification } = useSystemNotifications();

  useEffect(() => {
    if (!isElectron || !api?.cli) return;

    let cancelled = false;

    void api.cli
      .getInstallStatus()
      .then(status => {
        if (cancelled) return;
        if (!status.updateAvailable || !status.latestVersion) {
          dismissNotification('cli-update-available');
          return;
        }

        addNotification({
          id: 'cli-update-available',
          type: 'update',
          title: 'CLI update available',
          message: `Version ${status.latestVersion} is available for ovld.`,
          dismissKey: `overlord-cli-update-${status.latestVersion}`,
          action: onOpenSettings
            ? {
                label: 'Open CLI settings',
                onClick: () => onOpenSettings('CLI & Local Agents')
              }
            : undefined
        });
      })
      .catch(() => {
        dismissNotification('cli-update-available');
      });

    return () => {
      cancelled = true;
    };
  }, [addNotification, api, dismissNotification, isElectron, onOpenSettings]);
}
