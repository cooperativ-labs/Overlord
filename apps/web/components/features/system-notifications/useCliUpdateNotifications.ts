'use client';

import { useEffect } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';

import { useSystemNotifications } from './SystemNotificationContext';

export function useCliUpdateNotifications() {
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
          action: {
            label: 'Install',
            loadingText: 'Installing…',
            successText: 'Installed',
            onClick: async () => {
              const result = await api.cli!.install();
              if (!result.ok) throw new Error(result.error);
              dismissNotification('cli-update-available');
            }
          }
        });
      })
      .catch(() => {
        dismissNotification('cli-update-available');
      });

    return () => {
      cancelled = true;
    };
  }, [addNotification, api, dismissNotification, isElectron]);
}
