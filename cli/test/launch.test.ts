import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildLaunchPlan, interactiveLoginShellInvocation } from '../src/launch.ts';
import type { CliRuntime } from '../src/runtime.ts';

function runtime({
  title = 'Prompt Capture',
  objectives = [
    {
      id: 'objective-uuid',
      state: 'executing',
      instructionText: 'Ship it',
      displayId: 'coo:11.k7xm',
      displayKey: 'k7xm',
      title: 'Ship it'
    }
  ]
}: {
  title?: string;
  objectives?: Array<Record<string, unknown>>;
} = {}): CliRuntime {
  return {
    backend: {
      baseUrl: 'http://127.0.0.1:4310',
      health: async () => ({ ok: true }),
      get: async <T>(requestPath: string): Promise<T> => {
        if (requestPath.startsWith('/api/missions/') && requestPath.endsWith('/events')) {
          return [] as T;
        }
        if (requestPath.startsWith('/api/missions/') && requestPath.endsWith('/artifacts')) {
          return [] as T;
        }
        if (requestPath.startsWith('/api/objectives/') && requestPath.endsWith('/attachments')) {
          return [] as T;
        }
        if (requestPath.startsWith('/api/missions/')) {
          return {
            id: 'mission-uuid',
            displayId: 'coo:11',
            title,
            objectives
          } as T;
        }
        throw new Error(`Unexpected GET ${requestPath}`);
      },
      post: async () => {
        throw new Error('Unexpected POST');
      },
      patch: async () => {
        throw new Error('Unexpected PATCH');
      },
      delete: async () => {
        throw new Error('Unexpected DELETE');
      }
    },
    close: () => {}
  };
}

test('shell-composed launches use the configured interactive login shell', () => {
  assert.deepEqual(interactiveLoginShellInvocation("agp 'codex'", '/bin/zsh'), {
    command: '/bin/zsh',
    args: ['-ilc', "agp 'codex'"]
  });
  assert.deepEqual(interactiveLoginShellInvocation("agp 'codex'", '  '), {
    command: '/bin/bash',
    args: ['-ilc', "agp 'codex'"]
  });
});

test('buildLaunchPlan exports mission context for terminal prompt hooks', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-launch-env-'));
  const plan = await buildLaunchPlan({
    runtime: runtime(),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      terminalLauncher: 'Terminal',
      executionRequestId: 'request-123'
    }
  });

  assert.equal(plan.env.MISSION_ID, 'coo:11');
  assert.equal(plan.env.OVERLORD_MISSION_ID, 'coo:11');
  assert.equal(plan.env.OVERLORD_BACKEND_URL, 'http://127.0.0.1:4310');
  assert.equal(plan.env.OVERLORD_EXECUTION_REQUEST_ID, 'request-123');
  assert.equal(plan.env.OVERLORD_OBJECTIVE_ID, 'coo:11.k7xm');
  assert.match(plan.prompt, /immediately execute the current objective/i);
  assert.match(plan.prompt, /Do not wait for more instructions/i);

  const script = plan.execution.args[1] ?? '';
  const launchScriptPath = path.join(
    workingDirectory,
    '.overlord',
    'tmp',
    'launch-coo-11-request-123.sh'
  );
  assert.ok(script.includes(`/bin/bash '${launchScriptPath}'`));
  assert.ok(!script.includes(`export MISSION_ID='coo:11'`));

  const mode = statSync(launchScriptPath).mode & 0o777;
  assert.equal(mode, 0o700);
  const launchScript = readFileSync(launchScriptPath, 'utf8');
  assert.ok(launchScript.includes(`cd '${workingDirectory}'`));
  assert.ok(launchScript.includes(`export MISSION_ID='coo:11'`));
  assert.ok(launchScript.includes(`export OVERLORD_BACKEND_URL='http://127.0.0.1:4310'`));
  assert.ok(launchScript.includes(`'codex'`));
});

test('buildLaunchPlan omits blank objective slots from the prompt objective list', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-launch-blank-'));
  const plan = await buildLaunchPlan({
    runtime: runtime({
      objectives: [
        { id: 'objective-uuid', state: 'executing', instructionText: 'Ship it' },
        { id: 'blank-uuid', state: 'draft', instructionText: '   ' },
        { id: 'null-uuid', state: 'draft', instructionText: null }
      ]
    }),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      terminalLauncher: 'Terminal'
    }
  });

  assert.match(plan.prompt, /- objective \[executing\] Ship it/);
  // Blank slots exist only so the user can type a next objective; the agent
  // must not see them as objectives awaiting approval.
  assert.ok(!plan.prompt.includes('[draft]'));
});

test('buildLaunchPlan substitutes and exports launch env vars before pre-launch commands and the agent', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-launch-envvars-'));
  const plan = await buildLaunchPlan({
    runtime: runtime(),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      terminalLauncher: 'Terminal',
      launchEnvVars: {
        AGENT_POD_EXTRA_ALLOWED_PATHS: 'mission-{MISSION_ID}',
        STATIC_VALUE: 'plain'
      },
      preLaunchCommands: ['echo preparing'],
      executionRequestId: 'request-124'
    }
  });

  // Placeholders in env-var values resolve against the launch context and land in plan.env.
  assert.equal(plan.env.AGENT_POD_EXTRA_ALLOWED_PATHS, 'mission-coo:11');
  assert.equal(plan.env.STATIC_VALUE, 'plain');
  // Overlord's own launch env is preserved alongside user vars.
  assert.equal(plan.env.MISSION_ID, 'coo:11');

  const launchScriptPath = path.join(
    workingDirectory,
    '.overlord',
    'tmp',
    'launch-coo-11-request-124.sh'
  );
  const launchScript = readFileSync(launchScriptPath, 'utf8');
  assert.ok(launchScript.includes(`export AGENT_POD_EXTRA_ALLOWED_PATHS='mission-coo:11'`));
  assert.ok(launchScript.includes(`export STATIC_VALUE='plain'`));

  // Ordering: env exports run before the pre-launch commands, which run before the agent.
  const exportIdx = launchScript.indexOf('export AGENT_POD_EXTRA_ALLOWED_PATHS');
  const preLaunchIdx = launchScript.indexOf('echo preparing');
  const agentIdx = launchScript.indexOf(`'codex'`);
  assert.ok(exportIdx !== -1 && preLaunchIdx !== -1 && agentIdx !== -1);
  assert.ok(exportIdx < preLaunchIdx);
  assert.ok(preLaunchIdx < agentIdx);
});

test('buildLaunchPlan pins the Claude subagent caps and lets a project override them', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-launch-subagents-'));
  const plan = await buildLaunchPlan({
    runtime: runtime(),
    options: { agent: 'claude', missionId: 'coo:11', workingDirectory }
  });

  // Pinned to the harness's own documented values, so the number this run used is a property of
  // the launch rather than of whichever Claude Code build happens to be installed.
  assert.equal(plan.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, '20');
  assert.equal(plan.env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION, '200');
  assert.equal(plan.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH, '3');

  // Harness defaults are the floor, not the ceiling: a project that sets its own wins.
  const overridden = await buildLaunchPlan({
    runtime: runtime(),
    options: {
      agent: 'claude',
      missionId: 'coo:11',
      workingDirectory,
      launchEnvVars: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '4' }
    }
  });
  assert.equal(overridden.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, '4');

  // They are Claude-specific, not a global default leaking into every harness.
  const codex = await buildLaunchPlan({
    runtime: runtime(),
    options: { agent: 'codex', missionId: 'coo:11', workingDirectory }
  });
  assert.equal(codex.env.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS, undefined);
});

test('buildLaunchPlan passes PI model and thinking separately with a context file input', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-launch-pi-'));
  const plan = await buildLaunchPlan({
    runtime: runtime(),
    options: {
      agent: 'pi',
      missionId: 'coo:11',
      workingDirectory,
      model: 'zai/glm-5.2',
      thinking: 'high',
      flags: [{ name: '--approve' }]
    }
  });

  assert.equal(plan.command, 'pi');
  assert.deepEqual(plan.args, [
    '--model',
    'zai/glm-5.2',
    '--thinking',
    'high',
    '--approve',
    `@${plan.contextFile}`,
    'Attach to ovld mission coo:11 objective coo:11.k7xm, then immediately execute Ship it. Do not wait for more instructions.'
  ]);
  assert.ok(readFileSync(plan.contextFile, 'utf8').includes('# Overlord Mission: coo:11'));
});

test('buildLaunchPlan preserves the execution directive when context uses a file', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-launch-long-context-'));
  const plan = await buildLaunchPlan({
    runtime: runtime({ title: 'A'.repeat(4_100) }),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory
    }
  });

  assert.match(plan.prompt, /context file/i);
  assert.match(plan.prompt, /immediately execute its current objective/i);
  assert.match(plan.prompt, /Do not wait for more instructions/i);
});

test('buildLaunchPlan names the mission id concretely and keeps the execution request id out of the prompt', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-launch-ids-'));
  const executionRequestId = '431f0a7c-1f2a-4c5e-9a1b-2f0d7c4e6b81';
  const plan = await buildLaunchPlan({
    runtime: runtime(),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      executionRequestId
    }
  });

  const context = readFileSync(plan.contextFile, 'utf8');
  // The execution request id is launch plumbing that reaches the agent through the
  // environment. Printing it in the prompt made it the only UUID an agent could see,
  // and agents passed it to `--mission-id` (coo:695).
  assert.ok(!context.includes(executionRequestId));
  assert.equal(plan.env.OVERLORD_EXECUTION_REQUEST_ID, executionRequestId);
  // The attach command must carry the real mission id, not a `<id>` placeholder.
  assert.ok(context.includes('Mission ID: coo:11'));
  assert.ok(context.includes('Objective ID: coo:11.k7xm'));
  assert.ok(
    context.includes('ovld protocol attach --mission-id coo:11 --objective-id coo:11.k7xm')
  );
  assert.ok(!context.includes('--mission-id <id>'));
  assert.ok(plan.contextFile.endsWith('objective-coo-11-k7xm.md'));
  assert.equal(plan.env.OVERLORD_OBJECTIVE_ID, 'coo:11.k7xm');
  assert.equal(plan.objectiveDisplayId, 'coo:11.k7xm');
  assert.equal(plan.objectiveTitle, 'Ship it');
});
