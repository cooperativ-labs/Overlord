'use client';

import { useEffect } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';

import { useSystemNotifications } from './SystemNotificationContext';

type AppUpdateStatus = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['appUpdate']['getStatus']>
>;

const AVAILABLE_NOTIFICATION_ID = 'app-update-available';
const DOWNLOADED_NOTIFICATION_ID = 'app-update-downloaded';

function getDismissKey(status: AppUpdateStatus): string {
  const version = status.availableVersion ?? status.currentVersion;
  return `overlord-app-update-${version}`;
}

/**
 * Surfaces a system notification when the desktop app reports an update is available.
 */
export function useAppUpdateNotifications() {
  const { api, isElectron } = useElectron();
  const { addNotification, dismissNotification } = useSystemNotifications();

  useEffect(() => {
    if (!isElectron || !api?.appUpdate) return;

    let cancelled = false;

    const clearNotifications = () => {
      dismissNotification(AVAILABLE_NOTIFICATION_ID);
      dismissNotification(DOWNLOADED_NOTIFICATION_ID);
    };

    const syncNotification = (status: AppUpdateStatus) => {
      if (cancelled) return;

      if (status.phase === 'available') {
        dismissNotification(DOWNLOADED_NOTIFICATION_ID);
        addNotification({
          id: AVAILABLE_NOTIFICATION_ID,
          type: 'update',
          title: 'App update available',
          message: `Version ${status.availableVersion ?? 'latest'} is ready to download.`,
          dismissKey: getDismissKey(status),
          action: {
            label: 'Download update',
            onClick: () => {
              void api.appUpdate.downloadUpdate();
            }
          }
        });
        return;
      }

      if (status.phase === 'downloaded') {
        dismissNotification(AVAILABLE_NOTIFICATION_ID);
        addNotification({
          id: DOWNLOADED_NOTIFICATION_ID,
          type: 'update',
          title: 'App update ready to install',
          message: `Version ${status.availableVersion ?? 'latest'} has finished downloading.`,
          dismissKey: `${getDismissKey(status)}-downloaded`,
          action: {
            label: 'Restart now',
            onClick: () => {
              void api.appUpdate.quitAndInstall();
            }
          }
        });
        return;
      }

      clearNotifications();
    };

    void api.appUpdate
      .getStatus()
      .then(syncNotification)
      .catch(() => {
        clearNotifications();
      });

    const unsubscribe = api.appUpdate.onStatus(syncNotification);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [addNotification, api, dismissNotification, isElectron]);
}
