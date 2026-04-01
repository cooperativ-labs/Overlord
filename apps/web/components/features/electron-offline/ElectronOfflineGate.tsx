'use client';

import type { ReactNode } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { useOnlineStatus } from '@/lib/hooks/use-online-status';

import { ElectronOfflineScreen } from './ElectronOfflineScreen';

type Props = {
  children: ReactNode;
};

/**
 * Wraps the application in Electron and shows an offline screen when the
 * device loses Internet connectivity. In a regular browser context this
 * component renders its children unconditionally.
 */
export function ElectronOfflineGate({ children }: Props) {
  const { isElectron } = useElectron();
  const { isOnline, retry } = useOnlineStatus();

  if (isElectron && !isOnline) {
    return (
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        {/* Electron title bar drag region */}
        <div className="electron-drag-region shrink-0" />
        <ElectronOfflineScreen onRetry={retry} />
      </div>
    );
  }

  return <>{children}</>;
}
