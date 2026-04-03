export type AgentModel = {
  id: string;
  agent_type: string;
  model_id: string;
  display_name: string;
  thinking_options: string[];
  capabilities: Record<string, unknown>;
  is_offered: boolean;
  is_recommended: boolean;
  sort_order: number;
  updated_at: string;
};

export function filterOfferedAgentModels(dbModels: AgentModel[], agentType?: string): AgentModel[] {
  return dbModels.filter(model => {
    if (!model.is_offered) return false;
    if (!agentType) return true;
    return model.agent_type === agentType;
  });
}
