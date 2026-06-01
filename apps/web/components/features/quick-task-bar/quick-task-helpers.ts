export type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
  organization_id: number;
  local_working_directory?: string | null;
  ssh_command?: string | null;
  remote_working_directory?: string | null;
};

export type StagedFile = {
  id: string;
  file: File;
};

export type QuickTaskWindowApi = {
  close: () => Promise<unknown>;
  setHeight: (height: number) => Promise<unknown>;
  setBounds?: (args: { height: number; barOffsetTop: number }) => Promise<unknown>;
  onShown: (cb: () => void) => () => void;
};

export type IdleCallbackHandle = number;
export type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};
export type IdleScheduler = {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: { timeout: number }
  ) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

export function getQuickTaskApi(): QuickTaskWindowApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { quickTask?: QuickTaskWindowApi } })
    .electronAPI;
  return api?.quickTask ?? null;
}

export function resolveProjectId(
  projects: ProjectOption[],
  defaultProjectId: string | null
): string {
  if (defaultProjectId && projects.some(project => project.id === defaultProjectId)) {
    return defaultProjectId;
  }
  return projects[0]?.id ?? '';
}
