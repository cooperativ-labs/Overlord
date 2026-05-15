const { existsSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    ...options
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  if (process.env.OVLD_ENABLE_ASAR_INTEGRITY_DIGEST !== '1') {
    console.log('[asar-integrity] Skipping digest for non-production build mode.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  if (!existsSync(appPath)) {
    throw new Error(`[asar-integrity] App not found: ${appPath}`);
  }

  console.log(`[asar-integrity] Enabling ASAR integrity digest for ${appPath}`);
  run('yarn', ['exec', 'asar', 'integrity-digest', 'on', appPath], {
    cwd: context.packager.projectDir
  });

  console.log('[asar-integrity] Verifying ASAR integrity digest');
  run('yarn', ['exec', 'asar', 'integrity-digest', 'verify', appPath], {
    cwd: context.packager.projectDir
  });
};
