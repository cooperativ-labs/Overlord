'use client';

import { useEffect, useState } from 'react';

import { useElectron } from './useElectron';

type Options = {
  workingDirectory?: string | null;
  hasProjectWorkingDirectory?: boolean;
};

export function useLocalDirectoryAccess({ workingDirectory, hasProjectWorkingDirectory }: Options) {
  const { api, isElectron } = useElectron();
  const [canRunAgent, setCanRunAgent] = useState<boolean>(
    isElectron ? Boolean(workingDirectory?.trim()) : (hasProjectWorkingDirectory ?? true)
  );

  useEffect(() => {
    if (!isElectron) {
      setCanRunAgent(hasProjectWorkingDirectory ?? true);
      return;
    }

    const directory = workingDirectory?.trim() ?? '';
    if (!directory) {
      setCanRunAgent(false);
      return;
    }

    if (!api?.filesystem?.directoryExists) {
      setCanRunAgent(hasProjectWorkingDirectory ?? true);
      return;
    }

    let cancelled = false;
    setCanRunAgent(false);

    void api.filesystem
      .directoryExists({ directory })
      .then(exists => {
        if (!cancelled) setCanRunAgent(exists);
      })
      .catch(() => {
        if (!cancelled) setCanRunAgent(false);
      });

    return () => {
      cancelled = true;
    };
  }, [api, hasProjectWorkingDirectory, isElectron, workingDirectory]);

  return canRunAgent;
}
