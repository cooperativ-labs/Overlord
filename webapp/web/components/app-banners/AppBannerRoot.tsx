import { AppBannerStack } from './AppBannerStack';
import { useAppUpdateNotifications } from './useAppUpdateNotifications';
import { useCliUpdateNotifications } from './useCliUpdateNotifications';

/**
 * Root component that renders app-update and CLI-update banners.
 *
 * Must be placed inside AppBannerProvider.
 */
export function AppBannerRoot() {
  useAppUpdateNotifications();
  useCliUpdateNotifications();

  return <AppBannerStack />;
}
