import { type NextRequest, NextResponse } from 'next/server';

import { createClientForRequest } from '@/supabase/utils/server';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const { ticketId } = await params;
  const supabase = await createClientForRequest();

  const { data: ticket } = await supabase
    .from('tickets')
    .select('title,acceptance_criteria,available_tools,for_human')
    .eq('id', ticketId)
    .single();
  const { data: nonEmptyObjective } = await supabase
    .from('objectives')
    .select('id')
    .eq('ticket_id', ticketId)
    .neq('objective', '')
    .limit(1)
    .maybeSingle();

  if (!ticket) return NextResponse.json({ deleted: false });

  const isEmpty =
    !ticket.title &&
    !nonEmptyObjective &&
    !ticket.acceptance_criteria &&
    !ticket.available_tools &&
    ticket.for_human === false;

  if (isEmpty) {
    await supabase.from('tickets').delete().eq('id', ticketId);
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json({ deleted: false });
}
