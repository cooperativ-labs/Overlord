import { NextResponse } from 'next/server';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { getAgentApiToken, getPlatformUrl } from '@/lib/env';
import {
  buildLaunchCommands,
  selectRestartSessionCommand
} from '@/lib/orchestrator/launch-commands';
import { resolveSession } from '@/lib/orchestrator/protocol-db';
import { deliverSchema } from '@/lib/orchestrator/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, deliverSchema);
  if (parsed.errorResponse || !parsed.data) {
    return parsed.errorResponse;
  }

  try {
    const { artifacts, sessionKey, summary, ticketId } = parsed.data;
    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    const { data: event, error: eventError } = await supabase
      .from('ticket_events')
      .insert({
        event_type: 'deliver',
        phase: 'deliver',
        session_id: resolved.session.id,
        summary,
        ticket_id: ticketId
      })
      .select('id')
      .single();
    if (eventError || !event) {
      return NextResponse.json(
        { error: eventError?.message ?? 'Failed to write delivery event.' },
        { status: 500 }
      );
    }

    const { claudeCode, codex } = buildLaunchCommands({
      platformUrl: getPlatformUrl(),
      ticketId,
      token: getAgentApiToken()
    });
    const restartCommand = selectRestartSessionCommand(resolved.session.agent_identifier, {
      claudeCode,
      codex
    });
    const hasRestartArtifact = artifacts.some(
      artifact => artifact.label.trim().toLowerCase() === 'restart session command'
    );
    const artifactsToPersist = hasRestartArtifact
      ? artifacts
      : [
          ...artifacts,
          {
            type: 'note',
            label: 'Restart session command',
            content: `\`\`\`bash\n${restartCommand}\n\`\`\``,
            uri: undefined,
            metadata: {
              agent_identifier: resolved.session.agent_identifier,
              generated_by: 'protocol_deliver',
              restart_session_command: true
            }
          }
        ];

    if (artifactsToPersist.length) {
      const artifactRows = artifactsToPersist.map(artifact => ({
        artifact_type: artifact.type,
        content: artifact.content ?? null,
        event_id: event.id,
        label: artifact.label,
        metadata: artifact.metadata,
        session_id: resolved.session.id,
        ticket_id: ticketId,
        uri: artifact.uri ?? null
      }));
      const { error: artifactError } = await supabase.from('artifacts').insert(artifactRows);
      if (artifactError) {
        return NextResponse.json({ error: artifactError.message }, { status: 500 });
      }
    }

    const [{ error: ticketError }, { error: sessionError }] = await Promise.all([
      supabase.from('tickets').update({ status: 'review' }).eq('id', ticketId),
      supabase
        .from('agent_sessions')
        .update({
          detached_at: new Date().toISOString(),
          session_state: 'completed'
        })
        .eq('id', resolved.session.id)
    ]);
    if (ticketError) {
      return NextResponse.json({ error: ticketError.message }, { status: 500 });
    }
    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    return NextResponse.json({
      artifacts: artifactsToPersist.length,
      ok: true,
      status: 'review'
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
