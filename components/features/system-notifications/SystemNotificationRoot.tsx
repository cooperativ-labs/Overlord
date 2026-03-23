'use client';

import { SystemNotificationBanner } from './SystemNotificationBanner';
import { useAgentBundleNotifications } from './useAgentBundleNotifications';

/**
 * Root component that renders the system notification banner and
 * wires up notification sources (agent bundle staleness, etc.).
 *
 * Must be placed inside SystemNotificationProvider.
 */
export function SystemNotificationRoot() {
  // Wire up notification sources
  useAgentBundleNotifications();

  return <SystemNotificationBanner />;
}
