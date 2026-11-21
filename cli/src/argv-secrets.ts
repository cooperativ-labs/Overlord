import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';

import { CliError } from './errors.js';

/**
 * Keep credentials off process argv.
 *
 * Any local user can read another process's argv (`ps`, `/proc/<pid>/cmdline`), and shells,
 * terminal launchers and crash reporters copy it into history and logs. Overlord credentials
 * therefore travel only through the environment, stdin, or owner-only (0600) files — the rule
 * `contract/protocol.md` already states for channel credentials, applied here to every process
 * the CLI starts on the user's behalf.
 */

/** Env keys whose values are Overlord credentials, in every casing the connectors use. */
export const OVERLORD_SECRET_ENV_KEYS = [
  'OVERLORD_USER_TOKEN',
  'OVLD_USER_TOKEN',
  'USER_TOKEN',
  'Overlord_USER_TOKEN',
  // The Claude plugin no longer has a `user_token` setting, but an older install may still
  // export it into a session's environment, so it stays redacted.
  'CLAUDE_PLUGIN_OPTION_USER_TOKEN',
  'OVERLORD_SESSION_CHANNEL_TOKEN'
] as const;

/** `out_`-prefixed USER_TOKEN secrets (same shape `redact-secrets.ts` masks). */
const USER_TOKEN_PATTERN = /out_[A-Za-z0-9_-]{8,}/;

/** Env var names that conventionally hold a secret. */
const SECRET_KEY_PATTERN =
  /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|PRIVATE_KEY|API_?KEY|ACCESS_KEY|CREDENTIAL)/i;

/** Shorter values are too likely to collide with ordinary argv text to treat as secrets. */
const MIN_SECRET_LENGTH = 8;

export function isSecretEnvKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function looksLikeUserToken(value: string): boolean {
  return USER_TOKEN_PATTERN.test(value);
}

/** Credential values present in `env` under the known Overlord credential keys. */
export function knownSecretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const values = new Set<string>();
  for (const key of OVERLORD_SECRET_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value && value.length >= MIN_SECRET_LENGTH) values.add(value);
  }
  return [...values];
}

/**
 * Index of the first argv element that carries a credential, or -1. A credential is a known
 * Overlord token value from `env`, any `out_…` USER_TOKEN, or one of `extraSecrets`.
 */
export function findSecretInArgv(
  argv: readonly string[],
  {
    env = process.env,
    extraSecrets = []
  }: { env?: NodeJS.ProcessEnv; extraSecrets?: readonly string[] } = {}
): number {
  const secrets = [
    ...knownSecretValues(env),
    ...extraSecrets.filter(secret => secret.length >= MIN_SECRET_LENGTH)
  ];
  return argv.findIndex(
    arg => looksLikeUserToken(arg) || secrets.some(secret => arg.includes(secret))
  );
}

/** Throw before spawning when any argv element would expose a credential. */
export function assertNoSecretInArgv(
  command: string,
  argv: readonly string[],
  options: { env?: NodeJS.ProcessEnv; extraSecrets?: readonly string[] } = {}
): void {
  const index = findSecretInArgv(argv, options);
  if (index === -1) return;
  // Never echo the value: name the command and position only.
  throw new CliError({
    message:
      `Refusing to run \`${command}\`: argument ${index + 1} contains an Overlord credential. ` +
      'Credentials must travel through the environment, stdin, or an owner-only file.'
  });
}

/**
 * `spawnSync` that refuses to start when argv carries a credential. Checks the caller's
 * environment and the child's (they can differ when the caller pins `env`).
 */
export function spawnSyncWithoutSecrets(
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions & { encoding: BufferEncoding }
): SpawnSyncReturns<string> {
  const extraSecrets = options.env ? knownSecretValues(options.env) : [];
  assertNoSecretInArgv(command, [command, ...args], { extraSecrets });
  return spawnSync(command, [...args], options);
}

/**
 * Split a launch environment into the part that may be rendered into a command line and the
 * part that must reach the child only through its process environment.
 */
export function partitionSecretEnv(env: Record<string, string>): {
  argvSafe: Record<string, string>;
  secret: Record<string, string>;
} {
  const argvSafe: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (isSecretEnvKey(key) || looksLikeUserToken(value)) secret[key] = value;
    else argvSafe[key] = value;
  }
  return { argvSafe, secret };
}
