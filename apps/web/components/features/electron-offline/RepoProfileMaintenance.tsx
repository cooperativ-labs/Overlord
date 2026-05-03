'use client';

import { useEffect, useMemo } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import type { SidebarProject } from '@/lib/actions/project-types';
import { saveOperationsProfileAction } from '@/lib/actions/repo-profile';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const saveOperationsProfileActionWithRetry = withElectronActionRetry(saveOperationsProfileAction);

const MAINTENANCE_SETTINGS_KEY = 'repoProfileMaintenance.v1';
const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type RepoProfileMaintenanceProps = {
  projects: SidebarProject[];
};

type MaintenanceEntry = {
  checkedAt: string;
};

type MaintenanceState = Record<string, MaintenanceEntry>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMaintenanceState(value: unknown): MaintenanceState {
  if (!isRecord(value)) return {};

  const entries = Object.entries(value).flatMap(([projectId, entry]) => {
    if (!isRecord(entry) || typeof entry.checkedAt !== 'string' || !entry.checkedAt.trim()) {
      return [];
    }

    return [[projectId, { checkedAt: entry.checkedAt }]] as const;
  });

  return Object.fromEntries(entries);
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getLastCheckTimestamp(
  project: SidebarProject,
  maintenanceState: MaintenanceState
): number | null {
  const localCheckedAt = toTimestamp(maintenanceState[project.id]?.checkedAt);
  const remoteGeneratedAt = toTimestamp(project.operationsProfileGeneratedAt);

  if (localCheckedAt === null) return remoteGeneratedAt;
  if (remoteGeneratedAt === null) return localCheckedAt;
  return Math.max(localCheckedAt, remoteGeneratedAt);
}

export function RepoProfileMaintenance({ projects }: RepoProfileMaintenanceProps) {
  const { api, isElectron } = useElectron();

  const eligibleProjects = useMemo(
    () =>
      projects.filter(
        project =>
          typeof project.localWorkingDirectory === 'string' &&
          project.localWorkingDirectory.trim().length > 0
      ),
    [projects]
  );

  const projectSignature = useMemo(
    () =>
      eligibleProjects
        .map(project =>
          [
            project.id,
            project.localWorkingDirectory,
            project.operationsProfileFingerprint ?? '',
            project.operationsProfileGeneratedAt ?? ''
          ].join(':')
        )
        .sort()
        .join('|'),
    [eligibleProjects]
  );

  useEffect(() => {
    if (
      !isElectron ||
      !api?.filesystem?.rebuildOperationsProfile ||
      !api?.settings?.get ||
      !api?.settings?.set ||
      eligibleProjects.length === 0
    ) {
      return;
    }

    const electronApi = api;
    let cancelled = false;

    async function runMaintenance() {
      const rawState = await electronApi.settings.get(MAINTENANCE_SETTINGS_KEY);
      if (cancelled) return;

      const maintenanceState = parseMaintenanceState(rawState);
      const now = Date.now();
      const dueProjects = eligibleProjects.filter(project => {
        const lastCheckedAt = getLastCheckTimestamp(project, maintenanceState);
        return lastCheckedAt === null || now - lastCheckedAt >= CHECK_INTERVAL_MS;
      });

      if (dueProjects.length === 0) return;

      for (const project of dueProjects) {
        if (cancelled) return;

        const directory = project.localWorkingDirectory?.trim();
        if (!directory) continue;

        try {
          const result = await electronApi.filesystem.rebuildOperationsProfile({
            directory,
            currentFingerprint: project.operationsProfileFingerprint ?? null
          });
          if (cancelled) return;
          if (!result.ok) continue;

          if (result.rebuilt) {
            const saveResult = await saveOperationsProfileActionWithRetry(
              project.id,
              result.profile,
              result.fingerprint
            );
            if (cancelled) return;
            if (!saveResult.ok) continue;
          }

          maintenanceState[project.id] = {
            checkedAt: new Date().toISOString()
          };
          await electronApi.settings.set(MAINTENANCE_SETTINGS_KEY, maintenanceState);
        } catch (error) {
          console.error('[RepoProfileMaintenance] periodic rebuild failed', {
            projectId: project.id,
            error
          });
        }
      }
    }

    void runMaintenance();

    return () => {
      cancelled = true;
    };
  }, [api, eligibleProjects, isElectron, projectSignature]);

  return null;
}
