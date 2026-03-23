'use client';

import { AlertTriangle, ArrowRight, Info, RefreshCw, X } from 'lucide-react';

import { useSystemNotifications } from './SystemNotificationContext';
import type { SystemNotificationType } from './types';

function notificationIcon(type: SystemNotificationType) {
  switch (type) {
    case 'update':
      return <RefreshCw className="h-3.5 w-3.5 shrink-0" />;
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0" />;
    case 'info':
      return <Info className="h-3.5 w-3.5 shrink-0" />;
  }
}

function notificationColor(type: SystemNotificationType) {
  switch (type) {
    case 'update':
      return 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300';
    case 'info':
      return 'border-border bg-muted/50 text-muted-foreground';
  }
}

export function SystemNotificationBanner() {
  const { notifications, dismissNotification } = useSystemNotifications();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-md backdrop-blur-sm ${notificationColor(notification.type)}`}
        >
          <div className="mt-0.5">{notificationIcon(notification.type)}</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium leading-tight">{notification.title}</p>
            <p className="text-xs opacity-80 mt-0.5 leading-snug">{notification.message}</p>
            {notification.action && (
              <button
                type="button"
                onClick={notification.action.onClick}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
              >
                {notification.action.label}
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => dismissNotification(notification.id)}
            className="-m-1 shrink-0 rounded p-1 opacity-60 hover:opacity-100 transition-opacity"
          >
            <span className="sr-only">Dismiss</span>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
