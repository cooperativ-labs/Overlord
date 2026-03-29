import cliPackageJson from '../../packages/overlord-cli/package.json';

export const CLI_PACKAGE_NAME = 'overlord-cli';
export const CURRENT_CLI_VERSION = (cliPackageJson as { version: string }).version;
export const CLI_NPM_INSTALL_COMMAND = `npm install -g ${CLI_PACKAGE_NAME}`;
export const CLI_NPX_COMMAND = `npx ${CLI_PACKAGE_NAME} --help`;
export const CLI_TARBALL_URL = `https://registry.npmjs.org/${CLI_PACKAGE_NAME}/-/${CLI_PACKAGE_NAME}-${CURRENT_CLI_VERSION}.tgz`;
export const CLI_INSTALL_COMMAND = CLI_NPM_INSTALL_COMMAND;
export const CLI_DOWNLOAD_COMMAND = `curl -fsSL ${CLI_TARBALL_URL} -o overlord-cli-${CURRENT_CLI_VERSION}.tgz`;
