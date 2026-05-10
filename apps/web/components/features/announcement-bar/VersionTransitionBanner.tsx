'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';

type UpdateStatus = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['appUpdate']['getStatus']>
>;

function isVersionSchemeTransition(current: string, available: string): boolean {
  const currentMajor = parseInt(current.split('.')[0], 10);
  const availableMajor = parseInt(available.split('.')[0], 10);
  return (
    !isNaN(currentMajor) &&
    !isNaN(availableMajor) &&
    currentMajor > availableMajor &&
    currentMajor < 5.2
  );
}

export function VersionTransitionBanner() {
  const { api, isElectron } = useElectron();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    if (!isElectron || !api) return;

    api.appUpdate
      .getStatus()
      .then(status => setUpdateStatus(status))
      .catch(() => null);

    return api.appUpdate.onStatus(status => setUpdateStatus(status));
  }, [api, isElectron]);

  if (
    !isElectron ||
    updateStatus?.phase !== 'not-available' ||
    !updateStatus.availableVersion ||
    !isVersionSchemeTransition(updateStatus.currentVersion, updateStatus.availableVersion)
  ) {
    return null;
  }

  return (
    <div className="relative flex items-center gap-x-6 bg-amber-50 px-6 py-2 dark:bg-amber-950 sm:px-3.5 ml-20">
      <p className="text-sm text-amber-800 dark:text-amber-200">
        <strong className="font-semibold">Manual update required</strong>
        <svg viewBox="0 0 2 2" className="mx-2 inline h-0.5 w-0.5 fill-current" aria-hidden="true">
          <circle cx={1} cy={1} r={1} />
        </svg>
        Version {updateStatus.availableVersion} uses a new versioning scheme and cannot be applied
        automatically. Please download the latest release to continue receiving updates.
      </p>
      <Link
        href="/downloads"
        className="flex-none rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white shadow-sm hover:bg-amber-500"
      >
        Download now <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}
