import { type NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/supabase/utils/server';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  const { ticketId } = await params;
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from('tickets')
    .select('title,objective,acceptance_criteria,available_tools,execution_target')
    .eq('id', ticketId)
    .single();

  if (!ticket) return NextResponse.json({ deleted: false });

  const isEmpty =
    !ticket.title &&
    !ticket.objective &&
    !ticket.acceptance_criteria &&
    !ticket.available_tools &&
    ticket.execution_target === 'agent';

  if (isEmpty) {
    await supabase.from('tickets').delete().eq('id', ticketId);
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json({ deleted: false });
}
