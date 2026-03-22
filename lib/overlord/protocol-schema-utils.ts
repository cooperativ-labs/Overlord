/**
 * Utilities for generating prompt documentation from protocol schemas.
 * Produces minimal, agent-focused JSON examples and descriptions.
 */

export function generateUpdatePayloadExample(ticketId: string): string {
  return JSON.stringify(
    {
      sessionKey: '<from-attach>',
      ticketId,
      summary: 'What you did and why.',
      phase: 'execute',
      changeRationales: [
        {
          label: 'Short title',
          file_path: 'path/to/file.ts',
          summary: 'What changed.',
          why: 'Why it changed.',
          impact: 'Behavioral impact.',
          hunks: [{ header: '@@ -10,6 +10,14 @@' }]
        }
      ]
    },
    null,
    2
  );
}

export function generateDeliverPayloadExample(ticketId: string): string {
  return JSON.stringify(
    {
      sessionKey: '<from-attach>',
      ticketId,
      summary: 'Narrative of what you did and next steps.',
      changeRationales: [
        {
          label: 'Short title',
          file_path: 'path/to/file.ts',
          summary: 'What changed.',
          why: 'Why it changed.',
          impact: 'Behavioral impact.',
          hunks: [{ header: '@@ -10,6 +10,14 @@' }]
        }
      ],
      artifacts: [{ type: 'next_steps', label: 'Next steps', content: 'Bulleted list.' }]
    },
    null,
    2
  );
}

export function generateRecordChangeRationalesPayloadExample(ticketId: string): string {
  return JSON.stringify(
    {
      sessionKey: '<from-attach>',
      ticketId,
      summary: 'Recorded rationale details for the latest code changes.',
      phase: 'execute',
      changeRationales: [
        {
          label: 'Short title',
          file_path: 'path/to/file.ts',
          summary: 'What changed.',
          why: 'Why it changed.',
          impact: 'Behavioral impact.',
          hunks: [{ header: '@@ -10,6 +10,14 @@' }]
        }
      ]
    },
    null,
    2
  );
}

export function generateAttachPayloadExample(ticketId: string): string {
  return JSON.stringify(
    {
      ticketId,
      agentIdentifier: '<your-agent-id>',
      connectionMethod: 'mcp',
      externalSessionId: '<optional-native-session-id>',
      metadata: {}
    },
    null,
    2
  );
}

export function generateAskPayloadExample(ticketId: string): string {
  return JSON.stringify(
    {
      sessionKey: '<from-attach>',
      ticketId,
      question: 'Your blocking question for the PM.',
      phase: 'review'
    },
    null,
    2
  );
}
