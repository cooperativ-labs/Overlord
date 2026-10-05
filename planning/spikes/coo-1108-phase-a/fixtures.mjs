/* global setTimeout */
// Deterministic read-only tool fixtures for the coo:1108 Phase A Gemini proof. The
// provider round trip is live; these local tools stand in for the tool gateway so the
// proof does not depend on an uncontracted production interface.

const PROJECTS = {
  overlord: { projectId: 'proj_overlord', name: 'Overlord' },
  overlordmobile: { projectId: 'proj_mobile', name: 'OverlordMobile' }
};
const STATUS = {
  proj_overlord: { openMissions: 41, inReview: 6, defaultBranch: 'main' },
  proj_mobile: { openMissions: 12, inReview: 2, defaultBranch: 'main' }
};

export const TOOL_DECLARATIONS = [
  {
    name: 'find_project',
    description: 'Resolve a project name to its stable project ID. Read only.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Project name' } },
      required: ['name']
    }
  },
  {
    name: 'get_project_status',
    description: 'Read mission counts and default branch for a project ID returned by find_project. Read only.',
    parameters: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId']
    }
  }
];

export async function executeTool(name, args) {
  // A small delay so a crash during execution is observable.
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (name === 'find_project') {
    const hit = PROJECTS[String(args.name ?? '').toLowerCase().replace(/\s+/g, '')];
    return hit ? { found: true, ...hit } : { found: false };
  }
  if (name === 'get_project_status') {
    const status = STATUS[args.projectId];
    return status ? { projectId: args.projectId, ...status } : { error: 'unknown_project' };
  }
  return { error: 'unknown_tool' };
}

const SYSTEM =
  'You are a research assistant. Use only the provided read tools. Never guess project IDs; ' +
  'resolve them with find_project. When lookups are independent, request them in the same turn.';

export const SCENARIOS = {
  // Two dependent rounds: resolve both names (parallel), then read both statuses (parallel).
  mixed: {
    system: SYSTEM,
    prompt:
      'Compare open and in-review mission counts for the Overlord and OverlordMobile projects. ' +
      'Resolve both project IDs first, then read both statuses. Answer in two short sentences.'
  },
  // One name, therefore strictly sequential: find_project then get_project_status.
  sequential: {
    system: SYSTEM,
    prompt: 'How many missions are in review for the Overlord project? Answer in one sentence.'
  }
};
