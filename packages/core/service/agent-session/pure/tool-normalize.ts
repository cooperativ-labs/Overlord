/**
 * Native tool name → normalized vocabulary.
 *
 * The normalized set is deliberately small. It is not a taxonomy of what agents do; it is the
 * set of *distinct decisions a person makes*, which is a much shorter list. "Run something",
 * "change a file", "look at a file", "reach the network", "call a third party", "something
 * else". Splitting `edit` from `write` is the only refinement that earns its keep, because
 * create-versus-overwrite changes the answer.
 *
 * Everything not in the table becomes `generic`, and `generic` shows key names only. That is the
 * safe direction to be wrong in: a tool we have never seen leaks nothing, and the cost of the
 * miss is a slightly less informative card rather than a disclosure.
 */

export const NORMALIZED_TOOLS = [
  'shell',
  'read',
  'write',
  'edit',
  'fetch',
  'search',
  'mcp',
  'task',
  'generic'
] as const;

export type NormalizedTool = (typeof NORMALIZED_TOOLS)[number];

/**
 * Exact matches, lowercased.
 *
 * Matching exactly rather than by substring is intentional: a tool named `NotebookRead` must
 * not match a `read` substring rule and then be handed input whose shape the read formatter
 * does not understand. Wrong-shaped input to a specific formatter produces a card that looks
 * authoritative and says nothing true.
 */
const EXACT: Record<string, NormalizedTool> = {
  bash: 'shell',
  shell: 'shell',
  shell_command: 'shell',
  run_terminal_cmd: 'shell',
  runcommand: 'shell',
  execute: 'shell',
  exec: 'shell',
  bashoutput: 'shell',
  killshell: 'shell',

  read: 'read',
  readfile: 'read',
  read_file: 'read',
  notebookread: 'read',
  cat: 'read',

  write: 'write',
  writefile: 'write',
  write_file: 'write',
  create_file: 'write',
  createfile: 'write',

  edit: 'edit',
  multiedit: 'edit',
  editfile: 'edit',
  edit_file: 'edit',
  str_replace: 'edit',
  str_replace_editor: 'edit',
  apply_patch: 'edit',
  applypatch: 'edit',
  patch: 'edit',
  notebookedit: 'edit',
  update_file: 'edit',

  webfetch: 'fetch',
  web_fetch: 'fetch',
  fetch: 'fetch',
  http_request: 'fetch',
  websearch: 'fetch',
  web_search: 'fetch',

  grep: 'search',
  glob: 'search',
  search: 'search',
  codebase_search: 'search',
  file_search: 'search',
  ls: 'search',
  list_dir: 'search',

  task: 'task',
  agent: 'task',
  subagent: 'task',
  todowrite: 'task',
  todoread: 'task'
};

/**
 * Normalize a native tool name.
 *
 * MCP is detected structurally rather than by name list, because the whole point of MCP is that
 * the tool names are not knowable in advance. Both conventions observed across harnesses —
 * `mcp__server__tool` and `server/tool` under an explicit MCP event — resolve here.
 */
export function normalizeToolName(nativeName: unknown): NormalizedTool {
  if (typeof nativeName !== 'string') return 'generic';
  const name = nativeName.trim();
  if (name === '') return 'generic';
  if (name.startsWith('mcp__') || name.startsWith('mcp/')) return 'mcp';
  return EXACT[name.toLowerCase()] ?? 'generic';
}

/** True when the normalized tool is one whose card may reveal a path. */
export function isFileTool(tool: NormalizedTool): boolean {
  return tool === 'read' || tool === 'write' || tool === 'edit';
}
