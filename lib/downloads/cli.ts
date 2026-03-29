import cliPackageJson from '../../packages/overlord-cli/package.json';

export const CLI_PACKAGE_NAME = 'overlord-cli';
export const CURRENT_CLI_VERSION = (cliPackageJson as { version: string }).version;
export const CLI_TARBALL_URL = `https://registry.npmjs.org/${CLI_PACKAGE_NAME}/-/${CLI_PACKAGE_NAME}-${CURRENT_CLI_VERSION}.tgz`;
export const CLI_INSTALL_COMMAND = `mkdir -p "$HOME/.local/lib/overlord-cli" "$HOME/.local/bin" && curl -fsSL ${CLI_TARBALL_URL} | tar -xz -C "$HOME/.local/lib/overlord-cli" --strip-components=1 && chmod +x "$HOME/.local/lib/overlord-cli/bin/ovld.mjs" && ln -sf "$HOME/.local/lib/overlord-cli/bin/ovld.mjs" "$HOME/.local/bin/ovld" && ln -sf "$HOME/.local/lib/overlord-cli/bin/ovld.mjs" "$HOME/.local/bin/overlord"`;
export const CLI_DOWNLOAD_COMMAND = `curl -fsSL ${CLI_TARBALL_URL} -o overlord-cli-${CURRENT_CLI_VERSION}.tgz`;
