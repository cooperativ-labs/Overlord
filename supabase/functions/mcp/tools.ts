// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
  {
    name: 'create_ticket_draft',
    annotations: {
      title: 'Create Ticket Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
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
    annotations: {
      title: 'Attach To Ticket',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    description:
      'Attach to an Overlord ticket session. Call this FIRST before any other tool. Returns session.sessionKey, the full ticket record, a preassembled promptContext string, prior delivery history, artifacts, and shared state.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description:
            'Ticket identifier — use the TICKET_ID from your instructions (e.g. 1:899). Also accepts UUID.'
        },
        agentIdentifier: {
          type: 'string',
          description: 'Your agent identifier, e.g. "claude-code" or "codex".'
        },
        modelIdentifier: {
          type: 'string',
          description: 'Optional model identifier to snapshot on the executing objective.'
        },
        connectionMethod: {
          type: 'string',
          enum: ['mcp', 'cli', 'rest', 'chatgpt', 'claude_app', 'claude_code', 'other'],
          description: 'How you are connecting. Use "mcp" for this endpoint.',
          default: 'mcp'
        },
        externalSessionId: {
          type: ['string', 'null'],
          description:
            'Optional native session id returned by the agent runtime (for example Claude/Codex resume ids).'
        },
        metadata: { type: 'object', description: 'Optional extra metadata about this session.' }
      },
      required: ['ticketId', 'agentIdentifier']
    }
  },
  {
    name: 'update',
    annotations: {
      title: 'Post Ticket Update',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Post a progress update to the ticket. Call after each meaningful step. Use phase "execute" while working.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        summary: { type: 'string', description: 'What you did and why.' },
        externalUrl: {
          type: ['string', 'null'],
          description:
            'Optional agent dashboard URL for this session. Pass null to clear a previously stored link.'
        },
        externalSessionId: {
          type: ['string', 'null'],
          description:
            'Optional native session id returned by the agent runtime (for example Claude/Codex resume ids). Pass null to clear.'
        },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'],
          description: 'Current phase. Use "execute" while actively working.'
        },
        changeRationales: {
          type: 'array',
          description:
            'Optional structured rationale records for meaningful code changes. These are stored as first-class rows in the file_changes table. Prefer 1-5 concise entries per ticket.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              file_path: { type: 'string' },
              summary: { type: 'string' },
              why: { type: 'string' },
              impact: { type: 'string' },
              objective_id: {
                type: 'string',
                description:
                  'Optional explicit objective UUID override. When omitted, Overlord auto-associates the latest executing objective for the ticket, else the latest completed objective.'
              },
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
        snapshot: {
          type: 'object',
          description:
            'Optional git checkpoint metadata. The local CLI fills this in from a hidden refs/overlord/checkpoints/<objectiveId> ref it creates before calling the API.',
          properties: {
            gitCommitId: { type: ['string', 'null'] },
            gitRefName: { type: 'string' },
            headSha: { type: 'string' },
            objectiveId: { type: 'string' },
            diffStat: { type: ['string', 'null'] }
          }
        },
        checkpoint: {
          type: 'object',
          description:
            'Optional checkpoint metadata. Local CLI delivery creates this automatically before calling the API.',
          properties: {
            kind: { type: 'string', enum: ['delivery', 'manual', 'objective'] },
            summary: { type: ['string', 'null'] },
            diffStat: { type: ['string', 'null'] }
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
    name: 'record_change_rationales',
    annotations: {
      title: 'Record Change Rationales',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Persist structured change rationale records to Overlord. These are stored as first-class rows in the file_changes table and linked to the current ticket/session/event.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        summary: {
          type: 'string',
          description: 'Optional summary for the associated ticket event.'
        },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'],
          description: 'Optional phase for the associated ticket event.'
        },
        changeRationales: {
          type: 'array',
          description:
            'Structured rationale records to persist in the file_changes table. Prefer this tool or the update/deliver changeRationales fields over free-form text.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              file_path: { type: 'string' },
              summary: { type: 'string' },
              why: { type: 'string' },
              impact: { type: 'string' },
              objective_id: {
                type: 'string',
                description:
                  'Optional explicit objective UUID override. When omitted, Overlord auto-associates the latest executing objective for the ticket, else the latest completed objective.'
              },
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
        snapshot: {
          type: 'object',
          description:
            'Optional git checkpoint metadata. The local CLI fills this in from a hidden refs/overlord/checkpoints/<objectiveId> ref it creates before calling the API.',
          properties: {
            gitCommitId: { type: ['string', 'null'] },
            gitRefName: { type: 'string' },
            headSha: { type: 'string' },
            objectiveId: { type: 'string' },
            diffStat: { type: ['string', 'null'] }
          }
        }
      },
      required: ['sessionKey', 'ticketId', 'changeRationales']
    }
  },
  {
    name: 'record_hook_event',
    annotations: {
      title: 'Record Hook Event',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      "Record a hook lifecycle event for a ticket. Use hookType='UserPromptSubmit' to capture follow-up user messages without requiring a session key. Stop is reserved for future lifecycle hooks.",
    inputSchema: {
      type: 'object',
      properties: {
        hookType: { type: 'string', enum: ['UserPromptSubmit', 'Stop'] },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        prompt: {
          type: 'string',
          description: 'Optional verbatim user prompt for UserPromptSubmit hook events.'
        },
        turnIndex: {
          type: 'number',
          description:
            'Optional turn index. UserPromptSubmit skips turn 0 (the initial ticket prompt).'
        }
      },
      required: ['hookType', 'ticketId']
    }
  },
  {
    name: 'list_attachments',
    annotations: {
      title: 'List Objective Attachments',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    description:
      'List objective attachments visible to the current ticket session. Returns id, label, content_type, file_size, objective_id, storage_path, and created_at for each. Use these IDs with get_attachment_download_url.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objectiveId: {
          type: 'string',
          description: 'Optional objective UUID filter.'
        }
      },
      required: ['sessionKey', 'ticketId']
    }
  },
  {
    name: 'prepare_attachment_upload',
    annotations: {
      title: 'Prepare Attachment Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Create a signed upload URL for an objective attachment in Supabase Storage. Requires AGENT+ org role.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objectiveId: { type: 'string', description: 'Objective UUID.' },
        fileName: { type: 'string', description: 'Original filename (e.g. design-spec.pdf).' },
        label: { type: 'string', description: 'Optional display label for the attachment row.' },
        contentType: { type: 'string', description: 'MIME type of upload.' },
        fileSize: { type: 'number', description: 'Optional file size in bytes.' },
        metadata: { type: 'object', description: 'Optional metadata for finalize step.' }
      },
      required: ['sessionKey', 'ticketId', 'objectiveId', 'fileName']
    }
  },
  {
    name: 'finalize_attachment_upload',
    annotations: {
      title: 'Finalize Attachment Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Create the public.objective_attachments row after the storage upload succeeds, associating storage_path to ticket_id and objective_id.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objectiveId: { type: 'string', description: 'Objective UUID.' },
        storagePath: {
          type: 'string',
          description: 'Path returned from prepare_attachment_upload.'
        },
        label: { type: 'string', description: 'Attachment label shown in UI.' },
        contentType: { type: 'string', description: 'MIME type.' },
        fileSize: { type: 'number', description: 'Optional file size in bytes.' },
        metadata: { type: 'object', description: 'Optional metadata to persist on row.' }
      },
      required: ['sessionKey', 'ticketId', 'objectiveId', 'storagePath', 'label']
    }
  },
  {
    name: 'get_attachment_download_url',
    annotations: {
      title: 'Get Attachment Download URL',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    description:
      'Create a signed download URL for an existing objective attachment storage object. Org member access required.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objectiveId: {
          type: 'string',
          description: 'Objective UUID. Required when using storagePath.'
        },
        attachmentId: { type: 'string', description: 'Attachment UUID (preferred).' },
        storagePath: {
          type: 'string',
          description: 'Direct storage path fallback if attachmentId is unavailable.'
        },
        expiresIn: { type: 'number', description: 'Expiry in seconds (default 3600, max 86400).' }
      },
      required: ['sessionKey', 'ticketId']
    }
  },
  {
    name: 'ask',
    annotations: {
      title: 'Ask Blocking Question',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Ask a blocking question. Ticket moves to review until a human responds. Stop working after calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
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
    annotations: {
      title: 'Read Shared Context',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    description: 'Read shared context / state from previous sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        query: { type: 'string', description: 'Optional key filter.' },
        limit: { type: 'number', description: 'Max entries to return (default 20).' }
      },
      required: ['sessionKey', 'ticketId']
    }
  },
  {
    name: 'write_context',
    annotations: {
      title: 'Write Shared Context',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description: 'Write a key/value entry to shared context that future agent sessions can read.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        key: { type: 'string', description: 'Descriptive key.' },
        value: { description: 'Any JSON-serializable value.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' }
      },
      required: ['sessionKey', 'ticketId', 'key', 'value']
    }
  },
  {
    name: 'deliver',
    annotations: {
      title: 'Deliver Ticket Work',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Deliver your completed work. Always call last. Moves ticket to review. Do not call if you used ask and have not received an answer. MCP accepts the structured delivery payload directly; do not create temporary delivery JSON files for this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        summary: {
          type: 'string',
          description:
            'Narrative summary: what you did, key decisions, and next steps. The PM reads this first.'
        },
        changeRationales: {
          type: 'array',
          description:
            'Optional structured rationale records for meaningful code changes. These are stored as first-class rows in the file_changes table. Prefer 1-5 concise entries per ticket.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              file_path: { type: 'string' },
              summary: { type: 'string' },
              why: { type: 'string' },
              impact: { type: 'string' },
              objective_id: {
                type: 'string',
                description:
                  'Optional explicit objective UUID override. When omitted, Overlord auto-associates the latest executing objective for the ticket, else the latest completed objective.'
              },
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
        snapshot: {
          type: 'object',
          description:
            'Optional git checkpoint metadata. The local CLI fills this in from a hidden refs/overlord/checkpoints/<objectiveId> ref it creates before calling the API.',
          properties: {
            gitCommitId: { type: ['string', 'null'] },
            gitRefName: { type: 'string' },
            headSha: { type: 'string' },
            objectiveId: { type: 'string' },
            diffStat: { type: ['string', 'null'] }
          }
        },
        checkpoint: {
          type: 'object',
          description:
            'Optional checkpoint metadata. Local CLI delivery creates this automatically before calling the API.',
          properties: {
            kind: { type: 'string', enum: ['delivery', 'manual', 'objective'] },
            summary: { type: ['string', 'null'] },
            diffStat: { type: ['string', 'null'] }
          }
        },
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['next_steps', 'test_results', 'migration', 'decision', 'note', 'url']
              },
              label: { type: 'string' },
              content: { type: 'string' },
              uri: { type: 'string' },
              metadata: { type: 'object' }
            },
            required: ['type', 'label']
          },
          description:
            'Optional structured delivery records (next_steps, test_results, migration, decision, note, url). Matches POST /api/protocol/deliver — omit or pass [] when you only need summary and changeRationales.'
        }
      },
      required: ['sessionKey', 'ticketId', 'summary']
    }
  },
  {
    name: 'record_work',
    annotations: {
      title: 'Record Completed Work From Chat',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Record work that the agent already completed inside a chat as a ticket in `review` status with a completed objective, then trigger feed-post generation. Use this INSTEAD OF create_ticket + attach + deliver for "log what we just did" flows. Do NOT use this for in-progress work — use `attach` (existing ticket) or `prompt` (new) for that. Project resolution follows the same workingDirectory → projectId precedence as `prompt`/`create_ticket`. If neither resolves a project, pass `personal: true` to create a private ticket. The objective should describe what was asked/done; the summary is the narrative shown to reviewers and used by the feed-post generator.',
    inputSchema: {
      type: 'object',
      properties: {
        objective: {
          type: 'string',
          description: 'What was asked / what was done. Stored as a completed objective.'
        },
        summary: {
          type: 'string',
          description:
            'Narrative for the feed post and reviewer. What you did, decisions, next steps.'
        },
        title: {
          type: 'string',
          description: 'Optional title. Auto-derived from objective if omitted.'
        },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
        projectId: {
          type: 'string',
          description: 'Explicit project UUID. Skips workingDirectory resolution.'
        },
        workingDirectory: {
          type: 'string',
          description:
            'Absolute path of the repository root. Matched against project_user.local_working_directory when projectId is not provided.'
        },
        personal: {
          type: 'boolean',
          description:
            'Create a private ticket without any project association. Use only when the work is not tied to any project.'
        },
        acceptanceCriteria: { type: 'string' },
        availableTools: { type: 'string' },
        delegate: { type: 'string' },
        agentIdentifier: {
          type: 'string',
          description: 'The agent identifier doing the recording.'
        },
        metadata: { type: 'object' },
        artifacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['next_steps', 'test_results', 'migration', 'decision', 'note', 'url']
              },
              label: { type: 'string' },
              content: { type: 'string' },
              uri: { type: 'string' },
              metadata: { type: 'object' }
            },
            required: ['type', 'label']
          }
        },
        changeRationales: {
          type: 'array',
          description:
            'Structured rationale records for meaningful file changes. Required when the workspace has uncommitted changes; otherwise optional.',
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
            required: ['label', 'file_path', 'summary', 'why', 'impact']
          }
        }
      },
      required: ['objective', 'summary']
    }
  },
  {
    name: 'save_ticket_draft',
    annotations: {
      title: 'Save Ticket Draft',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
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
    name: 'discuss_objective',
    annotations: {
      title: 'Discuss Objective',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      'Mark a draft objective as "submitted", indicating the ticket is in active discussion with an agent but not yet being executed. Call this when a ticket is opened or discussed in conversation — it does NOT start execution. Use `attach` to begin execution only when the user explicitly orders it.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Optional UUID of a specific draft objective to submit. Defaults to the latest draft.'
        }
      },
      required: ['ticketId']
    }
  },
  {
    name: 'create_ticket',
    annotations: {
      title: 'Create Follow-Up Ticket',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Create a follow-up ticket in the same project. Use when blocked by a human-only action. The objective will be stored in the objectives table and associated with the ticket.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: {
          type: 'string',
          description:
            'Current ticket identifier (e.g. 1:899). Follow-up ticket will be linked to this. Also accepts UUID.'
        },
        title: { type: 'string', description: 'Short title for the new ticket.' },
        objective: {
          type: 'string',
          description:
            'What needs to be done. This will be stored as an objective in the objectives table.'
        },
        acceptanceCriteria: { type: 'string' },
        availableTools: { type: 'string' },
        executionTarget: { type: 'string', enum: ['agent', 'human'], default: 'human' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
        delegate: {
          type: 'string',
          description:
            'Optional override for tickets.delegate. When omitted, Overlord should fill it with the active model identifier and only fall back to the agent identifier if the model is unavailable. The authenticated bearer token determines created_by automatically.'
        }
      },
      required: ['sessionKey', 'ticketId', 'objective']
    }
  },
  {
    name: 'discover_project',
    annotations: {
      title: 'Discover Project By Working Directory',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    description:
      'Resolve the Overlord project whose local working directory matches the given path (same behavior as ovld protocol discover-project).',
    inputSchema: {
      type: 'object',
      properties: {
        workingDirectory: {
          type: 'string',
          description:
            'Absolute path of the repository root to match against project_user.local_working_directory.'
        }
      },
      required: ['workingDirectory']
    }
  },
  {
    name: 'search_tickets',
    annotations: {
      title: 'Search Tickets',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    description:
      'Search tickets by keyword and filters (same fields as POST /api/protocol/search-tickets and ovld protocol search-tickets).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keyword search in titles and objectives. Omit or empty to list by filters only.'
        },
        statuses: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by status names (e.g. next-up, execute).'
        },
        includeCompleted: {
          type: 'boolean',
          description: 'Include completed tickets. Default false.'
        },
        limit: { type: 'number', description: 'Max results (1–50, default 8).' },
        projectId: { type: 'string', description: 'Optional project UUID filter.' },
        createdBy: { type: 'string', description: 'Optional creator user UUID.' },
        updatedAfter: {
          type: 'string',
          description: 'ISO datetime — tickets updated on or after.'
        },
        updatedBefore: {
          type: 'string',
          description: 'ISO datetime — tickets updated on or before.'
        }
      }
    }
  }
];
