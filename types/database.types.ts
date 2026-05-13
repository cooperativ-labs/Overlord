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
      agent_models: {
        Row: {
          agent_type: string;
          capabilities: Json | null;
          display_name: string;
          id: string;
          is_offered: boolean;
          is_recommended: boolean | null;
          model_id: string;
          sort_order: number | null;
          thinking_options: Json | null;
          updated_at: string | null;
        };
        Insert: {
          agent_type: string;
          capabilities?: Json | null;
          display_name: string;
          id?: string;
          is_offered?: boolean;
          is_recommended?: boolean | null;
          model_id: string;
          sort_order?: number | null;
          thinking_options?: Json | null;
          updated_at?: string | null;
        };
        Update: {
          agent_type?: string;
          capabilities?: Json | null;
          display_name?: string;
          id?: string;
          is_offered?: boolean;
          is_recommended?: boolean | null;
          model_id?: string;
          sort_order?: number | null;
          thinking_options?: Json | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
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
      app_features: {
        Row: {
          description: string;
          is_enabled: boolean;
          key: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          description: string;
          is_enabled?: boolean;
          key: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          description?: string;
          is_enabled?: boolean;
          key?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      artifacts: {
        Row: {
          artifact_type: string;
          content: string | null;
          created_at: string;
          created_by: string | null;
          event_id: string | null;
          id: string;
          label: string;
          metadata: Json;
          session_id: string | null;
          storage_path: string | null;
          ticket_id: string;
          uri: string | null;
        };
        Insert: {
          artifact_type: string;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_id?: string | null;
          id?: string;
          label: string;
          metadata?: Json;
          session_id?: string | null;
          storage_path?: string | null;
          ticket_id: string;
          uri?: string | null;
        };
        Update: {
          artifact_type?: string;
          content?: string | null;
          created_at?: string;
          created_by?: string | null;
          event_id?: string | null;
          id?: string;
          label?: string;
          metadata?: Json;
          session_id?: string | null;
          storage_path?: string | null;
          ticket_id?: string;
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
        Relationships: [];
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
          access_token_expires_at: string | null;
          approved_at: string | null;
          created_at: string;
          device_code: string;
          expires_at: string;
          id: string;
          next_poll_at: string | null;
          oauth_state: string | null;
          pkce_verifier: string | null;
          refresh_token: string | null;
          user_code: string;
          user_id: string | null;
        };
        Insert: {
          access_token?: string | null;
          access_token_expires_at?: string | null;
          approved_at?: string | null;
          created_at?: string;
          device_code: string;
          expires_at?: string;
          id?: string;
          next_poll_at?: string | null;
          oauth_state?: string | null;
          pkce_verifier?: string | null;
          refresh_token?: string | null;
          user_code: string;
          user_id?: string | null;
        };
        Update: {
          access_token?: string | null;
          access_token_expires_at?: string | null;
          approved_at?: string | null;
          created_at?: string;
          device_code?: string;
          expires_at?: string;
          id?: string;
          next_poll_at?: string | null;
          oauth_state?: string | null;
          pkce_verifier?: string | null;
          refresh_token?: string | null;
          user_code?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      early_access_requests: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          name: string;
          role: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          name: string;
          role: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          name?: string;
          role?: string;
        };
        Relationships: [];
      };
      feed_posts: {
        Row: {
          agent_type: string | null;
          body: string;
          created_at: string;
          created_by: string | null;
          files_touched: string[];
          human_actions: string[];
          id: string;
          impact_level: string;
          objective_id: string | null;
          objective_sections: Json;
          organization_id: number;
          orphan_file_changes: Json;
          pending_actions: number;
          project_id: string;
          session_id: string | null;
          source_event_ids: string[];
          source_session_ids: string[];
          source_window_end: string | null;
          source_window_start: string | null;
          summary: string;
          tags: string[];
          ticket_id: string;
          tickets_created: Json;
          title: string;
          total_events: number;
          total_files: number;
          tradeoffs: Json;
          updated_at: string;
        };
        Insert: {
          agent_type?: string | null;
          body: string;
          created_at?: string;
          created_by?: string | null;
          files_touched?: string[];
          human_actions?: string[];
          id?: string;
          impact_level?: string;
          objective_id?: string | null;
          objective_sections?: Json;
          organization_id: number;
          orphan_file_changes?: Json;
          pending_actions?: number;
          project_id: string;
          session_id?: string | null;
          source_event_ids?: string[];
          source_session_ids?: string[];
          source_window_end?: string | null;
          source_window_start?: string | null;
          summary?: string;
          tags?: string[];
          ticket_id: string;
          tickets_created?: Json;
          title: string;
          total_events?: number;
          total_files?: number;
          tradeoffs?: Json;
          updated_at?: string;
        };
        Update: {
          agent_type?: string | null;
          body?: string;
          created_at?: string;
          created_by?: string | null;
          files_touched?: string[];
          human_actions?: string[];
          id?: string;
          impact_level?: string;
          objective_id?: string | null;
          objective_sections?: Json;
          organization_id?: number;
          orphan_file_changes?: Json;
          pending_actions?: number;
          project_id?: string;
          session_id?: string | null;
          source_event_ids?: string[];
          source_session_ids?: string[];
          source_window_end?: string | null;
          source_window_start?: string | null;
          summary?: string;
          tags?: string[];
          ticket_id?: string;
          tickets_created?: Json;
          title?: string;
          total_events?: number;
          total_files?: number;
          tradeoffs?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'feed_posts_objective_id_fkey';
            columns: ['objective_id'];
            isOneToOne: false;
            referencedRelation: 'objectives';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feed_posts_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feed_posts_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feed_posts_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feed_posts_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      feedback: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          screenshot_paths: string[] | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          screenshot_paths?: string[] | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          screenshot_paths?: string[] | null;
          user_id?: string;
        };
        Relationships: [];
      };
      file_changes: {
        Row: {
          attribution_source: string;
          change_kind: string;
          checkpoint_id: string | null;
          confidence: string;
          created_at: string;
          event_id: string;
          file_name: string;
          file_path: string;
          hunks: Json;
          id: string;
          impact: string;
          label: string;
          objective_id: string | null;
          session_id: string;
          summary: string;
          ticket_id: string;
          updated_at: string;
          why: string;
        };
        Insert: {
          attribution_source?: string;
          change_kind?: string;
          checkpoint_id?: string | null;
          confidence?: string;
          created_at?: string;
          event_id: string;
          file_name: string;
          file_path: string;
          hunks?: Json;
          id?: string;
          impact: string;
          label: string;
          objective_id?: string | null;
          session_id: string;
          summary: string;
          ticket_id: string;
          updated_at?: string;
          why: string;
        };
        Update: {
          attribution_source?: string;
          change_kind?: string;
          checkpoint_id?: string | null;
          confidence?: string;
          created_at?: string;
          event_id?: string;
          file_name?: string;
          file_path?: string;
          hunks?: Json;
          id?: string;
          impact?: string;
          label?: string;
          objective_id?: string | null;
          session_id?: string;
          summary?: string;
          ticket_id?: string;
          updated_at?: string;
          why?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'file_changes_checkpoint_id_fkey';
            columns: ['checkpoint_id'];
            isOneToOne: false;
            referencedRelation: 'project_checkpoints';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_changes_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'ticket_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_changes_objective_id_fkey';
            columns: ['objective_id'];
            isOneToOne: false;
            referencedRelation: 'objectives';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_changes_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'file_changes_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
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
      objective_attachments: {
        Row: {
          content_type: string;
          created_at: string;
          created_by: string | null;
          file_size: number;
          id: string;
          label: string;
          metadata: Json;
          objective_id: string;
          session_id: string | null;
          storage_path: string;
          ticket_id: string;
        };
        Insert: {
          content_type?: string;
          created_at?: string;
          created_by?: string | null;
          file_size?: number;
          id?: string;
          label: string;
          metadata?: Json;
          objective_id: string;
          session_id?: string | null;
          storage_path: string;
          ticket_id: string;
        };
        Update: {
          content_type?: string;
          created_at?: string;
          created_by?: string | null;
          file_size?: number;
          id?: string;
          label?: string;
          metadata?: Json;
          objective_id?: string;
          session_id?: string | null;
          storage_path?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'objective_attachments_objective_id_fkey';
            columns: ['objective_id'];
            isOneToOne: false;
            referencedRelation: 'objectives';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'objective_attachments_objective_ticket_fkey';
            columns: ['objective_id', 'ticket_id'];
            isOneToOne: false;
            referencedRelation: 'objectives';
            referencedColumns: ['id', 'ticket_id'];
          },
          {
            foreignKeyName: 'objective_attachments_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'objective_attachments_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      objectives: {
        Row: {
          agent_identifier: string | null;
          assigned_agent: Json | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          model_identifier: string | null;
          objective: string;
          state: Database['public']['Enums']['objective_state'];
          ticket_id: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          agent_identifier?: string | null;
          assigned_agent?: Json | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          model_identifier?: string | null;
          objective?: string;
          state?: Database['public']['Enums']['objective_state'];
          ticket_id: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          agent_identifier?: string | null;
          assigned_agent?: Json | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          model_identifier?: string | null;
          objective?: string;
          state?: Database['public']['Enums']['objective_state'];
          ticket_id?: string;
          title?: string | null;
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
      organization_invitations: {
        Row: {
          accepted_by: string | null;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          organization_id: number;
          role: Database['public']['Enums']['organization_role'];
          status: string;
          token: string;
          updated_at: string;
        };
        Insert: {
          accepted_by?: string | null;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          organization_id: number;
          role?: Database['public']['Enums']['organization_role'];
          status?: string;
          token?: string;
          updated_at?: string;
        };
        Update: {
          accepted_by?: string | null;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          organization_id?: number;
          role?: Database['public']['Enums']['organization_role'];
          status?: string;
          token?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_invitations_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          feed_retention_days: number;
          git_provider: string | null;
          id: number;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          feed_retention_days?: number;
          git_provider?: string | null;
          id?: number;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          feed_retention_days?: number;
          git_provider?: string | null;
          id?: number;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          ai_title_generation: boolean;
          created_at: string;
          custom_agent_instructions: string;
          default_project_id: string | null;
          editor_scheme: string;
          email: string;
          id: string;
          image_url: string;
          name: string;
          onboarding: Json;
          preferences: Json;
          updated_at: string;
        };
        Insert: {
          ai_title_generation?: boolean;
          created_at?: string;
          custom_agent_instructions?: string;
          default_project_id?: string | null;
          editor_scheme?: string;
          email?: string;
          id: string;
          image_url?: string;
          name?: string;
          onboarding?: Json;
          preferences?: Json;
          updated_at?: string;
        };
        Update: {
          ai_title_generation?: boolean;
          created_at?: string;
          custom_agent_instructions?: string;
          default_project_id?: string | null;
          editor_scheme?: string;
          email?: string;
          id?: string;
          image_url?: string;
          name?: string;
          onboarding?: Json;
          preferences?: Json;
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
      project_agent_tokens: {
        Row: {
          created_at: string;
          id: string;
          last_used_at: string | null;
          project_id: string;
          token_hash: string;
          token_prefix: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          project_id: string;
          token_hash: string;
          token_prefix: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          project_id?: string;
          token_hash?: string;
          token_prefix?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_agent_tokens_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          }
        ];
      };
      project_checkpoints: {
        Row: {
          checkpoint_kind: string;
          created_at: string;
          created_by: string | null;
          diff_stat: string | null;
          event_id: string | null;
          git_commit_id: string | null;
          git_ref_name: string | null;
          head_sha: string | null;
          id: string;
          objective_id: string;
          organization_id: number;
          project_id: string;
          session_id: string | null;
          summary: string | null;
          ticket_id: string | null;
        };
        Insert: {
          checkpoint_kind?: string;
          created_at?: string;
          created_by?: string | null;
          diff_stat?: string | null;
          event_id?: string | null;
          git_commit_id?: string | null;
          git_ref_name?: string | null;
          head_sha?: string | null;
          id?: string;
          objective_id: string;
          organization_id: number;
          project_id: string;
          session_id?: string | null;
          summary?: string | null;
          ticket_id?: string | null;
        };
        Update: {
          checkpoint_kind?: string;
          created_at?: string;
          created_by?: string | null;
          diff_stat?: string | null;
          event_id?: string | null;
          git_commit_id?: string | null;
          git_ref_name?: string | null;
          head_sha?: string | null;
          id?: string;
          objective_id?: string;
          organization_id?: number;
          project_id?: string;
          session_id?: string | null;
          summary?: string | null;
          ticket_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'project_checkpoints_event_id_fkey';
            columns: ['event_id'];
            isOneToOne: false;
            referencedRelation: 'ticket_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_checkpoints_objective_id_fkey';
            columns: ['objective_id'];
            isOneToOne: false;
            referencedRelation: 'objectives';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_checkpoints_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_checkpoints_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_checkpoints_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'agent_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'project_checkpoints_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      project_tag_definitions: {
        Row: {
          color: string | null;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          key: string;
          label: string;
          project_id: string;
          updated_at: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          key: string;
          label: string;
          project_id: string;
          updated_at?: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          key?: string;
          label?: string;
          project_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_tag_definitions_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          }
        ];
      };
      project_user: {
        Row: {
          created_at: string | null;
          id: string;
          local_working_directory: string | null;
          preferences: Json;
          project_id: string;
          remote_helper_installed_at: string | null;
          remote_helper_version: string | null;
          remote_working_directory: string | null;
          ssh_auth_method: string | null;
          ssh_command: string | null;
          ssh_host: string | null;
          ssh_port: number | null;
          ssh_private_key_path: string | null;
          ssh_user: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          local_working_directory?: string | null;
          preferences?: Json;
          project_id: string;
          remote_helper_installed_at?: string | null;
          remote_helper_version?: string | null;
          remote_working_directory?: string | null;
          ssh_auth_method?: string | null;
          ssh_command?: string | null;
          ssh_host?: string | null;
          ssh_port?: number | null;
          ssh_private_key_path?: string | null;
          ssh_user?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          local_working_directory?: string | null;
          preferences?: Json;
          project_id?: string;
          remote_helper_installed_at?: string | null;
          remote_helper_version?: string | null;
          remote_working_directory?: string | null;
          ssh_auth_method?: string | null;
          ssh_command?: string | null;
          ssh_host?: string | null;
          ssh_port?: number | null;
          ssh_private_key_path?: string | null;
          ssh_user?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'project_user_project_id_fkey';
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
          name: string;
          operations_profile: Json | null;
          operations_profile_fingerprint: string | null;
          operations_profile_generated_at: string | null;
          organization_id: number;
          slack_default_status: string | null;
          updated_at: string;
        };
        Insert: {
          color?: string;
          created_at?: string;
          everhour_project_id?: string | null;
          id?: string;
          name: string;
          operations_profile?: Json | null;
          operations_profile_fingerprint?: string | null;
          operations_profile_generated_at?: string | null;
          organization_id: number;
          slack_default_status?: string | null;
          updated_at?: string;
        };
        Update: {
          color?: string;
          created_at?: string;
          everhour_project_id?: string | null;
          id?: string;
          name?: string;
          operations_profile?: Json | null;
          operations_profile_fingerprint?: string | null;
          operations_profile_generated_at?: string | null;
          organization_id?: number;
          slack_default_status?: string | null;
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
      push_tokens: {
        Row: {
          created_at: string;
          id: string;
          platform: string;
          token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          platform: string;
          token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          platform?: string;
          token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      schedule: {
        Row: {
          created_at: string;
          days_of_month: number[] | null;
          days_of_week: Json | null;
          id: number;
          name: string | null;
          organization_id: number;
          period_interval: number;
          period_type: string;
          start_date: string | null;
          timezone: string;
          weeks_of_month: number[] | null;
        };
        Insert: {
          created_at?: string;
          days_of_month?: number[] | null;
          days_of_week?: Json | null;
          id?: number;
          name?: string | null;
          organization_id: number;
          period_interval?: number;
          period_type?: string;
          start_date?: string | null;
          timezone: string;
          weeks_of_month?: number[] | null;
        };
        Update: {
          created_at?: string;
          days_of_month?: number[] | null;
          days_of_week?: Json | null;
          id?: number;
          name?: string | null;
          organization_id?: number;
          period_interval?: number;
          period_type?: string;
          start_date?: string | null;
          timezone?: string;
          weeks_of_month?: number[] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'schedule_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      servers: {
        Row: {
          created_at: string;
          host: string;
          host_key_fingerprint: string | null;
          id: string;
          label: string;
          last_connected_at: string | null;
          last_error: string | null;
          last_verified_at: string | null;
          organization_id: number;
          port: number;
          status: string;
          transport: string;
          updated_at: string;
          user_id: string;
          username: string;
        };
        Insert: {
          created_at?: string;
          host: string;
          host_key_fingerprint?: string | null;
          id?: string;
          label: string;
          last_connected_at?: string | null;
          last_error?: string | null;
          last_verified_at?: string | null;
          organization_id: number;
          port?: number;
          status?: string;
          transport?: string;
          updated_at?: string;
          user_id: string;
          username: string;
        };
        Update: {
          created_at?: string;
          host?: string;
          host_key_fingerprint?: string | null;
          id?: string;
          label?: string;
          last_connected_at?: string | null;
          last_error?: string | null;
          last_verified_at?: string | null;
          organization_id?: number;
          port?: number;
          status?: string;
          transport?: string;
          updated_at?: string;
          user_id?: string;
          username?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'servers_organization_id_fkey';
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
      slack_event_dedupe: {
        Row: {
          event_id: string;
          received_at: string;
        };
        Insert: {
          event_id: string;
          received_at?: string;
        };
        Update: {
          event_id?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      slack_workspaces: {
        Row: {
          bot_access_token: string;
          bot_user_id: string;
          created_at: string;
          default_execution_target: Database['public']['Enums']['ticket_execution_target'];
          default_priority: string;
          default_project_id: string | null;
          default_status: string;
          id: string;
          include_context: boolean;
          organization_id: number;
          restrict_to_owner: boolean;
          slack_user_id: string;
          team_id: string;
          team_name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          bot_access_token: string;
          bot_user_id: string;
          created_at?: string;
          default_execution_target?: Database['public']['Enums']['ticket_execution_target'];
          default_priority?: string;
          default_project_id?: string | null;
          default_status?: string;
          id?: string;
          include_context?: boolean;
          organization_id: number;
          restrict_to_owner?: boolean;
          slack_user_id: string;
          team_id: string;
          team_name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bot_access_token?: string;
          bot_user_id?: string;
          created_at?: string;
          default_execution_target?: Database['public']['Enums']['ticket_execution_target'];
          default_priority?: string;
          default_project_id?: string | null;
          default_status?: string;
          id?: string;
          include_context?: boolean;
          organization_id?: number;
          restrict_to_owner?: boolean;
          slack_user_id?: string;
          team_id?: string;
          team_name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'slack_workspaces_default_project_id_fkey';
            columns: ['default_project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'slack_workspaces_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          }
        ];
      };
      ticket_events: {
        Row: {
          created_at: string;
          created_by: string | null;
          event_type: Database['public']['Enums']['ticket_event_type'];
          id: string;
          is_blocking: boolean;
          objective_id: string | null;
          payload: Json;
          phase: string | null;
          session_id: string | null;
          summary: string | null;
          ticket_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          event_type?: Database['public']['Enums']['ticket_event_type'];
          id?: string;
          is_blocking?: boolean;
          objective_id?: string | null;
          payload?: Json;
          phase?: string | null;
          session_id?: string | null;
          summary?: string | null;
          ticket_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          event_type?: Database['public']['Enums']['ticket_event_type'];
          id?: string;
          is_blocking?: boolean;
          objective_id?: string | null;
          payload?: Json;
          phase?: string | null;
          session_id?: string | null;
          summary?: string | null;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ticket_events_objective_id_fkey';
            columns: ['objective_id'];
            isOneToOne: false;
            referencedRelation: 'objectives';
            referencedColumns: ['id'];
          },
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
      ticket_identifier_counters: {
        Row: {
          next_sequence: number;
          organization_id: number;
        };
        Insert: {
          next_sequence: number;
          organization_id: number;
        };
        Update: {
          next_sequence?: number;
          organization_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'ticket_identifier_counters_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: true;
            referencedRelation: 'organizations';
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
      ticket_tag_assignments: {
        Row: {
          applied_at: string;
          applied_by: string | null;
          source: string;
          tag_definition_id: string;
          ticket_id: string;
          updated_at: string;
        };
        Insert: {
          applied_at?: string;
          applied_by?: string | null;
          source: string;
          tag_definition_id: string;
          ticket_id: string;
          updated_at?: string;
        };
        Update: {
          applied_at?: string;
          applied_by?: string | null;
          source?: string;
          tag_definition_id?: string;
          ticket_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ticket_tag_assignments_tag_definition_id_fkey';
            columns: ['tag_definition_id'];
            isOneToOne: false;
            referencedRelation: 'project_tag_definitions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ticket_tag_assignments_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      ticket_tag_engine_suppressions: {
        Row: {
          created_at: string;
          reason: string;
          suppressed_by: string | null;
          tag_definition_id: string;
          ticket_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          reason?: string;
          suppressed_by?: string | null;
          tag_definition_id: string;
          ticket_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          reason?: string;
          suppressed_by?: string | null;
          tag_definition_id?: string;
          ticket_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ticket_tag_engine_suppressions_tag_definition_id_fkey';
            columns: ['tag_definition_id'];
            isOneToOne: false;
            referencedRelation: 'project_tag_definitions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ticket_tag_engine_suppressions_ticket_id_fkey';
            columns: ['ticket_id'];
            isOneToOne: false;
            referencedRelation: 'tickets';
            referencedColumns: ['id'];
          }
        ];
      };
      tickets: {
        Row: {
          acceptance_criteria: string | null;
          available_tools: string;
          board_position: number;
          constraints: string;
          context: string;
          created_at: string;
          created_by: string | null;
          delegate: string | null;
          due_datetime: string | null;
          everhour_task_id: string | null;
          execution_target: Database['public']['Enums']['ticket_execution_target'];
          id: string;
          is_read: boolean;
          organization_id: number;
          output_format: string;
          priority: Database['public']['Enums']['ticket_priority'];
          project_id: string | null;
          schedule_id: number | null;
          search_vector: unknown;
          slack_channel_id: string | null;
          slack_thread_ts: string | null;
          slack_workspace_id: string | null;
          source: string | null;
          status: string;
          ticket_id: string;
          ticket_sequence: number;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          acceptance_criteria?: string | null;
          available_tools?: string;
          board_position?: number;
          constraints?: string;
          context?: string;
          created_at?: string;
          created_by?: string | null;
          delegate?: string | null;
          due_datetime?: string | null;
          everhour_task_id?: string | null;
          execution_target?: Database['public']['Enums']['ticket_execution_target'];
          id?: string;
          is_read?: boolean;
          organization_id: number;
          output_format?: string;
          priority?: Database['public']['Enums']['ticket_priority'];
          project_id?: string | null;
          schedule_id?: number | null;
          search_vector?: unknown;
          slack_channel_id?: string | null;
          slack_thread_ts?: string | null;
          slack_workspace_id?: string | null;
          source?: string | null;
          status?: string;
          ticket_id?: string;
          ticket_sequence?: number;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          acceptance_criteria?: string | null;
          available_tools?: string;
          board_position?: number;
          constraints?: string;
          context?: string;
          created_at?: string;
          created_by?: string | null;
          delegate?: string | null;
          due_datetime?: string | null;
          everhour_task_id?: string | null;
          execution_target?: Database['public']['Enums']['ticket_execution_target'];
          id?: string;
          is_read?: boolean;
          organization_id?: number;
          output_format?: string;
          priority?: Database['public']['Enums']['ticket_priority'];
          project_id?: string | null;
          schedule_id?: number | null;
          search_vector?: unknown;
          slack_channel_id?: string | null;
          slack_thread_ts?: string | null;
          slack_workspace_id?: string | null;
          source?: string | null;
          status?: string;
          ticket_id?: string;
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
            foreignKeyName: 'tickets_schedule_org_fkey';
            columns: ['schedule_id', 'organization_id'];
            isOneToOne: false;
            referencedRelation: 'schedule';
            referencedColumns: ['id', 'organization_id'];
          },
          {
            foreignKeyName: 'tickets_slack_workspace_id_fkey';
            columns: ['slack_workspace_id'];
            isOneToOne: false;
            referencedRelation: 'slack_workspaces';
            referencedColumns: ['id'];
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
      user_launch_preferences: {
        Row: {
          agent_type: string;
          created_at: string | null;
          id: string;
          model_id: string | null;
          thinking: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          agent_type: string;
          created_at?: string | null;
          id?: string;
          model_id?: string | null;
          thinking?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          agent_type?: string;
          created_at?: string | null;
          id?: string;
          model_id?: string | null;
          thinking?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_access_ticket: { Args: { p_ticket_id: string }; Returns: boolean };
      can_write_ticket: { Args: { p_ticket_id: string }; Returns: boolean };
      create_organization_for_current_user: {
        Args: { target_name: string };
        Returns: number;
      };
      first_ticket_objective_text: {
        Args: { p_ticket_id: string };
        Returns: string;
      };
      generate_ticket_identifier: {
        Args: { p_organization_id: number };
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
      resolve_ticket_event_objective_id: {
        Args: { p_ticket_id: string };
        Returns: string;
      };
      resolve_ticket_objective_id: {
        Args: { p_ticket_id: string };
        Returns: string;
      };
      schedule_days_of_week_is_valid: {
        Args: { payload: Json };
        Returns: boolean;
      };
      schedule_smallint_array_between: {
        Args: { max_value: number; min_value: number; payload: number[] };
        Returns: boolean;
      };
      seed_default_ticket_statuses_for_organization: {
        Args: { target_organization_id: number };
        Returns: undefined;
      };
      storage_org_id: { Args: { object_name: string }; Returns: number };
      storage_ticket_id: { Args: { object_name: string }; Returns: string };
      ticket_tag_matches_ticket_project: {
        Args: { p_tag_definition_id: string; p_ticket_id: string };
        Returns: boolean;
      };
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
      objective_state: 'future' | 'draft' | 'submitted' | 'executing' | 'complete';
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
      objective_state: ['future', 'draft', 'submitted', 'executing', 'complete'],
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
