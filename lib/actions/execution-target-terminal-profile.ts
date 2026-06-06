'use server';

import {
  DEFAULT_RUNNER_TERMINAL_PROFILE,
  normalizeRunnerTerminalProfile,
  type RunnerTerminalProfile,
  runnerTerminalProfileToJson
} from '@/lib/helpers/runner-terminal-settings';
import { createClientForRequest } from '@/supabase/utils/server';

export async function getExecutionTargetTerminalProfilesAction(): Promise<
  Record<string, RunnerTerminalProfile>
> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data, error } = await supabase
    .from('user_execution_targets')
    .select('execution_target_id, terminal_profile')
    .eq('user_id', user.id);

  if (error) {
    console.error('getExecutionTargetTerminalProfilesAction', error);
    return {};
  }

  const result: Record<string, RunnerTerminalProfile> = {};
  for (const row of data ?? []) {
    result[row.execution_target_id] = normalizeRunnerTerminalProfile(row.terminal_profile);
  }
  return result;
}

export async function getExecutionTargetTerminalProfileAction(
  executionTargetId: string
): Promise<RunnerTerminalProfile> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('user_execution_targets')
    .select('terminal_profile')
    .eq('user_id', user.id)
    .eq('execution_target_id', executionTargetId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Failed to load terminal settings.');
  }

  return normalizeRunnerTerminalProfile(data?.terminal_profile ?? DEFAULT_RUNNER_TERMINAL_PROFILE);
}

export async function updateExecutionTargetTerminalProfileAction(
  executionTargetId: string,
  profile: RunnerTerminalProfile
): Promise<RunnerTerminalProfile> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Unauthorized');
  }

  const nextProfile = normalizeRunnerTerminalProfile(profile);
  const { data, error } = await supabase
    .from('user_execution_targets')
    .update({ terminal_profile: runnerTerminalProfileToJson(nextProfile) })
    .eq('user_id', user.id)
    .eq('execution_target_id', executionTargetId)
    .select('terminal_profile')
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Failed to save terminal settings.');
  }

  if (!data) {
    throw new Error('Execution target not found.');
  }

  return normalizeRunnerTerminalProfile(data.terminal_profile);
}
