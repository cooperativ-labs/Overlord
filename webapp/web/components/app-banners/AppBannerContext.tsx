import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import type { AppBanner } from './types';

type AppBannerContextValue = {
  notifications: AppBanner[];
  addNotification: (notification: AppBanner) => void;
  dismissNotification: (id: string) => void;
};

const AppBannerContext = createContext<AppBannerContextValue | null>(null);

export function AppBannerProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppBanner[]>([]);

  const addNotification = useCallback((notification: AppBanner) => {
    // If it has a dismissKey, check localStorage first
    if (notification.dismissKey) {
      const dismissed = localStorage.getItem(notification.dismissKey);
      if (dismissed) return;
    }

    setNotifications(prev => {
      const index = prev.findIndex(n => n.id === notification.id);
      if (index === -1) return [...prev, notification];
      const next = [...prev];
      next[index] = notification;
      return next;
    });
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => {
      const notification = prev.find(n => n.id === id);
      if (notification?.dismissKey) {
        localStorage.setItem(notification.dismissKey, Date.now().toString());
      }
      return prev.filter(n => n.id !== id);
    });
  }, []);

  const value = useMemo(
    () => ({ notifications, addNotification, dismissNotification }),
    [notifications, addNotification, dismissNotification]
  );

  return <AppBannerContext.Provider value={value}>{children}</AppBannerContext.Provider>;
}

export function useAppBanners() {
  const context = useContext(AppBannerContext);
  if (!context) {
    throw new Error('useAppBanners must be used inside AppBannerProvider');
  }
  return context;
}
