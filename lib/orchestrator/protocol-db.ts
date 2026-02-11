import { createClient } from "@/lib/supabase/server";

type EventInsert = {
  eventType:
    | "system"
    | "question"
    | "answer"
    | "update"
    | "context_write"
    | "context_read"
    | "artifact"
    | "deliver"
    | "status_change"
    | "alert";
  isBlocking?: boolean;
  payload?: Record<string, unknown>;
  phase?: string | null;
  sessionId?: string | null;
  summary?: string | null;
  ticketId: string;
};

export async function resolveSession(sessionKey: string, ticketId: string) {
  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("session_key", sessionKey)
    .eq("ticket_id", ticketId)
    .single();

  if (error || !session) {
    return {
      error: "Session not found for ticket.",
      session: null,
    };
  }

  await supabase
    .from("agent_sessions")
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", session.id);

  return {
    error: null,
    session,
  };
}

export async function insertTicketEvent(input: EventInsert) {
  const supabase = await createClient();
  return supabase.from("ticket_events").insert({
    event_type: input.eventType,
    is_blocking: input.isBlocking ?? false,
    payload: input.payload ?? {},
    phase: input.phase ?? null,
    session_id: input.sessionId ?? null,
    summary: input.summary ?? null,
    ticket_id: input.ticketId,
  });
}
