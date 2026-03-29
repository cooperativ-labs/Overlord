export function parseVersion(version) {
  if (typeof version !== 'string') return null;

  const parts = version.split('.');
  if (parts.length !== 3) return null;

  const [major, minor, patch] = parts.map(part => Number.parseInt(part, 10));
  if ([major, minor, patch].some(Number.isNaN)) return null;

  return { major, minor, patch };
}

export function deriveCliVersion(appVersion, cliVersion) {
  const app = parseVersion(appVersion);
  if (!app) return cliVersion;

  const cli = parseVersion(cliVersion);
  if (!cli || cli.major !== app.major || cli.minor !== app.minor) {
    return `${app.major}.${app.minor}.0`;
  }

  return cliVersion;
}
