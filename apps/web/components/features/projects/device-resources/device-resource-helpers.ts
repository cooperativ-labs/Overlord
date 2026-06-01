import type { ProjectDevice, UserDevice } from '@/lib/actions/devices';

export type DeviceWithProjectInfo = {
  device: UserDevice;
  projectDevice: ProjectDevice | null;
  hasResources: boolean;
};

/**
 * Splits the user's devices into those that have resource directories for the
 * current project and those that do not, attaching the matching project-device
 * record where one exists.
 */
export function partitionDevicesByProject(
  devices: UserDevice[],
  projectDevices: ProjectDevice[]
): { devicesInProject: DeviceWithProjectInfo[]; devicesNotInProject: DeviceWithProjectInfo[] } {
  const projectDeviceIds = new Set(projectDevices.map(d => d.id));
  const projectDeviceMap = new Map(projectDevices.map(d => [d.id, d]));

  const devicesWithProjectInfo: DeviceWithProjectInfo[] = devices.map(device => ({
    device,
    projectDevice: projectDeviceMap.get(device.id) ?? null,
    hasResources: projectDeviceIds.has(device.id)
  }));

  return {
    devicesInProject: devicesWithProjectInfo.filter(d => d.hasResources),
    devicesNotInProject: devicesWithProjectInfo.filter(d => !d.hasResources)
  };
}
