import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { getDesktopChrome } from '@/lib/desktop-chrome';
import {
  isNativeNotificationsEnabled,
  setNativeNotificationsEnabled,
  subscribeNativeNotificationsEnabled
} from '@/lib/native-notification-preferences';
import { keys, useNotificationPreferences } from '@/lib/queries';

import type {
  NotificationMode,
  NotificationType
} from '../../../../packages/core/service/notifications/catalog.ts';
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES
} from '../../../../packages/core/service/notifications/catalog.ts';

type PermissionStatus = NotificationPermission | 'unsupported';

function readPermissionStatus({ isDesktop }: { isDesktop: boolean }): PermissionStatus {
  if (isDesktop) return 'granted';
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

function permissionLabel(status: PermissionStatus): string {
  switch (status) {
    case 'granted':
      return 'Allowed';
    case 'denied':
      return 'Blocked';
    case 'default':
      return 'Not requested';
    case 'unsupported':
      return 'Unavailable';
  }
}

export function NotificationsPage() {
  const { isDesktop } = getDesktopChrome();
  const queryClient = useQueryClient();
  const preferences = useNotificationPreferences();
  const [enabled, setEnabled] = useState(() => isNativeNotificationsEnabled());
  const [isSaving, setIsSaving] = useState(false);
  const [permission, setPermission] = useState<PermissionStatus>(() =>
    readPermissionStatus({ isDesktop })
  );

  useEffect(() => subscribeNativeNotificationsEnabled(setEnabled), []);

  async function handleToggle(next: boolean) {
    if (next && !isDesktop && 'Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      setPermission(result);
    }

    setNativeNotificationsEnabled({ enabled: next });
    setEnabled(next);
  }

  async function updateAccountPreferences(body: {
    enabled?: boolean;
    preferences?: Array<{ type: NotificationType; transport: 'realtime'; mode: NotificationMode }>;
  }) {
    setIsSaving(true);
    try {
      const updated = await api.updateNotificationPreferences(body);
      queryClient.setQueryData(keys.notificationPreferences, updated);
    } finally {
      setIsSaving(false);
    }
  }

  const accountEnabled = preferences.data?.enabled ?? true;
  const realtimeModes = new Map(
    preferences.data?.preferences
      .filter(preference => preference.transport === 'realtime')
      .map(preference => [preference.type, preference.mode]) ?? []
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-medium">Notifications</h2>
        <p className="text-sm text-muted-foreground">
          Choose what this account receives, then optionally mute native alerts on this device.
        </p>
      </div>

      <div className="max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="account-notifications-toggle">Account notifications</Label>
            <p className="text-xs text-muted-foreground">
              Turns all notification transports on or off for your account. Live Activities are
              unchanged.
            </p>
          </div>
          <Switch
            id="account-notifications-toggle"
            checked={accountEnabled}
            disabled={preferences.isLoading || isSaving}
            onCheckedChange={next => void updateAccountPreferences({ enabled: next })}
          />
        </div>

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <h3 className="text-sm font-medium">Desktop and browser alerts</h3>
            <p className="text-xs text-muted-foreground">
              These account settings also apply when you open Overlord on another computer.
            </p>
          </div>
          {NOTIFICATION_TYPES.map(type => {
            const descriptor = NOTIFICATION_CATALOG[type];
            if (!descriptor.transports.includes('realtime')) return null;
            return (
              <label className="flex items-center justify-between gap-4" key={type}>
                <span className="space-y-1">
                  <span className="block text-sm font-medium">{descriptor.label}</span>
                  <span className="block text-xs text-muted-foreground">{descriptor.detail}</span>
                </span>
                <select
                  aria-label={`${descriptor.label} notification mode`}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  disabled={preferences.isLoading || isSaving || !accountEnabled}
                  onChange={event =>
                    void updateAccountPreferences({
                      preferences: [
                        {
                          type,
                          transport: 'realtime',
                          mode: event.target.value as NotificationMode
                        }
                      ]
                    })
                  }
                  value={realtimeModes.get(type) ?? descriptor.defaultMode}
                >
                  <option value="alert">Alert</option>
                  <option value="silent">Silent</option>
                  <option value="off">Off</option>
                </select>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="native-notifications-toggle">Mute this device</Label>
            <p className="text-xs text-muted-foreground">
              {isDesktop
                ? 'Uses the desktop shell notification center. This cannot override account settings.'
                : 'Uses your browser permission. This cannot override account settings.'}
            </p>
          </div>
          <Switch
            id="native-notifications-toggle"
            checked={enabled}
            onCheckedChange={next => void handleToggle(next)}
          />
        </div>

        {!isDesktop ? (
          <div className="rounded-lg border px-4 py-3">
            <p className="text-sm">
              Browser permission:{' '}
              <span className="font-medium text-foreground">{permissionLabel(permission)}</span>
            </p>
            {permission === 'denied' ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Notifications are blocked in your browser settings. Allow them for this site, then
                turn the toggle on again.
              </p>
            ) : null}
            {permission === 'unsupported' ? (
              <p className="mt-1 text-xs text-muted-foreground">
                This browser does not support native notifications.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
