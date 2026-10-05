import { agentLaunchConfigApi } from './api/agent-launch-config.ts';
import { chatApi } from './api/chat.ts';
import { connectionsApi } from './api/connections.ts';
import { deferredWorkApi } from './api/deferred-work.ts';
import { everhourApi } from './api/everhour.ts';
import { githubApi } from './api/github.ts';
import { localTargetApi } from './api/local-target.ts';
import { missionsApi } from './api/missions.ts';
import { objectivesApi } from './api/objectives.ts';
import { organizationsApi } from './api/organizations.ts';
import { profileApi } from './api/profile.ts';
import { projectsApi } from './api/projects.ts';
import { runQueuesApi } from './api/run-queues.ts';
import { userTokensApi } from './api/user-tokens.ts';
import { webhooksApi } from './api/webhooks.ts';
import { workspacesApi } from './api/workspaces.ts';

export {
  ApiRequestError,
  type AuthProviders,
  type LocalTargetServerCapability,
  type Meta,
  type MetaCapabilities
} from './api/request.ts';
export type { RunnerQueueRequest, RunnerQueueStatus } from './api/run-queues.ts';

export const api = {
  ...profileApi,
  ...organizationsApi,
  ...userTokensApi,
  ...webhooksApi,
  ...workspacesApi,
  ...projectsApi,
  ...runQueuesApi,
  ...missionsApi,
  ...deferredWorkApi,
  ...objectivesApi,
  ...agentLaunchConfigApi,
  ...everhourApi,
  ...githubApi,
  ...localTargetApi,
  ...chatApi,
  ...connectionsApi
};
