import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { NOTIFICATION_CATALOG } from '../../../../packages/core/service/notifications/catalog.ts';
import type { NotificationDto } from '../../../shared/contract.ts';
import { api } from '../../lib/api.ts';
import { isNativeNotificationsEnabled } from '../../lib/native-notification-preferences.ts';
import { keys } from '../../lib/queries.ts';
import { useRealtime } from '../../lib/realtime.tsx';

let browserPermissionRequest: Promise<NotificationPermission> | null = null;

function playNotificationSound(soundUrl: string): void {
  if (typeof Audio === 'undefined') return;
  try {
    void new Audio(soundUrl).play().catch(() => {});
  } catch {
    // Audio is optional in restricted browser contexts.
  }
}

async function showBrowserNotification(notification: NotificationDto): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;

  let permission = Notification.permission;
  if (permission === 'default') {
    browserPermissionRequest ??= Notification.requestPermission();
    permission = await browserPermissionRequest;
  }
  if (permission !== 'granted') return false;

  const descriptor = NOTIFICATION_CATALOG[notification.type];
  new Notification(descriptor.label, {
    body: notification.presentation.body,
    tag: notification.id,
    silent: Boolean(descriptor.soundUrl)
  });
  return true;
}

async function renderNotification({
  notification,
  mode
}: {
  notification: NotificationDto;
  mode: 'alert' | 'silent' | 'off';
}): Promise<void> {
  const descriptor = NOTIFICATION_CATALOG[notification.type];
  // Durable history and realtime synchronization are independent from OS
  // presentation. The server-owned realtime preference determines whether the
  // account wants an alert; the local toggle is only an additive device mute.
  if (mode !== 'alert' || !isNativeNotificationsEnabled()) return;

  if (descriptor.soundUrl) playNotificationSound(descriptor.soundUrl);
  const payload = {
    title: descriptor.label,
    body: notification.presentation.body,
    tag: notification.id,
    soundUrl: descriptor.soundUrl ?? undefined
  };
  const shownByDesktop = await window.overlord?.showNotification?.(payload);
  if (shownByDesktop) return;
  await showBrowserNotification(notification);
}

/**
 * Renders only server-emitted notification rows. It neither derives candidates
 * from workflow entities nor performs mission/event reads; a single profile
 * history request resolves every notification id in the realtime batch.
 */
export function NotificationRenderer() {
  const queryClient = useQueryClient();
  const { lastChanges, lastSeq } = useRealtime();
  const handledSeq = useRef(0);

  useEffect(() => {
    if (lastSeq === 0 || lastSeq === handledSeq.current) return;
    handledSeq.current = lastSeq;
    const ids = new Set(
      lastChanges
        .filter(change => change.entityType === 'notification' && change.operation === 'insert')
        .map(change => change.entityId)
    );
    if (ids.size === 0) return;

    void queryClient
      .fetchQuery({
        queryKey: keys.notificationPreferences,
        queryFn: api.getNotificationPreferences
      })
      .then(preferences => {
        const modes = new Map(
          preferences.preferences
            .filter(preference => preference.transport === 'realtime')
            .map(preference => [preference.type, preferences.enabled ? preference.mode : 'off'])
        );
        return queryClient
          .fetchQuery({ queryKey: keys.notifications, queryFn: api.listNotifications })
          .then(rows =>
            Promise.all(
              rows
                .filter(row => ids.has(row.id))
                .map(notification =>
                  renderNotification({ notification, mode: modes.get(notification.type) ?? 'off' })
                )
            )
          );
      })
      .catch(error => {
        console.warn('Unable to render notification', error);
      });
  }, [lastChanges, lastSeq, queryClient]);

  return null;
}
