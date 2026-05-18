import { Database } from './database.types';

export type ObjectiveRow = Pick<
  Database['public']['Tables']['objectives']['Row'],
  | 'id'
  | 'objective'
  | 'created_at'
  | 'title'
  | 'state'
  | 'agent_identifier'
  | 'model_identifier'
  | 'assigned_agent'
  | 'position'
  | 'auto_advance'
  | 'auto_advanced_at'
  | 'approval_reason'
  | 'updated_at'
>;
