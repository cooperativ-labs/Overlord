export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      agent_sessions: {
        Row: {
          agent_identifier: string;
          attached_at: string;
          connection_method: Database['public']['Enums']['connection_method'];
          created_at: string;
          detached_at: string | null;
          external_session_id: string | null;
          external_url: string | null;
          heartbeat_at: string;
          id: string;
          metadata: Json;
          session_key: string;
          session_state: Database['public']['Enums']['session_state'];
          ticket_id: string;
          updated_at: string;
        };
        Insert: {
          agent_identifier: string;
          attached_at?: string;
          connection_method?: Database['public']['Enums']['connection_method'];
          created_at?: string;
          detached_at?: string | null;
          external_session_id?: string | null;
          external_url?: string | null;
          heartbeat_at?: string;
          id?: string;
          metadata?: Json;
          session_key?: string;
          session_state?: Database['public']['Enums']['session_state'];
          ticket_id: string;
          updated_at?: string;
        };
        Update: {
          agent_identifier?: string;
          attached_at?: string;
          connection_method?: Database['public']['Enums']['connection_method'];
          created_at?: string;
          detached_at?: string | null;
          external_session_id?: string | null;
          external_url?: string | null;
          heartbeat_at?: string;
          id?: string;
          metadata?: Json;
          session_key?: string;
          session_state?: Database['public']['Enums']['session_state'];
          ticket_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_sessions_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      agent_tokens: {
        Row: {
          created_at: string;
          created_by_grant_id: string | null;
          expires_at: string | null;
          id: string;
          last_used_at: string | null;
          name: string;
          organization_id: number;
          revoked_at: string | null;
          token: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          created_by_grant_id?: string | null;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          organization_id: number;
          revoked_at?: string | null;
          token?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by_grant_id?: string | null;
          expires_at?: string | null;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          organization_id?: number;
          revoked_at?: string | null;
          token?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_tokens_created_by_grant_id_fkey';
            columns: ['created_by_grant_id'];
            isOneToOne: false;
            referencedRelation: 'auth_grants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_tokens_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      artifacts: {
        Row: {
          artifact_type: string;
          content: string | null;
          created_at: string;
          event_id: string | null;
          id: string;
          label: string;
          metadata: Json;
          session_id: string | null;
          storage_path: string | null;
          ticket_id: string;
          uploaded_by: string | null;
          uri: string | null;
        };
        Insert: {
          artifact_type: string;
          content?: string | null;
          created_at?: string;
          event_id?: string | null;
          id?: string;
          label: string;
          metadata?: Json;
          session_id?: string | null;
          storage_path?: string | null;
          ticket_id: string;
          uploaded_by?: string | null;
          uri?: string | null;
        };
        Update: {
          artifact_type?: string;
          content?: string | null;
          created_at?: string;
          event_id?: string | null;
          id?: string;
          label?: string;
          metadata?: Json;
          session_id?: string | null;
          storage_path?: string | null;
          ticket_id?: string;
          uploaded_by?: string | null;
          uri?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'artifacts_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'ticket_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'artifacts_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'artifacts_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      auth_grants: {
        Row: {
          agent_token_id: string | null;
          approved_at: string | null;
          client_name: string | null;
          client_type: string;
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          grant_code: string;
          id: string;
          user_code: string;
          user_id: string | null;
        };
        Insert: {
          agent_token_id?: string | null;
          approved_at?: string | null;
          client_name?: string | null;
          client_type?: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          grant_code?: string;
          id?: string;
          user_code: string;
          user_id?: string | null;
        };
        Update: {
          agent_token_id?: string | null;
          approved_at?: string | null;
          client_name?: string | null;
          client_type?: string;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          grant_code?: string;
          id?: string;
          user_code?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'auth_grants_agent_token_id_fkey';
            columns: ['agent_token_id'];
            isOneToOne: false;
            referencedRelation: 'agent_tokens';
            referencedColumns: ['id'];
          }
        ];
      };
      change_rationales: {
        Row: {
          attribution_source: string;
          change_kind: string;
          confidence: string;
          created_at: string;
          event_id: string;
          file_path: string;
          hunks: Json;
          id: string;
          impact: string;
          label: string;
          organization_id: number;
          project_id: string;
          session_id: string;
          summary: string;
          ticket_id: string;
          updated_at: string;
          why: string;
        };
        Insert: {
          attribution_source?: string;
          change_kind?: string;
          confidence?: string;
          created_at?: string;
          event_id: string;
          file_path: string;
          hunks?: Json;
          id?: string;
          impact: string;
          label: string;
          organization_id: number;
          project_id: string;
          session_id: string;
          summary: string;
          ticket_id: string;
          updated_at?: string;
          why: string;
        };
        Update: {
          attribution_source?: string;
          change_kind?: string;
          confidence?: string;
          created_at?: string;
          event_id?: string;
          file_path?: string;
          hunks?: Json;
          id?: string;
          impact?: string;
          label?: string;
          organization_id?: number;
          project_id?: string;
          session_id?: string;
          summary?: string;
          ticket_id?: string;
          updated_at?: string;
          why?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'change_rationales_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'ticket_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'change_rationales_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'change_rationales_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'change_rationales_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'change_rationales_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      connections: {
        Row: {
          config: Json;
          created_at: string;
          display_name: string;
          id: string;
          is_default: boolean;
          owner_id: string | null;
          provider: string;
          updated_at: string;
        };
        Insert: {
          config?: Json;
          created_at?: string;
          display_name: string;
          id?: string;
          is_default?: boolean;
          owner_id?: string | null;
          provider: string;
          updated_at?: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          display_name?: string;
          id?: string;
          is_default?: boolean;
          owner_id?: string | null;
          provider?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      device_auth_codes: {
        Row: {
          access_token: string | null;
          approved_at: string | null;
          created_at: string;
          device_code: string;
          expires_at: string;
          id: string;
          next_poll_at: string | null;
          user_code: string;
          user_id: string | null;
        };
        Insert: {
          access_token?: string | null;
          approved_at?: string | null;
          created_at?: string;
          device_code: string;
          expires_at?: string;
          id?: string;
          next_poll_at?: string | null;
          user_code: string;
          user_id?: string | null;
        };
        Update: {
          access_token?: string | null;
          approved_at?: string | null;
          created_at?: string;
          device_code?: string;
          expires_at?: string;
          id?: string;
          next_poll_at?: string | null;
          user_code?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      members: {
        Row: {
          created_at: string;
          organization_id: number;
          role: Database['public']['Enums']['organization_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          organization_id: number;
          role?: Database['public']['Enums']['organization_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          organization_id?: number;
          role?: Database['public']['Enums']['organization_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      objectives: {
        Row: {
          created_at: string;
          id: string;
          is_executed: boolean;
          objective: string;
          ticket_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_executed?: boolean;
          objective?: string;
          ticket_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_executed?: boolean;
          objective?: string;
          ticket_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'objectives_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: number;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: number;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          custom_agent_instructions: string;
          default_project_id: string | null;
          editor_scheme: string;
          email: string;
          id: string;
          image_url: string;
          name: string;
          onboarding: Json;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          custom_agent_instructions?: string;
          default_project_id?: string | null;
          editor_scheme?: string;
          email?: string;
          id: string;
          image_url?: string;
          name?: string;
          onboarding?: Json;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          custom_agent_instructions?: string;
          default_project_id?: string | null;
          editor_scheme?: string;
          email?: string;
          id?: string;
          image_url?: string;
          name?: string;
          onboarding?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_default_project_id_fkey';
            columns: ['default_project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          }
        ];
      };
      project_user_preferences: {
        Row: {
          created_at: string | null;
          id: string;
          preferences: Json;
          project_id: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          preferences?: Json;
          project_id: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          preferences?: Json;
          project_id?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_user_preferences_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          }
        ];
      };
      projects: {
        Row: {
          color: string;
          created_at: string;
          everhour_project_id: string | null;
          id: string;
          local_working_directory: string | null;
          name: string;
          organization_id: number;
          updated_at: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          everhour_project_id?: string | null;
          id?: string;
          local_working_directory?: string | null;
          name: string;
          organization_id: number;
          updated_at?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          everhour_project_id?: string | null;
          id?: string;
          local_working_directory?: string | null;
          name?: string;
          organization_id?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      shared_state: {
        Row: {
          created_at: string;
          id: string;
          session_id: string | null;
          source: string;
          state_key: string;
          state_value: Json;
          tags: string[];
          ticket_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          session_id?: string | null;
          source?: string;
          state_key: string;
          state_value: Json;
          tags?: string[];
          ticket_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          session_id?: string | null;
          source?: string;
          state_key?: string;
          state_value?: Json;
          tags?: string[];
          ticket_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'shared_state_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shared_state_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      ticket_events: {
        Row: {
          created_at: string;
          event_type: Database['public']['Enums']['ticket_event_type'];
          id: string;
          is_blocking: boolean;
          payload: Json;
          phase: string | null;
          session_id: string | null;
          summary: string | null;
          ticket_id: string;
        };
        Insert: {
          created_at?: string;
          event_type?: Database['public']['Enums']['ticket_event_type'];
          id?: string;
          is_blocking?: boolean;
          payload?: Json;
          phase?: string | null;
          session_id?: string | null;
          summary?: string | null;
          ticket_id: string;
        };
        Update: {
          created_at?: string;
          event_type?: Database['public']['Enums']['ticket_event_type'];
          id?: string;
          is_blocking?: boolean;
          payload?: Json;
          phase?: string | null;
          session_id?: string | null;
          summary?: string | null;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ticket_events_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ticket_events_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      ticket_statuses: {
        Row: {
          created_at: string;
          is_default: boolean;
          name: string;
          organization_id: number;
          position: number;
          status_type: Database['public']['Enums']['ticket_status_type'];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          is_default?: boolean;
          name: string;
          organization_id: number;
          position?: number;
          status_type: Database['public']['Enums']['ticket_status_type'];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          is_default?: boolean;
          name?: string;
          organization_id?: number;
          position?: number;
          status_type?: Database['public']['Enums']['ticket_status_type'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ticket_statuses_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      tickets: {
        Row: {
          acceptance_criteria: string | null;
          assigned_agent: string | null;
          available_tools: string;
          board_position: number;
          constraints: string;
          context: string;
          created_at: string;
          created_by: string;
          everhour_task_id: string | null;
          execution_target: Database['public']['Enums']['ticket_execution_target'];
          id: string;
          is_read: boolean;
          objective: string | null;
          organization_id: number;
          output_format: string;
          priority: Database['public']['Enums']['ticket_priority'];
          project_id: string;
          recent_agent: string | null;
          search_vector: unknown;
          status: string;
          ticket_sequence: number;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          acceptance_criteria?: string | null;
          assigned_agent?: string | null;
          available_tools?: string;
          board_position?: number;
          constraints?: string;
          context?: string;
          created_at?: string;
          created_by?: string;
          everhour_task_id?: string | null;
          execution_target?: Database['public']['Enums']['ticket_execution_target'];
          id?: string;
          is_read?: boolean;
          objective?: string | null;
          organization_id: number;
          output_format?: string;
          priority?: Database['public']['Enums']['ticket_priority'];
          project_id: string;
          recent_agent?: string | null;
          search_vector?: unknown;
          status?: string;
          ticket_sequence?: number;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          acceptance_criteria?: string | null;
          assigned_agent?: string | null;
          available_tools?: string;
          board_position?: number;
          constraints?: string;
          context?: string;
          created_at?: string;
          created_by?: string;
          everhour_task_id?: string | null;
          execution_target?: Database['public']['Enums']['ticket_execution_target'];
          id?: string;
          is_read?: boolean;
          objective?: string | null;
          organization_id?: number;
          output_format?: string;
          priority?: Database['public']['Enums']['ticket_priority'];
          project_id?: string;
          recent_agent?: string | null;
          search_vector?: unknown;
          status?: string;
          ticket_sequence?: number;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tickets_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tickets_project_org_fkey';
            columns: ['project_id', 'organization_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id', 'organization_id'];
          },
          {
            foreignKeyName: 'tickets_status_org_fk';
            columns: ['organization_id', 'status'];
            isOneToOne: false;
            referencedRelation: 'ticket_statuses';
            referencedColumns: ['organization_id', 'name'];
          }
        ];
      };
      user_agent_configs: {
        Row: {
          agent_type: string;
          config: Json;
          created_at: string | null;
          id: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          agent_type: string;
          config?: Json;
          created_at?: string | null;
          id?: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          agent_type?: string;
          config?: Json;
          created_at?: string | null;
          id?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_integrations: {
        Row: {
          api_key: string;
          created_at: string;
          id: string;
          metadata: Json;
          provider: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          api_key: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          provider: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          api_key?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          provider?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_organization_for_current_user: {
        Args: { target_name: string };
        Returns: number;
      };
      first_ticket_objective_text: {
        Args: { p_ticket_id: string };
        Returns: string;
      };
      has_org_role: {
        Args: {
          allowed_roles: Database['public']['Enums']['organization_role'][];
          target_organization_id: number;
        };
        Returns: boolean;
      };
      is_org_member: {
        Args: { target_organization_id: number };
        Returns: boolean;
      };
      is_ticket_org_member: { Args: { p_ticket_id: string }; Returns: boolean };
      seed_default_ticket_statuses_for_organization: {
        Args: { target_organization_id: number };
        Returns: undefined;
      };
      storage_org_id: { Args: { object_name: string }; Returns: number };
      storage_ticket_id: { Args: { object_name: string }; Returns: string };
    };
    Enums: {
      connection_method:
        | 'mcp'
        | 'cli'
        | 'rest'
        | 'chatgpt'
        | 'claude_app'
        | 'claude_code'
        | 'other';
      organization_role: 'VIEWER' | 'AGENT' | 'MANAGER' | 'ADMIN';
      session_state: 'attached' | 'idle' | 'blocked' | 'completed' | 'disconnected';
      ticket_event_type:
        | 'system'
        | 'question'
        | 'answer'
        | 'update'
        | 'context_write'
        | 'context_read'
        | 'artifact'
        | 'deliver'
        | 'status_change'
        | 'alert'
        | 'user_follow_up'
        | 'ticket_reopened';
      ticket_execution_target: 'agent' | 'human';
      ticket_priority: 'low' | 'medium' | 'high' | 'urgent';
      ticket_status_type: 'draft' | 'execute' | 'review' | 'complete';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {}
  },
  public: {
    Enums: {
      connection_method: ['mcp', 'cli', 'rest', 'chatgpt', 'claude_app', 'claude_code', 'other'],
      organization_role: ['VIEWER', 'AGENT', 'MANAGER', 'ADMIN'],
      session_state: ['attached', 'idle', 'blocked', 'completed', 'disconnected'],
      ticket_event_type: [
        'system',
        'question',
        'answer',
        'update',
        'context_write',
        'context_read',
        'artifact',
        'deliver',
        'status_change',
        'alert',
        'user_follow_up',
        'ticket_reopened'
      ],
      ticket_execution_target: ['agent', 'human'],
      ticket_priority: ['low', 'medium', 'high', 'urgent'],
      ticket_status_type: ['draft', 'execute', 'review', 'complete']
    }
  }
} as const;
