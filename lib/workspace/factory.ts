import { LocalWorkspaceClient } from './local';
import { RemoteWorkspaceClient } from './remote';
import type { WorkspaceClient, WorkspaceConfig } from './types';

export type RemoteClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createWorkspaceClient(
  config: WorkspaceConfig,
  remoteOptions?: RemoteClientOptions
): WorkspaceClient {
  if (config.mode === 'local') {
    return new LocalWorkspaceClient(config.workingDirectory);
  }
  return new RemoteWorkspaceClient({
    endpoint: config.tunnelEndpoint,
    authToken: config.helperAuthToken,
    remoteWorkingDirectory: config.remoteWorkingDirectory,
    fetchImpl: remoteOptions?.fetchImpl,
    timeoutMs: remoteOptions?.timeoutMs
  });
}
