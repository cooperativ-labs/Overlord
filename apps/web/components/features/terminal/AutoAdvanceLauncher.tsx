'use client';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { useExecutionRequestLauncher } from '@/lib/hooks/use-execution-request-launcher';

import { useTerminal } from './TerminalProvider';
import { useElectron } from './useElectron';

/**
 * Claims durable execution requests and launches the assigned agent in an
 * external terminal. Runs whenever the desktop app is open so it acts as the
 * Electron-side runner; the standalone `ovld runner` CLI shares the same queue.
 */
export function AutoAdvanceLauncher() {
  const { isElectron } = useElectron();
  const { launchAgent } = useTerminal();
  const { defaultProject } = useDefaultProject();
  const organizationId = defaultProject?.organizationId;

  useExecutionRequestLauncher({
    enabled: isElectron,
    organizationId,
    launchAgent
  });

  return null;
}
