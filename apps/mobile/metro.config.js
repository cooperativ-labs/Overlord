const path = require('path');
const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getSentryExpoConfig(projectRoot);

// Watch the monorepo root for changes in shared packages
config.watchFolders = [monorepoRoot];

// Resolve modules from both the project and monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;