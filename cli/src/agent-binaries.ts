/** Native agent binary names by connector key, for PATH detection and launch. */
const AGENT_BINARIES: Record<string, string> = {
  antigravity: 'agy',
  claude: 'claude',
  codex: 'codex',
  // The Codex app-server control plane drives the same binary (`codex app-server`).
  'codex-app-server': 'codex',
  cursor: 'agent',
  pi: 'pi'
};

/** Map a connector agent key to the executable invoked at launch time. */
export function resolveAgentBinary(agentKey: string): string {
  return AGENT_BINARIES[agentKey] ?? agentKey;
}
