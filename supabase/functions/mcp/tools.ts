// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: 'create_ticket_draft',
    description:
      'Turn conversation context into a structured Overlord ticket draft and open an inline editable ticket card.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationContext: {
          type: 'string',
          description: 'The relevant chat or conversation context to turn into a ticket draft.'
        },
        title: {
          type: 'string',
          description: 'Optional title override if you already know the best title.'
        },
        description: {
          type: 'string',
          description: 'Optional description/objective override.'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Optional priority override.'
        },
        projectId: {
          type: 'string',
          description: 'Optional project UUID. Defaults to the first project in your organization.'
        }
      },
      required: ['conversationContext']
    },
    _meta: {
      ui: {
        resourceUri: 'ui://overlord/ticket-card',
        visibility: ['model', 'app']
      },
      'openai/outputTemplate': 'ui://overlord/ticket-card'
    }
  },
  {
    name: 'attach',
    description:
      'Attach to an Overlord ticket session. Call this FIRST before any other tool. Returns session.sessionKey, the full ticket record, a preassembled promptContext string, prior delivery history, artifacts, and shared state.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'Ticket UUID — use the TICKET_ID from your instructions.'
        },
        agentIdentifier: {
          type: 'string',
          description: 'Your agent identifier, e.g. "claude-code" or "codex".'
        },
        connectionMethod: {
          type: 'string',
          enum: ['mcp', 'cli', 'rest', 'chatgpt', 'claude_app', 'claude_code', 'other'],
          description: 'How you are connecting. Use "mcp" for this endpoint.',
          default: 'mcp'
        },
        metadata: { type: 'object', description: 'Optional extra metadata about this session.' }
      },
      required: ['ticketId', 'agentIdentifier']
    }
  },
  {
    name: 'update',
    description:
      'Post a progress update to the ticket. Call after each meaningful step. Use phase "execute" while working.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: { type: 'string', description: 'Ticket UUID.' },
        summary: { type: 'string', description: 'What you did and why.' },
        externalUrl: {
          type: ['string', 'null'],
          description:
            'Optional agent dashboard URL for this session. Pass null to clear a previously stored link.'
        },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'],
          description: 'Current phase. Use "execute" while actively working.'
        },
        changeRationales: {
          type: 'array',
          description:
            'Optional structured rationale records for meaningful code changes. Prefer 1-5 concise entries per ticket.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              file_path: { type: 'string' },
              summary: { type: 'string' },
              why: { type: 'string' },
              impact: { type: 'string' },
              change_kind: { type: 'string' },
              attribution_source: { type: 'string' },
              confidence: { type: 'string' },
              hunks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    header: { type: 'string' },
                    old_start: { type: 'number' },
                    old_lines: { type: 'number' },
                    new_start: { type: 'number' },
                    new_lines: { type: 'number' }
                  }
                }
              }
            },
            required: ['label', 'file_path', 'summary', 'why', 'impact', 'hunks']
          }
        },
        payload: {
          type: 'object',
          description: 'Optional payload. Include notifications array to surface events in the UI.'
        }
      },
      required: ['sessionKey', 'ticketId', 'summary']
    }
  },
  {
    name: 'artifact_prepare_upload',
    description:
      'Create a signed upload URL for a ticket artifact in Supabase Storage. Requires AGENT+ org role.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: { type: 'string', description: 'Ticket UUID.' },
        fileName: { type: 'string', description: 'Original filename (e.g. design-spec.pdf).' },
        label: { type: 'string', description: 'Optional display label for the artifact row.' },
        artifactType: { type: 'string', description: 'Artifact type (default: document).' },
        contentType: { type: 'string', description: 'MIME type of upload.' },
        fileSize: { type: 'number', description: 'Optional file size in bytes.' },
        metadata: { type: 'object', description: 'Optional metadata for finalize step.' }
      },
      required: ['sessionKey', 'ticketId', 'fileName']
    }
  },
  {
    name: 'artifact_finalize_upload',
    description:
      'Create the public.artifacts row after the storage upload succeeds, associating storage_path to ticket_id.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: { type: 'string', description: 'Ticket UUID.' },
        storagePath: { type: 'string', description: 'Path returned from artifact_prepare_upload.' },
        label: { type: 'string', description: 'Artifact label shown in UI.' },
        artifactType: { type: 'string', description: 'Artifact type (default: document).' },
        contentType: { type: 'string', description: 'MIME type.' },
        fileSize: { type: 'number', description: 'Optional file size in bytes.' },
        metadata: { type: 'object', description: 'Optional metadata to persist on artifact row.' }
      },
      required: ['sessionKey', 'ticketId', 'storagePath', 'label']
    }
  },
  {
    name: 'artifact_get_download_url',
    description:
      'Create a signed download URL for an existing ticket artifact storage object. Org member access required.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: { type: 'string', description: 'Ticket UUID.' },
        artifactId: { type: 'string', description: 'Artifact UUID (preferred).' },
        storagePath: {
          type: 'string',
          description: 'Direct storage path fallback if artifactId is unavailable.'
        },
        expiresIn: { type: 'number', description: 'Expiry in seconds (default 3600, max 86400).' }
      },
      required: ['sessionKey', 'ticketId']
    }
  },
  {
    name: 'ask',
    description:
      'Ask a blocking question. Ticket moves to review until a human responds. Stop working after calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: { type: 'string' },
        question: { type: 'string', description: 'Specific question for the PM.' },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled']
        },
        payload: { type: 'object' }
      },
      required: ['sessionKey', 'ticketId', 'question']
    }
  },
  {
    name: 'read_context',
    description: 'Read shared context / state from previous sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: { type: 'string' },
        query: { type: 'string', description: 'Optional key filter.' },
        limit: { type: 'number', description: 'Max entries to return (default 20).' }
      },
      required: ['sessionKey', 'ticketId']
    }
  },
  {
    name: 'write_context',
    description: 'Write a key/value entry to shared context that future agent sessions can read.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: { type: 'string' },
        key: { type: 'string', description: 'Descriptive key.' },
        value: { description: 'Any JSON-serializable value.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' }
      },
      required: ['sessionKey', 'ticketId', 'key', 'value']
    }
  },
  {
    name: 'deliver',
    description:
      'Deliver your completed work. Always call last. Moves ticket to review. Do not call if you used ask and have not received an answer.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: { type: 'string' },
        summary: {
          type: 'string',
          description:
            'Narrative summary: what you did, key decisions, and next steps. The PM reads this first.'
        },
        changeRationales: {
          type: 'array',
          description:
            'Optional structured rationale records for meaningful code changes. Prefer 1-5 concise entries per ticket.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              file_path: { type: 'string' },
              summary: { type: 'string' },
              why: { type: 'string' },
              impact: { type: 'string' },
              change_kind: { type: 'string' },
              attribution_source: { type: 'string' },
              confidence: { type: 'string' },
              hunks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    header: { type: 'string' },
                    old_start: { type: 'number' },
                    old_lines: { type: 'number' },
                    new_start: { type: 'number' },
                    new_lines: { type: 'number' }
                  }
                }
              }
            },
            required: ['label', 'file_path', 'summary', 'why', 'impact', 'hunks']
          }
        },
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: [
                  'file_changes',
                  'next_steps',
                  'test_results',
                  'migration',
                  'decision',
                  'note',
                  'url'
                ]
              },
              label: { type: 'string' },
              content: { type: 'string' },
              uri: { type: 'string' },
              metadata: { type: 'object' }
            },
            required: ['type', 'label']
          },
          description:
            'Artifact types: file_changes, next_steps, test_results, migration, decision, note, url.'
        }
      },
      required: ['sessionKey', 'ticketId', 'summary']
    }
  },
  {
    name: 'save_ticket_draft',
    description:
      'Persist an edited ticket draft to Overlord. Intended to be called from the inline ticket card app.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Ticket title.' },
        description: { type: 'string', description: 'Ticket description / objective.' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        projectId: {
          type: 'string',
          description: 'Optional destination project UUID. Defaults to the first available project.'
        }
      },
      required: ['description']
    },
    _meta: {
      ui: {
        visibility: ['app']
      }
    }
  },
  {
    name: 'create_ticket',
    description:
      'Create a follow-up ticket in the same project. Use when blocked by a human-only action.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: {
          type: 'string',
          description: 'Current ticket UUID (follow-up will be linked to this).'
        },
        title: { type: 'string', description: 'Short title for the new ticket.' },
        objective: { type: 'string', description: 'What needs to be done.' },
        acceptanceCriteria: { type: 'string' },
        availableTools: { type: 'string' },
        executionTarget: { type: 'string', enum: ['agent', 'human'], default: 'human' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }
      },
      required: ['sessionKey', 'ticketId', 'objective']
    }
  }
];
