// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

const OBJECTIVES_ARRAY_SCHEMA = {
  type: 'array',
  description:
    'Ordered objective objects. Index 0 is the first objective to execute; later indexes queue after it.',
  items: {
    type: 'object',
    properties: {
      objective: { type: 'string' },
      title: { type: 'string' },
      autoAdvance: { type: 'boolean' },
      assignedAgent: { type: 'object' }
    },
    required: ['objective']
  }
};

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
        objectives: OBJECTIVES_ARRAY_SCHEMA,
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Optional priority override.'
        },
        projectId: {
          type: 'string',
          description:
            'Optional project UUID or name. Defaults to the first project in your organization. Names are unique per organization and matched case-insensitively.'
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
        eventType: {
          type: 'string',
          enum: ['update', 'user_follow_up', 'alert', 'discussion_summary', 'decision'],
          description:
            'Type of event to record. Use discussion_summary/decision for important non-file follow-up outcomes.'
        },
        beginFollowUpWork: {
          type: 'boolean',
          description:
            'Required to move a delivered/review ticket back to execute for explicit follow-up implementation.'
        },
        followUpIntent: {
          type: 'string',
          enum: ['discussion', 'execution', 'pending_delivery'],
          description: 'Intent for post-delivery follow-up lifecycle handling.'
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
    name: 'heartbeat',
    annotations: {
      title: 'Send Heartbeat',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Send a lightweight liveness ping for an attached ticket session without creating a ticket event. Optional phase/percent/note telemetry is stored on the session row for transient UI progress.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: 'Session key from attach.' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        phase: {
          type: 'string',
          enum: ['draft', 'execute', 'review', 'deliver', 'complete', 'blocked', 'cancelled'],
          description: 'Optional transient lifecycle phase for UI telemetry.'
        },
        percent: {
          type: 'number',
          description: 'Optional percent-complete estimate from 0 to 100.'
        },
        note: {
          type: 'string',
          description: 'Optional short liveness note, for example "running tests".'
        },
        externalUrl: {
          type: ['string', 'null'],
          description:
            'Optional agent dashboard URL for this session. Pass null to clear a previously stored link.'
        },
        externalSessionId: {
          type: ['string', 'null'],
          description:
            'Optional native session id returned by the agent runtime (for example Claude/Codex resume ids). Pass null to clear.'
        }
      },
      required: ['sessionKey', 'ticketId']
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
      "Record a hook lifecycle event for a ticket. Use hookType='UserPromptSubmit' to capture follow-up user messages. Use hookType='Stop' with a sessionKey to check whether delivery is needed after a turn ends.",
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
        },
        followUpIntent: {
          type: 'string',
          enum: ['discussion', 'execution', 'pending_delivery'],
          description:
            'Intent to store on the captured follow-up event. Hooks should default to discussion.'
        },
        externalSessionId: {
          type: ['string', 'null'],
          description:
            'Optional native agent resume/session id to persist on the attached Overlord session.'
        },
        sessionKey: {
          type: 'string',
          description:
            'Optional session key for Stop hooks. When provided, the response includes deliveryStatus indicating whether delivery is needed.'
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
          description:
            'Ticket identifier (e.g. 1:899). Optional when objectiveId is provided; required to list every attachment across a ticket. Also accepts UUID.'
        },
        objectiveId: {
          type: 'string',
          description:
            'Objective UUID. Filters to a single objective and lets the server derive ticketId.'
        }
      },
      required: ['sessionKey']
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
          description:
            'Ticket identifier (e.g. 1:899) or UUID. Optional — derived from objectiveId when omitted.'
        },
        objectiveId: { type: 'string', description: 'Objective UUID.' },
        fileName: { type: 'string', description: 'Original filename (e.g. design-spec.pdf).' },
        label: { type: 'string', description: 'Optional display label for the attachment row.' },
        contentType: { type: 'string', description: 'MIME type of upload.' },
        fileSize: { type: 'number', description: 'Optional file size in bytes.' },
        metadata: { type: 'object', description: 'Optional metadata for finalize step.' }
      },
      required: ['sessionKey', 'objectiveId', 'fileName']
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
          description:
            'Ticket identifier (e.g. 1:899) or UUID. Optional — derived from objectiveId when omitted.'
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
      required: ['sessionKey', 'objectiveId', 'storagePath', 'label']
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
          description:
            'Ticket identifier (e.g. 1:899) or UUID. Optional — derived from attachmentId / objectiveId when omitted.'
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
      required: ['sessionKey']
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
    name: 'request_approval_gate',
    annotations: {
      title: 'Request Approval Gate',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      'Flip the next queued future objective on this ticket to require manual human approval before it runs. Use sparingly — only when your current work surfaced a question, risk, or decision a human must make before the next objective auto-launches.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string' },
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        reason: {
          type: 'string',
          description:
            'Why a human must approve before the next objective runs. Rendered in the awaiting-approval banner verbatim.'
        },
        objectiveId: {
          type: 'string',
          description: 'Optional UUID of a specific future objective to gate. Defaults to the next.'
        }
      },
      required: ['sessionKey', 'ticketId', 'reason']
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
      'Record work that the agent already completed inside a chat as a ticket in `review` status with a completed objective, then trigger feed-post generation. Use this INSTEAD OF create_ticket + attach + deliver for "log what we just did" flows. Do NOT use this for in-progress work — use `attach` (existing ticket) or `prompt` (new) for that. Project resolution follows the same workingDirectory → projectId precedence as `prompt`/`create_ticket`. If neither resolves a project, pass `personal: true` to create a private ticket. Pass objectives as an array (a single objective is just an array with one item); the summary is the narrative shown to reviewers and used by the feed-post generator.',
    inputSchema: {
      type: 'object',
      properties: {
        objectives: OBJECTIVES_ARRAY_SCHEMA,
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
          description:
            'Explicit project UUID or name. Skips workingDirectory resolution. Names are unique per organization and matched case-insensitively.'
        },
        workingDirectory: {
          type: 'string',
          description:
            'Absolute path of the repository root. Matched against project resource directories when projectId is not provided.'
        },
        personal: {
          type: 'boolean',
          description:
            'Create a private ticket without any project association. Use only when the work is not tied to any project.'
        },
        acceptanceCriteria: { type: 'string' },
        availableTools: { type: 'string' },
        delegate: { type: 'string' },
        assignedTo: {
          type: 'string',
          description:
            'Assign the ticket to a human member: a username, email, user-id UUID, or orgid:username member ID. When omitted, the assignee defaults to the ticket creator.'
        },
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
      required: ['objectives', 'summary']
    }
  },
  {
    name: 'add_objectives',
    annotations: {
      title: 'Add Objectives',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Append ordered objectives to an existing ticket. Index 0 is the first newly added objective to execute; later indexes queue after it.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: {
          type: 'string',
          description: 'Ticket identifier (e.g. 1:899). Also accepts UUID.'
        },
        objectives: OBJECTIVES_ARRAY_SCHEMA
      },
      required: ['ticketId', 'objectives']
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
          description:
            'Optional destination project UUID or name. Defaults to the first available project. Names are unique per organization and matched case-insensitively.'
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
      'Create a follow-up ticket linked to the current ticket. By default it inherits the current project, but projectId can override that. Pass objectives as an array (a single objective is just an array with one item); they will be stored in the objectives table and associated with the ticket.',
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
        objectives: OBJECTIVES_ARRAY_SCHEMA,
        acceptanceCriteria: { type: 'string' },
        availableTools: { type: 'string' },
        forHuman: { type: 'boolean', default: false },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
        projectId: {
          type: 'string',
          description:
            'Optional project UUID or name override for the new follow-up ticket. Defaults to the current ticket project.'
        },
        delegate: {
          type: 'string',
          description:
            'Optional override for tickets.delegate. When omitted, Overlord should fill it with the active model identifier and only fall back to the agent identifier if the model is unavailable. The authenticated bearer token determines created_by automatically.'
        },
        assignedTo: {
          type: 'string',
          description:
            'Assign the ticket to a human member: a username, email, user-id UUID, or orgid:username member ID. When omitted, the assignee defaults to the ticket creator.'
        }
      },
      required: ['sessionKey', 'ticketId', 'objectives']
    }
  },
  {
    name: 'discover_project',
    annotations: {
      title: 'Discover Project',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    description:
      'Resolve the Overlord project by ID or by matching a local working directory. Hosted agents should pass projectId when known; otherwise pass workingDirectory and optional device identity for resource-directory matching.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'UUID or name of the project to resolve. Takes precedence over workingDirectory. Names are unique per organization and matched case-insensitively.'
        },
        workingDirectory: {
          type: 'string',
          description:
            'Absolute path of the repository root to match against registered resource directories. Used when projectId is not provided.'
        },
        deviceFingerprint: {
          type: 'string',
          description:
            'Optional stable device fingerprint. When provided, workingDirectory matching prefers resource directories for that registered device.'
        },
        deviceHostname: {
          type: 'string',
          description: 'Optional hostname to register/update when deviceFingerprint is provided.'
        },
        devicePlatform: {
          type: 'string',
          description: "Optional platform string such as 'darwin', 'linux', or 'windows'."
        }
      },
      required: []
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
        projectId: {
          type: 'string',
          description: 'Optional project UUID or name filter. Names are matched case-insensitively.'
        },
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
  },

  // ---------------------------------------------------------------------------
  // Device management
  // ---------------------------------------------------------------------------

  {
    name: 'get_device',
    annotations: {
      title: 'Get / Register Device',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      'Identify the device the agent is running on. Registers the device on first call and returns its label, hostname, and platform. Call this before add_project_resource or update_project_resource.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceFingerprint: {
          type: 'string',
          description:
            'Stable UUID generated by the client on first run and cached locally (e.g. in ~/.config/overlord/device.json).'
        },
        deviceHostname: {
          type: 'string',
          description: 'Hostname of the device (informational, used to auto-generate a label).'
        },
        devicePlatform: {
          type: 'string',
          description: "Platform of the device: 'darwin', 'linux', or 'windows'."
        },
        devicePort: {
          type: 'integer',
          description:
            'SSH port for placeholder reconciliation when multiple targets share the same host.'
        }
      },
      required: ['deviceFingerprint']
    }
  },

  {
    name: 'update_device',
    annotations: {
      title: 'Update Device Label',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      'Rename the label of the calling device. The label must be lowercase kebab-case and unique within the organization (e.g. "work-macbook", "ci-runner").',
    inputSchema: {
      type: 'object',
      properties: {
        deviceFingerprint: {
          type: 'string',
          description: 'Stable device fingerprint (same as used in get_device).'
        },
        label: {
          type: 'string',
          description: 'New label for the device (lowercase kebab-case, 1–64 chars).'
        }
      },
      required: ['deviceFingerprint', 'label']
    }
  },

  // ---------------------------------------------------------------------------
  // Project resource directories
  // ---------------------------------------------------------------------------

  {
    name: 'create_project',
    annotations: {
      title: 'Create Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      "Create a new project in the caller's organization. Optionally register a local directory as the project's primary resource in the same call (one-step setup) by passing directoryPath plus a deviceFingerprint — the directory must exist on that device.",
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name.'
        },
        color: {
          type: 'string',
          description: 'Optional hex color like #d4d4d8 (defaults to a soft rose).'
        },
        directoryPath: {
          type: 'string',
          description:
            "Optional absolute path on the calling device to register as the project's primary resource in one step."
        },
        deviceFingerprint: {
          type: 'string',
          description:
            'Stable fingerprint of the device that owns directoryPath (required with it).'
        },
        label: {
          type: 'string',
          description: 'Optional label for the registered directory.'
        },
        isPrimary: {
          type: 'boolean',
          description: 'Override primary status for the directory (defaults to primary).'
        },
        deviceHostname: {
          type: 'string',
          description: 'Hostname (used to auto-generate a device label on first registration).'
        },
        devicePlatform: {
          type: 'string',
          description: "Platform: 'darwin', 'linux', or 'windows'."
        },
        devicePort: {
          type: 'integer',
          description: 'SSH port for placeholder reconciliation when targets share a host.'
        }
      },
      required: ['name']
    }
  },

  {
    name: 'list_project_resources',
    annotations: {
      title: 'List Project Resources',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      'List the resource directories (local checkout paths) registered for a project. Optionally filter to only show directories associated with the current device.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'UUID of the project.'
        },
        deviceFingerprint: {
          type: 'string',
          description: 'Optional: filter to only show directories for this device.'
        }
      },
      required: ['projectId']
    }
  },

  {
    name: 'add_project_resource',
    annotations: {
      title: 'Add Project Resource',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    description:
      'Register a local directory as a resource for a project on the current device. The directory must exist on the calling device — verify with the filesystem before calling. The device is identified by deviceFingerprint.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'UUID of the project.'
        },
        directoryPath: {
          type: 'string',
          description: 'Absolute path to the directory on this device.'
        },
        deviceFingerprint: {
          type: 'string',
          description: 'Stable fingerprint identifying the current device.'
        },
        label: {
          type: 'string',
          description: 'Optional human-friendly label (e.g. "main checkout", "docs branch").'
        },
        isPrimary: {
          type: 'boolean',
          description: 'Mark as the primary directory for this project on this device.'
        },
        deviceHostname: {
          type: 'string',
          description: 'Hostname (used to auto-generate a device label on first registration).'
        },
        devicePlatform: {
          type: 'string',
          description: "Platform: 'darwin', 'linux', or 'windows'."
        },
        devicePort: {
          type: 'integer',
          description:
            'SSH port for placeholder reconciliation when multiple targets share the same host.'
        }
      },
      required: ['projectId', 'directoryPath', 'deviceFingerprint']
    }
  },

  {
    name: 'update_project_resource',
    annotations: {
      title: 'Update Project Resource',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    description:
      'Update the path, label, or primary status of a resource directory. The resource must belong to the current device (enforced via deviceFingerprint).',
    inputSchema: {
      type: 'object',
      properties: {
        resourceId: {
          type: 'string',
          description: 'UUID of the resource directory to update (from list_project_resources).'
        },
        deviceFingerprint: {
          type: 'string',
          description: 'Fingerprint of the current device (must own the resource).'
        },
        directoryPath: {
          type: 'string',
          description: 'New absolute path (optional).'
        },
        label: {
          type: 'string',
          description: 'New label, or null to clear it (optional).'
        },
        isPrimary: {
          type: 'boolean',
          description: 'Set as the primary directory for this project on this device (optional).'
        }
      },
      required: ['resourceId', 'deviceFingerprint']
    }
  }
];
