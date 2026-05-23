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

        // CLI not installed at all
        if (!status.installed) {
          dismissNotification('cli-update-available');
          dismissNotification('cli-stale');
          addNotification({
            id: 'cli-not-installed',
            type: 'warning',
            title: 'CLI not installed',
            message: 'Install `ovld` so agents can launch in your terminal and attach to tickets.',
            action: {
              label: 'Install',
              loadingText: 'Installing…',
              successText: 'Installed',
              onClick: async () => {
                const result = await api.cli!.install();
                if (!result.ok) throw new Error(result.error);
                dismissNotification('cli-not-installed');
              }
            }
          });
          return;
        }

        // CLI installed but wrapper is stale (points to old app location)
        if (status.isStale) {
          dismissNotification('cli-not-installed');
          dismissNotification('cli-update-available');
          addNotification({
            id: 'cli-stale',
            type: 'warning',
            title: 'CLI needs reinstalling',
            message:
              'Your `ovld` wrapper is pointing to an older app location. Reinstall it to continue launching agents.',
            action: {
              label: 'Reinstall',
              loadingText: 'Reinstalling…',
              successText: 'Reinstalled',
              onClick: async () => {
                const result = await api.cli!.install();
                if (!result.ok) throw new Error(result.error);
                dismissNotification('cli-stale');
              }
            }
          });
          return;
        }

        // CLI installed and up to date — clear install/stale notifications
        dismissNotification('cli-not-installed');
        dismissNotification('cli-stale');

        // Check for available update
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
