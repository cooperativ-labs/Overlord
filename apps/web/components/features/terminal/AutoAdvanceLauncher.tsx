'use client';

import { useDefaultProject } from '@/components/features/projects/DefaultProjectContext';
import { useAutoAdvanceLauncher } from '@/lib/hooks/use-auto-advance-launcher';

import { useTerminal } from './TerminalProvider';
import { useElectron } from './useElectron';

/**
 * Watches for protocol deliver auto-advance events and launches the next
 * objective in an external terminal on desktop.
 */
export function AutoAdvanceLauncher() {
  const { isElectron } = useElectron();
  const { launchAgent } = useTerminal();
  const { projects, defaultProject } = useDefaultProject();
  const organizationId = defaultProject?.organizationId;

  useAutoAdvanceLauncher({
    enabled: isElectron,
    organizationId,
    projects,
    launchAgent
  });

  return null;
}
