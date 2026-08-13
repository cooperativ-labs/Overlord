// Copied from Latch `packages/harness-schema/src/generated.ts`.
// Generated from Latch `fixtures/harness/*.v1.json`; do not edit by hand.
// Overlord consumes this contract; it does not re-derive harness events.

export type HarnessEventType =
  | 'user_message'
  | 'assistant_delta'
  | 'assistant_message'
  | 'tool_started'
  | 'tool_finished'
  | 'awaiting_input'
  | 'status';

type HarnessEventBase = {
  sessionId: string;
  at: string;
  harnessVersion: string;
  connectorEpoch: number;
};

export type HarnessEvent =
  | (HarnessEventBase & { type: 'user_message'; text: string })
  | (HarnessEventBase & { type: 'assistant_delta'; text: string })
  | (HarnessEventBase & { type: 'assistant_message'; text: string })
  | (HarnessEventBase & { type: 'tool_started'; tool: string; input: unknown })
  | (HarnessEventBase & { type: 'tool_finished'; tool: string; output: unknown })
  | (HarnessEventBase & {
      type: 'awaiting_input';
      requestId: string;
      kind: 'permission' | 'question';
      prompt: string;
      choices?: string[];
    })
  | (HarnessEventBase & { type: 'status'; status: string });

export type InteractionCapabilities = {
  sendMessage: boolean;
  sendKeys: boolean;
  resolve: boolean;
  canSend: {
    ok: boolean;
    reason?: string;
  };
};
