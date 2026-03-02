export type ConnectorEvent = {
  type: 'permission-requested';
  payload: Record<string, unknown>;
};

type ConnectorContext = {
  ticketId: string;
};

type ConnectorState = {
  buffer: string;
  lastPermissionFingerprint: string | null;
};

type AgentConnector = {
  agentIdentifier: string;
  onData: (data: string, state: ConnectorState, context: ConnectorContext) => ConnectorEvent[];
};

export type TerminalConnectorRuntime = {
  connector: AgentConnector;
  context: ConnectorContext;
  state: ConnectorState;
};

const MAX_BUFFER_CHARS = 20_000;

const codexConnector: AgentConnector = {
  agentIdentifier: 'codex',
  onData(data, state, context) {
    const normalizedData = stripAnsi(data);
    state.buffer = (state.buffer + normalizedData).slice(-MAX_BUFFER_CHARS);

    const promptIndex = state.buffer.lastIndexOf('Would you like to run the following command?');
    if (promptIndex === -1) return [];

    const windowText = state.buffer.slice(promptIndex, promptIndex + 2_500);
    if (!/Yes,\s*proceed\s*\(y\)/i.test(windowText)) return [];

    const commandPreview = extractCommandPreview(windowText);
    const fingerprint = [
      context.ticketId,
      commandPreview ?? '',
      normalizeForFingerprint(windowText)
    ]
      .join('|')
      .slice(0, 500);

    if (state.lastPermissionFingerprint === fingerprint) return [];
    state.lastPermissionFingerprint = fingerprint;

    return [
      {
        type: 'permission-requested',
        payload: {
          source: 'codex-terminal',
          prompt: 'Would you like to run the following command?',
          command_preview: commandPreview ?? null
        }
      }
    ];
  }
};

const fallbackConnector: AgentConnector = {
  agentIdentifier: 'unknown',
  onData() {
    return [];
  }
};

export function createTerminalConnectorRuntime(
  env?: Record<string, string>
): TerminalConnectorRuntime | null {
  const agentIdentifier = env?.AGENT_IDENTIFIER?.trim();
  const ticketId = env?.TICKET_ID?.trim();
  if (!agentIdentifier || !ticketId) return null;

  const connector = getConnectorForAgent(agentIdentifier);

  return {
    connector,
    context: { ticketId },
    state: {
      buffer: '',
      lastPermissionFingerprint: null
    }
  };
}

export function getConnectorEvents(
  runtime: TerminalConnectorRuntime,
  data: string
): ConnectorEvent[] {
  return runtime.connector.onData(data, runtime.state, runtime.context);
}

function getConnectorForAgent(agentIdentifier: string): AgentConnector {
  if (agentIdentifier === 'codex') {
    return codexConnector;
  }
  return fallbackConnector;
}

function stripAnsi(value: string): string {
  const ESC = 27;
  const BEL = 7;
  let output = '';
  let index = 0;

  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code !== ESC) {
      output += value[index];
      index += 1;
      continue;
    }

    index += 1;
    if (index >= value.length) break;

    const type = value[index];
    if (type === '[') {
      index += 1;
      while (index < value.length) {
        const endCode = value.charCodeAt(index);
        index += 1;
        if (endCode >= 0x40 && endCode <= 0x7e) break;
      }
      continue;
    }

    if (type === ']') {
      index += 1;
      while (index < value.length) {
        const endCode = value.charCodeAt(index);
        if (endCode === BEL) {
          index += 1;
          break;
        }
        if (endCode === ESC && value[index + 1] === '\\') {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }

    // Skip one extra character for non-CSI escape sequences.
    index += 1;
  }

  return output;
}

function extractCommandPreview(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const commandStart = lines.findIndex(line => line.trim().startsWith('$'));
  if (commandStart === -1) return null;

  const relevant = lines
    .slice(commandStart, commandStart + 4)
    .map(line => line.replace(/^\s*\$\s?/, '').trim())
    .filter(Boolean);

  if (relevant.length === 0) return null;
  return relevant.join(' ').slice(0, 300);
}

function normalizeForFingerprint(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300);
}
