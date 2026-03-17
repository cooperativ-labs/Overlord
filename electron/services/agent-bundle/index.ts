export {
  type AgentBundleAgent,
  type AgentBundleStatus,
  type BundleStatus,
  getAgentBundleStatus,
  getAllBundleStatuses,
  installAgentBundle,
  installAllBundles,
  type InstallResult,
  isBundleInstalled,
  repairAgentBundle,
  uninstallAgentBundle
} from './installer';
export {
  getAllSlashCommandStatuses,
  getSlashCommandStatus,
  installSlashCommands,
  type SlashCommandAgent,
  type SlashCommandInstallResult,
  type SlashCommandStatus,
  type SlashCommandStatusEntry,
  type SlashCommandUninstallResult,
  uninstallSlashCommands
} from './slash-commands';
export { BUNDLE_VERSION } from './templates';
