import { NextResponse } from 'next/server';
import { basename } from 'node:path';

import { internalErrorResponse, parseProtocolBody } from '@/app/api/protocol/_lib';
import { resolveSession, resolveTicketId } from '@/lib/overlord/protocol-db';
import { transcriptIngestSchema } from '@/lib/overlord/validation';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

function buildTranscriptSummary(event: {
  file_path: string | null;
  summary: string | null;
  tool_name: string | null;
}) {
  if (event.summary?.trim()) return event.summary.trim();
  if (event.file_path && event.tool_name) {
    return `${event.tool_name} touched ${event.file_path}.`;
  }
  if (event.file_path) {
    return `Transcript evidence linked work to ${event.file_path}.`;
  }
  if (event.tool_name) {
    return `Transcript recorded ${event.tool_name} activity.`;
  }
  return 'Transcript ingestion recorded high-signal agent activity.';
}

export async function POST(request: Request) {
  const parsed = await parseProtocolBody(request, transcriptIngestSchema);
  if (!parsed.ok) return parsed.errorResponse;

  try {
    const {
      drafts,
      events,
      externalSessionId,
      parserVersion,
      sessionKey,
      sourceAgent,
      sourcePath,
      ticketId: rawTicketId
    } = parsed.data;
    const { organizationId } = parsed.tokenContext;
    const ticketId = await resolveTicketId(rawTicketId, organizationId);
    if (!ticketId) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });

    const supabase = createServiceRoleClient();
    const resolved = await resolveSession(sessionKey, ticketId, organizationId);
    if (!resolved.session) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }

    let promotedCount = 0;

    if (events.length > 0) {
      const eventRows = events.map(event => ({
        actor: event.actor ?? null,
        command_preview: event.commandPreview ?? null,
        event_hash: event.eventHash,
        event_kind: event.eventKind,
        event_source: sourceAgent,
        event_time: event.eventTime,
        evidence: event.evidence ?? {},
        external_session_id: externalSessionId ?? null,
        file_path: event.filePath ?? null,
        high_signal: event.highSignal ?? false,
        parser_version: parserVersion,
        raw_payload: event.rawPayload ?? {},
        session_id: resolved.session.id,
        source_path: sourcePath,
        summary: event.summary ?? null,
        ticket_id: ticketId,
        tool_name: event.toolName ?? null
      }));

      const { data: upsertedEvents, error: eventError } = await supabase
        .from('agent_transcript_events')
        .upsert(eventRows, { onConflict: 'session_id,event_hash' })
        .select(
          'id,summary,tool_name,file_path,high_signal,promoted_event_id,event_kind,evidence,command_preview'
        );

      if (eventError) {
        return NextResponse.json({ error: eventError.message }, { status: 500 });
      }

      const promotableEvents = (upsertedEvents ?? []).filter(
        event => event.high_signal && !event.promoted_event_id
      );

      if (promotableEvents.length > 0) {
        const { data: createdEvents, error: promotedError } = await supabase
          .from('ticket_events')
          .insert(
            promotableEvents.map(event => ({
              event_type: 'update',
              payload: {
                command_preview: event.command_preview,
                entry_type: 'transcript_event',
                event_kind: event.event_kind,
                evidence: event.evidence,
                file_path: event.file_path,
                source_agent: sourceAgent,
                tool_name: event.tool_name
              },
              phase: 'execute',
              session_id: resolved.session.id,
              summary: buildTranscriptSummary(event),
              ticket_id: ticketId
            }))
          )
          .select('id');

        if (promotedError) {
          return NextResponse.json({ error: promotedError.message }, { status: 500 });
        }

        promotedCount = createdEvents?.length ?? 0;

        if ((createdEvents?.length ?? 0) > 0) {
          for (let index = 0; index < createdEvents.length; index++) {
            const createdEvent = createdEvents[index];
            const transcriptEvent = promotableEvents[index];
            if (!createdEvent || !transcriptEvent) continue;

            await supabase
              .from('agent_transcript_events')
              .update({ promoted_event_id: createdEvent.id })
              .eq('id', transcriptEvent.id);
          }
        }
      }
    }

    if (drafts.length > 0) {
      const draftRows = drafts.map(draft => ({
        attribution_source: draft.attribution_source ?? 'transcript_draft',
        change_kind: draft.change_kind ?? 'modify',
        confidence: draft.confidence ?? 'medium',
        evidence: draft.evidence ?? [],
        file_name: basename(draft.file_path),
        file_path: draft.file_path,
        hunks: draft.hunks ?? [],
        impact: draft.impact,
        label: draft.label,
        session_id: resolved.session.id,
        source_event_hashes: draft.source_event_hashes ?? [],
        status: draft.status ?? 'draft',
        summary: draft.summary,
        ticket_id: ticketId,
        why: draft.why
      }));

      const { error: draftError } = await supabase
        .from('change_rationale_drafts')
        .upsert(draftRows, { onConflict: 'session_id,file_path,status' });

      if (draftError) {
        return NextResponse.json({ error: draftError.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      draftCount: drafts.length,
      eventCount: events.length,
      ok: true,
      promotedCount
    });
  } catch (error) {
    return internalErrorResponse(error);
  }
}
