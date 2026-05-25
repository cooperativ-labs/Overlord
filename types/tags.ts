import { Database } from './database.types';

export type ProjectTagDefinition = Database['public']['Tables']['project_tag_definitions']['Row'];

export type TicketTagAssignment = {
  tag_definition_id: string;
  source: string;
  applied_at: string;
  definition: ProjectTagDefinition;
};

export type EffectiveTicketTag = {
  id: string;
  key: string;
  label: string;
  color: string | null;
  sources: string[];
};
