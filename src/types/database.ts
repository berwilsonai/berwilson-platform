export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          project_id: string | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          created_at: string | null
          id: string
          project_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_conversations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: string
          latency_ms: number | null
          model_used: string | null
          rating: number | null
          role: string
          tokens_in: number | null
          tokens_out: number | null
          tool_calls: Json | null
          tool_results: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          model_used?: string | null
          rating?: number | null
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
          tool_results?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          model_used?: string | null
          rating?: number | null
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
          tool_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_queries: {
        Row: {
          cited_records: Json | null
          created_at: string | null
          id: string
          latency_ms: number | null
          model_used: string
          prompt_version: string | null
          query_text: string
          rating: number | null
          response_text: string
          tokens_in: number | null
          tokens_out: number | null
          user_id: string
        }
        Insert: {
          cited_records?: Json | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          model_used: string
          prompt_version?: string | null
          query_text: string
          rating?: number | null
          response_text: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id: string
        }
        Update: {
          cited_records?: Json | null
          created_at?: string | null
          id?: string
          latency_ms?: number | null
          model_used?: string
          prompt_version?: string | null
          query_text?: string
          rating?: number | null
          response_text?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string
        }
        Relationships: []
      }
      chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          document_id: string | null
          embedding: string | null
          id: string
          project_id: string
          token_count: number | null
          update_id: string | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          id?: string
          project_id: string
          token_count?: number | null
          update_id?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          id?: string
          project_id?: string
          token_count?: number | null
          update_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "updates"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_items: {
        Row: {
          created_at: string | null
          due_date: string | null
          evidence_doc_id: string | null
          framework: string
          id: string
          notes: string | null
          project_id: string | null
          requirement: string
          responsible_party: string | null
          status: Database["public"]["Enums"]["compliance_status"] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          due_date?: string | null
          evidence_doc_id?: string | null
          framework: string
          id?: string
          notes?: string | null
          project_id?: string | null
          requirement: string
          responsible_party?: string | null
          status?: Database["public"]["Enums"]["compliance_status"] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          due_date?: string | null
          evidence_doc_id?: string | null
          framework?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          requirement?: string
          responsible_party?: string | null
          status?: Database["public"]["Enums"]["compliance_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_items_evidence_doc_id_fkey"
            columns: ["evidence_doc_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_items_responsible_party_fkey"
            columns: ["responsible_party"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      dd_items: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string | null
          id: string
          item: string
          notes: string | null
          project_id: string
          resolved_at: string | null
          severity: Database["public"]["Enums"]["dd_severity"] | null
          status: string | null
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string | null
          id?: string
          item: string
          notes?: string | null
          project_id: string
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["dd_severity"] | null
          status?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string | null
          id?: string
          item?: string
          notes?: string | null
          project_id?: string
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["dd_severity"] | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dd_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dd_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_summary: string | null
          classification: string | null
          confidence: number | null
          doc_type: string | null
          embedding_status: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          project_id: string
          source: Database["public"]["Enums"]["update_source"] | null
          storage_path: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          ai_summary?: string | null
          classification?: string | null
          confidence?: number | null
          doc_type?: string | null
          embedding_status?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          project_id: string
          source?: Database["public"]["Enums"]["update_source"] | null
          storage_path: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          ai_summary?: string | null
          classification?: string | null
          confidence?: number | null
          doc_type?: string | null
          embedding_status?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          project_id?: string
          source?: Database["public"]["Enums"]["update_source"] | null
          storage_path?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_tokens: {
        Row: {
          access_token: string
          created_at: string | null
          email_address: string
          expires_at: string
          id: string
          refresh_token: string
          scopes: string[] | null
          token_type: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          email_address: string
          expires_at: string
          id?: string
          refresh_token: string
          scopes?: string[] | null
          token_type?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          email_address?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          scopes?: string[] | null
          token_type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      entities: {
        Row: {
          created_at: string | null
          ein: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          formation_date: string | null
          id: string
          jurisdiction: string | null
          name: string
          notes: string | null
          ownership_pct: number | null
          parent_entity_id: string | null
        }
        Insert: {
          created_at?: string | null
          ein?: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          formation_date?: string | null
          id?: string
          jurisdiction?: string | null
          name: string
          notes?: string | null
          ownership_pct?: number | null
          parent_entity_id?: string | null
        }
        Update: {
          created_at?: string | null
          ein?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          formation_date?: string | null
          id?: string
          jurisdiction?: string | null
          name?: string
          notes?: string | null
          ownership_pct?: number | null
          parent_entity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_parent_entity_id_fkey"
            columns: ["parent_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_projects: {
        Row: {
          created_at: string | null
          entity_id: string
          equity_pct: number | null
          id: string
          notes: string | null
          project_id: string
          relationship: string
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          equity_pct?: number | null
          id?: string
          notes?: string | null
          project_id: string
          relationship: string
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          equity_pct?: number | null
          id?: string
          notes?: string | null
          project_id?: string
          relationship?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_projects_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      financing_structures: {
        Row: {
          created_at: string | null
          draw_schedule: Json | null
          equity_amount: number | null
          equity_pct: number | null
          id: string
          interest_rate: number | null
          lender: string | null
          ltv: number | null
          mezzanine: number | null
          notes: string | null
          pe_partner: string | null
          project_id: string
          senior_debt: number | null
          structure_type: string | null
          updated_at: string | null
          waterfall_notes: string | null
        }
        Insert: {
          created_at?: string | null
          draw_schedule?: Json | null
          equity_amount?: number | null
          equity_pct?: number | null
          id?: string
          interest_rate?: number | null
          lender?: string | null
          ltv?: number | null
          mezzanine?: number | null
          notes?: string | null
          pe_partner?: string | null
          project_id: string
          senior_debt?: number | null
          structure_type?: string | null
          updated_at?: string | null
          waterfall_notes?: string | null
        }
        Update: {
          created_at?: string | null
          draw_schedule?: Json | null
          equity_amount?: number | null
          equity_pct?: number | null
          id?: string
          interest_rate?: number | null
          lender?: string | null
          ltv?: number | null
          mezzanine?: number | null
          notes?: string | null
          pe_partner?: string | null
          project_id?: string
          senior_debt?: number | null
          structure_type?: string | null
          updated_at?: string | null
          waterfall_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financing_structures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      graph_subscriptions: {
        Row: {
          change_type: string
          client_state: string
          created_at: string | null
          email_address: string
          expiration_date_time: string
          id: string
          is_active: boolean | null
          notification_url: string
          resource: string
          subscription_id: string
          updated_at: string | null
        }
        Insert: {
          change_type?: string
          client_state: string
          created_at?: string | null
          email_address: string
          expiration_date_time: string
          id?: string
          is_active?: boolean | null
          notification_url: string
          resource: string
          subscription_id: string
          updated_at?: string | null
        }
        Update: {
          change_type?: string
          client_state?: string
          created_at?: string | null
          email_address?: string
          expiration_date_time?: string
          id?: string
          is_active?: boolean | null
          notification_url?: string
          resource?: string
          subscription_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      milestones: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          label: string
          notes: string | null
          project_id: string
          sort_order: number | null
          stage: Database["public"]["Enums"]["project_stage"]
          target_date: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          label: string
          notes?: string | null
          project_id: string
          sort_order?: number | null
          stage: Database["public"]["Enums"]["project_stage"]
          target_date?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          label?: string
          notes?: string | null
          project_id?: string
          sort_order?: number | null
          stage?: Database["public"]["Enums"]["project_stage"]
          target_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          avatar_url: string | null
          background_check_completed: boolean | null
          background_check_date: string | null
          background_check_notes: string | null
          background_check_provider: string | null
          background_check_reference: string | null
          company: string | null
          created_at: string | null
          email: string | null
          enrichment_conflicts: Json | null
          enrichment_notes: Json | null
          full_name: string
          government_contract_history: string | null
          graph_enriched_at: string | null
          id: string
          is_organization: boolean | null
          linkedin_url: string | null
          perplexity_enriched_at: string | null
          phone: string | null
          relationship_notes: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          background_check_completed?: boolean | null
          background_check_date?: string | null
          background_check_notes?: string | null
          background_check_provider?: string | null
          background_check_reference?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          enrichment_conflicts?: Json | null
          enrichment_notes?: Json | null
          full_name: string
          government_contract_history?: string | null
          graph_enriched_at?: string | null
          id?: string
          is_organization?: boolean | null
          linkedin_url?: string | null
          perplexity_enriched_at?: string | null
          phone?: string | null
          relationship_notes?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          background_check_completed?: boolean | null
          background_check_date?: string | null
          background_check_notes?: string | null
          background_check_provider?: string | null
          background_check_reference?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          enrichment_conflicts?: Json | null
          enrichment_notes?: Json | null
          full_name?: string
          government_contract_history?: string | null
          graph_enriched_at?: string | null
          id?: string
          is_organization?: boolean | null
          linkedin_url?: string | null
          perplexity_enriched_at?: string | null
          phone?: string | null
          relationship_notes?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      processed_emails: {
        Row: {
          email_address: string
          graph_message_id: string
          id: string
          internet_message_id: string
          processed_at: string | null
          sender_email: string | null
          status: string | null
          subject: string | null
          update_id: string | null
        }
        Insert: {
          email_address: string
          graph_message_id: string
          id?: string
          internet_message_id: string
          processed_at?: string | null
          sender_email?: string | null
          status?: string | null
          subject?: string | null
          update_id?: string | null
        }
        Update: {
          email_address?: string
          graph_message_id?: string
          id?: string
          internet_message_id?: string
          processed_at?: string | null
          sender_email?: string | null
          status?: string | null
          subject?: string | null
          update_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processed_emails_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "updates"
            referencedColumns: ["id"]
          },
        ]
      }
      project_players: {
        Row: {
          created_at: string | null
          id: string
          is_primary: boolean | null
          notes: string | null
          party_id: string
          project_id: string
          role: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          party_id: string
          project_id: string
          role: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          party_id?: string
          project_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_players_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_players_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          award_date: string | null
          client_entity: string | null
          contract_type: string | null
          created_at: string | null
          delivery_method: string | null
          description: string | null
          estimated_value: number | null
          id: string
          location: string | null
          name: string
          ntp_date: string | null
          sector: Database["public"]["Enums"]["project_sector"]
          solicitation_number: string | null
          stage: Database["public"]["Enums"]["project_stage"] | null
          status: Database["public"]["Enums"]["project_status"] | null
          substantial_completion_date: string | null
          updated_at: string | null
        }
        Insert: {
          award_date?: string | null
          client_entity?: string | null
          contract_type?: string | null
          created_at?: string | null
          delivery_method?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          location?: string | null
          name: string
          ntp_date?: string | null
          sector: Database["public"]["Enums"]["project_sector"]
          solicitation_number?: string | null
          stage?: Database["public"]["Enums"]["project_stage"] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          substantial_completion_date?: string | null
          updated_at?: string | null
        }
        Update: {
          award_date?: string | null
          client_entity?: string | null
          contract_type?: string | null
          created_at?: string | null
          delivery_method?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          location?: string | null
          name?: string
          ntp_date?: string | null
          sector?: Database["public"]["Enums"]["project_sector"]
          solicitation_number?: string | null
          stage?: Database["public"]["Enums"]["project_stage"] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          substantial_completion_date?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      research_artifacts: {
        Row: {
          id: string
          model_used: string | null
          project_id: string | null
          query_text: string
          response_text: string
          retrieved_at: string | null
          source_urls: Json | null
        }
        Insert: {
          id?: string
          model_used?: string | null
          project_id?: string | null
          query_text: string
          response_text: string
          retrieved_at?: string | null
          source_urls?: Json | null
        }
        Update: {
          id?: string
          model_used?: string | null
          project_id?: string | null
          query_text?: string
          response_text?: string
          retrieved_at?: string | null
          source_urls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "research_artifacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      review_queue: {
        Row: {
          ai_explanation: string | null
          confidence: number | null
          created_at: string | null
          edit_diff: Json | null
          id: string
          project_id: string | null
          reason: string
          record_id: string
          resolution: string | null
          resolved_at: string | null
          reviewed_by: string | null
          source_table: string
        }
        Insert: {
          ai_explanation?: string | null
          confidence?: number | null
          created_at?: string | null
          edit_diff?: Json | null
          id?: string
          project_id?: string | null
          reason: string
          record_id: string
          resolution?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          source_table: string
        }
        Update: {
          ai_explanation?: string | null
          confidence?: number | null
          created_at?: string | null
          edit_diff?: Json | null
          id?: string
          project_id?: string | null
          reason?: string
          record_id?: string
          resolution?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          source_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_queue_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      updates: {
        Row: {
          action_items: Json | null
          confidence: number | null
          created_at: string | null
          decisions: Json | null
          embedding_status: string | null
          id: string
          mentioned_parties: Json
          project_id: string | null
          raw_content: string
          review_state: Database["public"]["Enums"]["review_state"] | null
          reviewed_at: string | null
          reviewed_by: string | null
          risks: Json | null
          source: Database["public"]["Enums"]["update_source"]
          source_ref: string | null
          summary: string | null
          waiting_on: Json | null
        }
        Insert: {
          action_items?: Json | null
          confidence?: number | null
          created_at?: string | null
          decisions?: Json | null
          embedding_status?: string | null
          id?: string
          mentioned_parties?: Json
          project_id?: string | null
          raw_content: string
          review_state?: Database["public"]["Enums"]["review_state"] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risks?: Json | null
          source: Database["public"]["Enums"]["update_source"]
          source_ref?: string | null
          summary?: string | null
          waiting_on?: Json | null
        }
        Update: {
          action_items?: Json | null
          confidence?: number | null
          created_at?: string | null
          decisions?: Json | null
          embedding_status?: string | null
          id?: string
          mentioned_parties?: Json
          project_id?: string | null
          raw_content?: string
          review_state?: Database["public"]["Enums"]["review_state"] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risks?: Json | null
          source?: Database["public"]["Enums"]["update_source"]
          source_ref?: string | null
          summary?: string | null
          waiting_on?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_chunks: {
        Args: {
          filter_after: string
          filter_project_ids: string[]
          match_count?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          id: string
          project_id: string
          similarity: number
          source_confidence: number
          token_count: number
          update_id: string
        }[]
      }
      wipe_all_data: { Args: never; Returns: undefined }
    }
    Enums: {
      compliance_status:
        | "not_started"
        | "in_progress"
        | "compliant"
        | "non_compliant"
        | "waived"
      dd_severity: "info" | "watch" | "critical" | "blocker"
      entity_type:
        | "llc"
        | "corp"
        | "jv"
        | "subsidiary"
        | "trust"
        | "fund"
        | "other"
      project_sector:
        | "government"
        | "infrastructure"
        | "real_estate"
        | "prefab"
        | "institutional"
      project_stage:
        | "pursuit"
        | "capture"
        | "bid"
        | "award"
        | "mobilization"
        | "execution"
        | "closeout"
      project_status: "active" | "on_hold" | "won" | "lost" | "closed"
      review_state: "pending" | "approved" | "rejected"
      update_source: "email" | "manual_paste" | "document" | "agent" | "procore"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string | null
        }
        Relationships: []
      }
      buckets_analytics: {
        Row: {
          created_at: string
          deleted_at: string | null
          format: string
          id: string
          name: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          format?: string
          id?: string
          name?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      buckets_vectors: {
        Row: {
          created_at: string
          id: string
          type: Database["storage"]["Enums"]["buckettype"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: Database["storage"]["Enums"]["buckettype"]
          updated_at?: string
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          metadata: Json | null
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          metadata?: Json | null
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      vector_indexes: {
        Row: {
          bucket_id: string
          created_at: string
          data_type: string
          dimension: number
          distance_metric: string
          id: string
          metadata_configuration: Json | null
          name: string
          updated_at: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          data_type: string
          dimension: number
          distance_metric: string
          id?: string
          metadata_configuration?: Json | null
          name: string
          updated_at?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          data_type?: string
          dimension?: number
          distance_metric?: string
          id?: string
          metadata_configuration?: Json | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vector_indexes_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets_vectors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allow_any_operation: {
        Args: { expected_operations: string[] }
        Returns: boolean
      }
      allow_only_operation: {
        Args: { expected_operation: string }
        Returns: boolean
      }
      can_insert_object: {
        Args: { bucketid: string; metadata: Json; name: string; owner: string }
        Returns: undefined
      }
      extension: { Args: { name: string }; Returns: string }
      filename: { Args: { name: string }; Returns: string }
      foldername: { Args: { name: string }; Returns: string[] }
      get_common_prefix: {
        Args: { p_delimiter: string; p_key: string; p_prefix: string }
        Returns: string
      }
      get_size_by_bucket: {
        Args: never
        Returns: {
          bucket_id: string
          size: number
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
          prefix_param: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          _bucket_id: string
          delimiter_param: string
          max_keys?: number
          next_token?: string
          prefix_param: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      operation: { Args: never; Returns: string }
      search: {
        Args: {
          bucketname: string
          levels?: number
          limits?: number
          offsets?: number
          prefix: string
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          created_at: string
          id: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_by_timestamp: {
        Args: {
          p_bucket_id: string
          p_level: number
          p_limit: number
          p_prefix: string
          p_sort_column: string
          p_sort_column_after: string
          p_sort_order: string
          p_start_after: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
      search_v2: {
        Args: {
          bucket_name: string
          levels?: number
          limits?: number
          prefix: string
          sort_column?: string
          sort_column_after?: string
          sort_order?: string
          start_after?: string
        }
        Returns: {
          created_at: string
          id: string
          key: string
          last_accessed_at: string
          metadata: Json
          name: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      buckettype: "STANDARD" | "ANALYTICS" | "VECTOR"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      compliance_status: [
        "not_started",
        "in_progress",
        "compliant",
        "non_compliant",
        "waived",
      ],
      dd_severity: ["info", "watch", "critical", "blocker"],
      entity_type: [
        "llc",
        "corp",
        "jv",
        "subsidiary",
        "trust",
        "fund",
        "other",
      ],
      project_sector: [
        "government",
        "infrastructure",
        "real_estate",
        "prefab",
        "institutional",
      ],
      project_stage: [
        "pursuit",
        "capture",
        "bid",
        "award",
        "mobilization",
        "execution",
        "closeout",
      ],
      project_status: ["active", "on_hold", "won", "lost", "closed"],
      review_state: ["pending", "approved", "rejected"],
      update_source: ["email", "manual_paste", "document", "agent", "procore"],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
