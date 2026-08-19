import { type Permission, PERMISSIONS } from '@overlord/auth';
import { type NextFunction, type Request, type Response, Router } from 'express';

import { ApiError } from '../../errors.ts';
import { missionRoute, projectRoute } from '../resource-routes.ts';

import {
  beginGitHubInstall,
  completeGitHubInstall,
  createMissionGitHubPullRequest,
  disconnectGitHub,
  getGitHubIntegration,
  getMissionGitHubPullRequest,
  getProjectGitHubLink,
  linkProjectGitHub,
  listGitHubRepos
} from './service.ts';
import {
  beginGitHubUserAuthorization,
  disconnectGitHubUser,
  getGitHubUserConnection,
  listGitHubRepositoryOwners
} from './user-oauth.ts';

type RouteHandler = (
  fn: (req: Request, res: Response) => unknown,
  options?: { mutates?: boolean; requires?: Permission }
) => (req: Request, res: Response, next: NextFunction) => void;

function workspaceId(req: Request): string {
  const value = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  if (!value) throw new ApiError(400, 'workspaceId query parameter is required');
  return value;
}

export function createGitHubExtensionRouter(
  handle: RouteHandler,
  options: { allowedBrowserOrigins?: readonly string[] } = {}
): Router {
  const router = Router();
  router.get(
    '/user-connection',
    handle(() => getGitHubUserConnection())
  );
  router.post(
    '/user-connection/authorize',
    handle(
      req =>
        beginGitHubUserAuthorization(
          {
            returnTo: typeof req.body?.returnTo === 'string' ? req.body.returnTo : undefined
          },
          options.allowedBrowserOrigins ?? []
        ),
      { mutates: true }
    )
  );
  router.delete(
    '/user-connection',
    handle(() => disconnectGitHubUser(), { mutates: true })
  );
  router.get(
    '/repository-owners',
    handle(() => listGitHubRepositoryOwners())
  );
  router.get(
    '/integration',
    handle(req => getGitHubIntegration(workspaceId(req)))
  );
  router.post(
    '/install',
    handle(req => beginGitHubInstall(workspaceId(req)), { mutates: true })
  );
  router.get(
    '/callback',
    handle(
      async req => {
        await completeGitHubInstall({
          installationId: String(req.query.installation_id ?? ''),
          state: typeof req.query.state === 'string' ? req.query.state : undefined
        });
        return { connected: true };
      },
      { mutates: true, requires: PERMISSIONS.WORKSPACE_UPDATE }
    )
  );
  router.delete(
    '/integration',
    handle(req => disconnectGitHub(workspaceId(req)), { mutates: true })
  );
  router.get(
    '/repos',
    handle(req =>
      listGitHubRepos(typeof req.query.q === 'string' ? req.query.q : null, workspaceId(req))
    )
  );
  router.get(
    '/projects/:projectId/link',
    handle(
      projectRoute(PERMISSIONS.PROJECT_READ, req => getProjectGitHubLink(req.params.projectId))
    )
  );
  router.put(
    '/projects/:projectId/link',
    handle(
      projectRoute(PERMISSIONS.PROJECT_UPDATE, req =>
        linkProjectGitHub(req.params.projectId, {
          repoFullName: typeof req.body?.repoFullName === 'string' ? req.body.repoFullName : null
        })
      ),
      { mutates: true }
    )
  );
  router.get(
    '/missions/:missionId/pull-request',
    handle(
      missionRoute(PERMISSIONS.MISSION_READ, req =>
        getMissionGitHubPullRequest(req.params.missionId)
      )
    )
  );
  router.post(
    '/missions/:missionId/pull-request',
    handle(
      missionRoute(PERMISSIONS.MISSION_UPDATE, req =>
        createMissionGitHubPullRequest(req.params.missionId, req.body ?? {})
      ),
      { mutates: true }
    )
  );
  return router;
}
