import type { SupabaseClient } from '@supabase/supabase-js';

import { upsertExecutionTargetFromProtocol } from '@/lib/overlord/execution-targets';
import type { Database } from '@/types/database.types';

export type DeviceUpsertInput = {
  organizationId: number;
  userId: string;
  deviceFingerprint: string;
  hostname?: string | null;
  port?: number | null;
  platform?: string | null;
};

/** Upsert the canonical execution target for the calling agent. */
export async function upsertDeviceFromProtocol(
  supabase: SupabaseClient<Database>,
  input: DeviceUpsertInput
): Promise<string | null> {
  return upsertExecutionTargetFromProtocol(supabase, input);
}
