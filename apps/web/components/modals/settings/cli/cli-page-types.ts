import type { BundleAgent, BundleStatusEntry } from '@/lib/helpers/agent-bundles';
import type { CustomAgentPlaceholder } from '@/lib/schemas/agent-config';

export type { BundleAgent, BundleStatusEntry };

export type SlashCommandConfig = {
  label: string;
  description: string;
  supportNote?: string;
  filePaths: string[];
};

/** Agents whose slash commands are installed via Electron agentSlash IPC (not Antigravity — use bundle). */
export type SlashAgent = 'claude' | 'cursor' | 'opencode';

export type SlashStatusEntry = {
  agent: SlashAgent;
  status: 'installed' | 'partial' | 'not_installed';
  details: string;
  managedFiles: string[];
  existingManagedFiles: string[];
  missingManagedFiles: string[];
};

export type AgentPluginInstallOption =
  | {
      key: string;
      agentKey: string;
      label: string;
      description: string;
      kind: 'bundle';
      bundleAgent: BundleAgent;
      supportNote?: string;
    }
  | {
      key: string;
      agentKey: string;
      label: string;
      description: string;
      kind: 'service';
      serviceKey: 'overlord-plugin';
      supportNote?: string;
    }
  | {
      key: string;
      agentKey: string;
      label: string;
      description: string;
      kind: 'slash';
      slashAgent: SlashAgent;
      supportNote?: string;
    };

export type PluginActionMeta = {
  label: 'Install' | 'Update' | 'Repair' | 'Remove';
  loadingText: string;
  successText: string;
  errorText: string;
};

export type ServiceStatusEntry = {
  key: 'overlord-plugin';
  status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
  version: string | null;
  installedVersion: string | null;
  details: string;
  currentContentHash: string;
  managedFiles: string[];
  existingManagedFiles: string[];
  missingManagedFiles: string[];
};

export type CustomAgentDraft = {
  id: string;
  name: string;
  commandTemplate: string;
  /** token -> editable placeholder fields */
  placeholders: Record<
    string,
    { label: string; role: CustomAgentPlaceholder['role']; optionsText: string }
  >;
};
