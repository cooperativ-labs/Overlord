import { flagBoolean, flagValue, parseArgs } from './args.js';
import {
  bundledCodexModels,
  type CodexAccountSummary,
  type CodexLiveModel,
  type CodexLiveModels,
  queryCodexLiveModels,
  reportCodexLiveModels,
  writeCodexModelsCache
} from './codex-models.js';
import { CliError } from './errors.js';
import { printJson } from './output.js';
import { getCliVersion } from './version.js';

/**
 * `ovld models [codex] [--provider <id>] [--sync] [--workspace-id <id>] [--json]`
 *
 * Lists the models and reasoning efforts the Codex installation on this machine supports, asked
 * live through a short-lived `codex app-server`. `--sync` also records them as the workspace's
 * Codex models, so the model and effort picker in Overlord offers them. Without a reachable
 * Codex it shows the bundled defaults and `--sync` fails rather than reporting guesses.
 */
export async function runModelsCommand({ rest }: { rest: string[] }): Promise<void> {
  const parsed = parseArgs(rest);
  const json = flagBoolean(parsed.flags, '--json');
  const agent = parsed.positional[0] ?? 'codex';
  if (agent !== 'codex') {
    throw new CliError({
      message: `Live model discovery is available for codex only (got "${agent}").`
    });
  }
  const provider = flagValue(parsed.flags, '--provider')?.trim() || null;
  const sync = flagBoolean(parsed.flags, '--sync');

  const { resolveCodexBinary } = await import('./agent-session/codex-app-server/launch.js');
  const codex = resolveCodexBinary();
  const result = codex
    ? await queryCodexLiveModels({
        codexBin: codex.path,
        provider,
        includeAccount: !sync,
        clientVersion: getCliVersion()
      })
    : ({ ok: false, reason: '`codex` was not found on this machine' } as const);

  if (!result.ok) {
    if (sync) {
      throw new CliError({
        message: `Could not ask Codex for its models: ${result.reason}. Nothing was reported.`
      });
    }
    const models = bundledCodexModels();
    if (json) {
      printJson({ source: 'bundled', reason: result.reason, models });
      return;
    }
    console.log(`Could not ask Codex for its models (${result.reason}).`);
    console.log('Bundled defaults (what Overlord offers until this machine reports):');
    printModels(models);
    return;
  }

  writeCodexModelsCache(result.live);
  let synced: { workspaceId: string } | null = null;
  if (sync) synced = await syncLiveModels({ live: result.live, parsed });

  if (json) {
    printJson({
      ...result.live,
      ...(result.account ? { account: result.account } : {}),
      ...(synced ? { synced } : {})
    });
    return;
  }
  console.log(describeSource(result.live, result.account));
  printModels(result.live.models);
  if (result.live.providers.length > 0) {
    const providers = result.live.providers.map(entry =>
      entry.id === result.live.defaultProviderId ? `${entry.id} (default)` : entry.id
    );
    console.log(`Providers: ${providers.join(', ')}`);
  }
  if (synced) {
    console.log(`Updated the Codex model picker for workspace ${synced.workspaceId}.`);
  } else {
    console.log('Run `ovld models codex --sync` to offer these in the Overlord model picker.');
  }
}

async function syncLiveModels({
  live,
  parsed
}: {
  live: CodexLiveModels;
  parsed: ReturnType<typeof parseArgs>;
}): Promise<{ workspaceId: string }> {
  const { createBackendClient } = await import('./backend-client.js');
  const { resolveLaunchSettingsWorkspaceId } = await import('./launch-settings.js');
  const backend = createBackendClient();
  const workspaceId = await resolveLaunchSettingsWorkspaceId({
    backend,
    workspaceId: flagValue(parsed.flags, '--workspace-id')
  });
  if (!workspaceId) {
    throw new CliError({
      message: 'Could not tell which workspace to update; pass --workspace-id <id>.'
    });
  }
  try {
    await reportCodexLiveModels({ backend, workspaceId, live });
  } catch (error) {
    if (error instanceof CliError && error.status === 403) {
      throw new CliError({
        message:
          'Updating the workspace model picker needs launch:configure in that workspace. ' +
          'Ask a workspace admin to run `ovld models codex --sync`.',
        status: 403
      });
    }
    throw error;
  }
  return { workspaceId };
}

function describeSource(live: CodexLiveModels, account: CodexAccountSummary | null): string {
  const parts = [`Codex ${live.codexVersion ?? '(unknown version)'} on this machine`];
  if (live.provider) parts.push(`provider ${live.provider}`);
  if (account?.type) {
    parts.push(`account ${account.type}${account.planType ? ` (${account.planType})` : ''}`);
  } else if (account?.requiresOpenaiAuth) {
    parts.push('not signed in');
  }
  return `${parts.join(', ')}:`;
}

function printModels(models: CodexLiveModel[]): void {
  const width = Math.max(...models.map(model => model.id.length), 8);
  const nameWidth = Math.max(
    ...models.map(model => model.displayName.length + (model.isDefault ? 10 : 0)),
    8
  );
  for (const model of models) {
    const efforts =
      model.reasoningOptions.length > 0
        ? model.reasoningOptions
            .map(effort => (effort === model.defaultReasoningEffort ? `${effort}*` : effort))
            .join(', ')
        : '—';
    const marker = model.isDefault ? ' (default)' : '';
    console.log(
      `  ${model.id.padEnd(width)}  ${`${model.displayName}${marker}`.padEnd(nameWidth)}  efforts: ${efforts}`
    );
  }
  console.log('  (* = default effort)');
}
