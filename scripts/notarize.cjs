const { existsSync, rmSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

exports.default = async function notarize(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!existsSync(appPath)) {
    throw new Error(`[notarize] App not found: ${appPath}`);
  }

  const keychainProfile = process.env.NOTARY_KEYCHAIN_PROFILE || process.env.APPLE_KEYCHAIN_PROFILE;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  const hasKeychainProfile = Boolean(keychainProfile);
  const hasInlineCredentials = Boolean(appleId && appleIdPassword && teamId);

  if (!hasKeychainProfile && !hasInlineCredentials) {
    console.log('[notarize] Skipping notarization: set NOTARY_KEYCHAIN_PROFILE or APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID');
    return;
  }

  const zipPath = path.join(context.appOutDir, `${appName}.notarize.zip`);
  console.log(`[notarize] Creating notarization archive: ${zipPath}`);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath]);

  try {
    const args = ['notarytool', 'submit', zipPath, '--wait'];
    if (hasKeychainProfile) {
      args.push('--keychain-profile', keychainProfile);
    } else {
      args.push('--apple-id', appleId, '--password', appleIdPassword, '--team-id', teamId);
    }

    console.log('[notarize] Submitting to Apple notarization service...');
    run('xcrun', args);

    console.log('[notarize] Stapling notarization ticket...');
    run('xcrun', ['stapler', 'staple', appPath]);
    console.log('[notarize] Notarization complete.');
  } finally {
    if (existsSync(zipPath)) {
      rmSync(zipPath, { force: true });
    }
  }
};
