import { Bell, Check, Inbox, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { NOTIFICATION_CATALOG } from '../../../../packages/core/service/notifications/catalog.ts';
import {
  useDismissNotification,
  useMarkNotificationRead,
  useNotifications
} from '../../lib/queries.ts';
import { Button } from '../ui/button.tsx';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet.tsx';

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  );
}

export function NotificationDrawer() {
  const [open, setOpen] = useState(false);
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const dismiss = useDismissNotification();
  const unreadCount = notifications.data?.filter(notification => !notification.readAt).length ?? 0;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        title="Notifications"
        aria-label={unreadCount ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        className="relative"
      >
        <Bell />
        {unreadCount > 0 ? (
          <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>Recent updates addressed to you.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto border-t">
            {notifications.isPending ? (
              <p className="p-4 text-sm text-muted-foreground">Loading notifications…</p>
            ) : notifications.isError ? (
              <p className="p-4 text-sm text-destructive">Unable to load notifications.</p>
            ) : (notifications.data?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
                <Inbox className="h-5 w-5" />
                <p className="text-sm">You’re all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y">
                {notifications.data!.map(notification => {
                  const descriptor = NOTIFICATION_CATALOG[notification.type];
                  return (
                    <li
                      key={notification.id}
                      className={notification.readAt ? 'p-4' : 'bg-muted/40 p-4'}
                    >
                      <div className="flex items-start gap-3">
                        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{descriptor.label}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {notification.presentation.body}
                          </p>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {formattedDate(notification.createdAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {!notification.readAt ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              title="Mark as read"
                              onClick={() =>
                                markRead.mutate({
                                  id: notification.id,
                                  revision: notification.revision
                                })
                              }
                            >
                              <Check />
                              <span className="sr-only">Mark as read</span>
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            title="Dismiss notification"
                            onClick={() =>
                              dismiss.mutate({
                                id: notification.id,
                                revision: notification.revision
                              })
                            }
                          >
                            <Trash2 />
                            <span className="sr-only">Dismiss notification</span>
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
