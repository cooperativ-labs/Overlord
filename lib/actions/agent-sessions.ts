'use server';

import { createClient } from '@/supabase/utils/server';

export async function getRunningAgentSessionCountAction(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('agent_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('session_state', 'attached')
    .is('detached_at', null);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}
