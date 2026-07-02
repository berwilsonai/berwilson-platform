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
          actor_email: string | null
          actor_id: string | null
          actor_type: string | null
          created_at: string | null
          field_changes: Json | null
          id: string
          metadata: Json | null
          project_id: string | null
          record_id: string | null
          site_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string | null
          field_changes?: Json | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
          record_id?: string | null
          site_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_type?: string | null
          created_at?: string | null
          field_changes?: Json | null
          id?: string
          metadata?: Json | null
          project_id?: string | null
          record_id?: string | null
          site_id?: string | null
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
          {
            foreignKeyName: "activity_log_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
          project_id: string | null
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
          project_id?: string | null
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
          project_id?: string | null
          prompt_version?: string | null
          query_text?: string
          rating?: number | null
          response_text?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_queries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      certifications: {
        Row: {
          cert_number: string | null
          created_at: string
          document_id: string | null
          expiration_date: string | null
          id: string
          is_active: boolean
          issued_date: string | null
          issuing_body: string | null
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          cert_number?: string | null
          created_at?: string
          document_id?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          issued_date?: string | null
          issuing_body?: string | null
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          cert_number?: string | null
          created_at?: string
          document_id?: string | null
          expiration_date?: string | null
          id?: string
          is_active?: boolean
          issued_date?: string | null
          issuing_body?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "certifications_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string | null
          document_id: string | null
          embedding: string | null
          entity_id: string | null
          id: string
          is_company: boolean
          party_id: string | null
          project_id: string | null
          site_id: string | null
          token_count: number | null
          update_id: string | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          entity_id?: string | null
          id?: string
          is_company?: boolean
          party_id?: string | null
          project_id?: string | null
          site_id?: string | null
          token_count?: number | null
          update_id?: string | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string | null
          document_id?: string | null
          embedding?: string | null
          entity_id?: string | null
          id?: string
          is_company?: boolean
          party_id?: string | null
          project_id?: string | null
          site_id?: string | null
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
            foreignKeyName: "chunks_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
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
            foreignKeyName: "chunks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
      company_profile: {
        Row: {
          about: string | null
          aggregate_bonding: number | null
          annual_revenue: number | null
          bonding_capacity: number | null
          bonding_company: string | null
          capabilities: string | null
          contract_types: string[]
          dba_name: string | null
          dbe_certified: boolean
          delivery_methods: string[]
          differentiators: string | null
          disqualifiers: string | null
          email: string | null
          founded_year: number | null
          hq_address: string | null
          id: string
          legal_name: string
          logo_url: string | null
          max_project_value: number | null
          mbe_certified: boolean
          min_project_value: number | null
          naics_codes: string[]
          past_performance: string | null
          phone: string | null
          pursuit_notes: string | null
          sbe_certified: boolean
          sic_codes: string[]
          sweet_spot_value: number | null
          target_geographies: string[]
          target_sectors: string[]
          updated_at: string
          wbe_certified: boolean
          website: string | null
        }
        Insert: {
          about?: string | null
          aggregate_bonding?: number | null
          annual_revenue?: number | null
          bonding_capacity?: number | null
          bonding_company?: string | null
          capabilities?: string | null
          contract_types?: string[]
          dba_name?: string | null
          dbe_certified?: boolean
          delivery_methods?: string[]
          differentiators?: string | null
          disqualifiers?: string | null
          email?: string | null
          founded_year?: number | null
          hq_address?: string | null
          id?: string
          legal_name?: string
          logo_url?: string | null
          max_project_value?: number | null
          mbe_certified?: boolean
          min_project_value?: number | null
          naics_codes?: string[]
          past_performance?: string | null
          phone?: string | null
          pursuit_notes?: string | null
          sbe_certified?: boolean
          sic_codes?: string[]
          sweet_spot_value?: number | null
          target_geographies?: string[]
          target_sectors?: string[]
          updated_at?: string
          wbe_certified?: boolean
          website?: string | null
        }
        Update: {
          about?: string | null
          aggregate_bonding?: number | null
          annual_revenue?: number | null
          bonding_capacity?: number | null
          bonding_company?: string | null
          capabilities?: string | null
          contract_types?: string[]
          dba_name?: string | null
          dbe_certified?: boolean
          delivery_methods?: string[]
          differentiators?: string | null
          disqualifiers?: string | null
          email?: string | null
          founded_year?: number | null
          hq_address?: string | null
          id?: string
          legal_name?: string
          logo_url?: string | null
          max_project_value?: number | null
          mbe_certified?: boolean
          min_project_value?: number | null
          naics_codes?: string[]
          past_performance?: string | null
          phone?: string | null
          pursuit_notes?: string | null
          sbe_certified?: boolean
          sic_codes?: string[]
          sweet_spot_value?: number | null
          target_geographies?: string[]
          target_sectors?: string[]
          updated_at?: string
          wbe_certified?: boolean
          website?: string | null
        }
        Relationships: []
      }
      compliance_items: {
        Row: {
          component_id: string | null
          created_at: string | null
          due_date: string | null
          evidence_doc_id: string | null
          framework: string
          id: string
          notes: string | null
          project_id: string | null
          requirement: string
          responsible_party: string | null
          site_id: string | null
          status: Database["public"]["Enums"]["compliance_status"] | null
          updated_at: string | null
        }
        Insert: {
          component_id?: string | null
          created_at?: string | null
          due_date?: string | null
          evidence_doc_id?: string | null
          framework: string
          id?: string
          notes?: string | null
          project_id?: string | null
          requirement: string
          responsible_party?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["compliance_status"] | null
          updated_at?: string | null
        }
        Update: {
          component_id?: string | null
          created_at?: string | null
          due_date?: string | null
          evidence_doc_id?: string | null
          framework?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          requirement?: string
          responsible_party?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["compliance_status"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compliance_items_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "compliance_items_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      components: {
        Row: {
          bw_role: Database["public"]["Enums"]["bw_role"] | null
          capital_high: number | null
          capital_low: number | null
          capital_mid: number | null
          contingency_pct: number | null
          created_at: string
          duration_months: number | null
          end_date: string | null
          id: string
          name: string
          notes: string | null
          phase: string | null
          prime_contractor: string | null
          procore_link: string | null
          project_id: string | null
          site_id: string
          specs: Json | null
          start_date: string | null
          status: Database["public"]["Enums"]["component_status"]
          type: Database["public"]["Enums"]["component_type"]
          updated_at: string
        }
        Insert: {
          bw_role?: Database["public"]["Enums"]["bw_role"] | null
          capital_high?: number | null
          capital_low?: number | null
          capital_mid?: number | null
          contingency_pct?: number | null
          created_at?: string
          duration_months?: number | null
          end_date?: string | null
          id?: string
          name: string
          notes?: string | null
          phase?: string | null
          prime_contractor?: string | null
          procore_link?: string | null
          project_id?: string | null
          site_id: string
          specs?: Json | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["component_status"]
          type: Database["public"]["Enums"]["component_type"]
          updated_at?: string
        }
        Update: {
          bw_role?: Database["public"]["Enums"]["bw_role"] | null
          capital_high?: number | null
          capital_low?: number | null
          capital_mid?: number | null
          contingency_pct?: number | null
          created_at?: string
          duration_months?: number | null
          end_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          phase?: string | null
          prime_contractor?: string | null
          procore_link?: string | null
          project_id?: string | null
          site_id?: string
          specs?: Json | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["component_status"]
          type?: Database["public"]["Enums"]["component_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "components_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_aliases: {
        Row: {
          alias: string
          created_at: string | null
          id: string
          party_id: string
        }
        Insert: {
          alias: string
          created_at?: string | null
          id?: string
          party_id: string
        }
        Update: {
          alias?: string
          created_at?: string | null
          id?: string
          party_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_aliases_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      corridors: {
        Row: {
          brand_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          region: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corridors_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
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
      document_distributions: {
        Row: {
          appendix_f_locked: boolean | null
          created_at: string
          distributed_at: string
          document_id: string
          id: string
          method: string | null
          notes: string | null
          recipient_party_id: string
          version: string | null
        }
        Insert: {
          appendix_f_locked?: boolean | null
          created_at?: string
          distributed_at?: string
          document_id: string
          id?: string
          method?: string | null
          notes?: string | null
          recipient_party_id: string
          version?: string | null
        }
        Update: {
          appendix_f_locked?: boolean | null
          created_at?: string
          distributed_at?: string
          document_id?: string
          id?: string
          method?: string | null
          notes?: string | null
          recipient_party_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_distributions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_distributions_recipient_party_id_fkey"
            columns: ["recipient_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_summary: string | null
          classification: string | null
          component_id: string | null
          confidence: number | null
          doc_type: string | null
          embedding_status: string | null
          entity_id: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          is_company: boolean
          mime_type: string | null
          project_id: string | null
          site_id: string | null
          source: Database["public"]["Enums"]["update_source"] | null
          storage_path: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          ai_summary?: string | null
          classification?: string | null
          component_id?: string | null
          confidence?: number | null
          doc_type?: string | null
          embedding_status?: string | null
          entity_id?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          is_company?: boolean
          mime_type?: string | null
          project_id?: string | null
          site_id?: string | null
          source?: Database["public"]["Enums"]["update_source"] | null
          storage_path: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          ai_summary?: string | null
          classification?: string | null
          component_id?: string | null
          confidence?: number | null
          doc_type?: string | null
          embedding_status?: string | null
          entity_id?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          is_company?: boolean
          mime_type?: string | null
          project_id?: string | null
          site_id?: string | null
          source?: Database["public"]["Enums"]["update_source"] | null
          storage_path?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      dream_quotes: {
        Row: {
          created_at: string | null
          id: string
          quote: string
          sort_order: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          quote: string
          sort_order?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          quote?: string
          sort_order?: number
        }
        Relationships: []
      }
      email_intake_sessions: {
        Row: {
          confirmed_at: string | null
          created_at: string | null
          created_record_ids: Json | null
          extraction_result: Json
          fit_assessment: Json | null
          id: string
          label: string | null
          match_candidates: Json | null
          party_matches: Json | null
          raw_text: string | null
          status: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string | null
          created_record_ids?: Json | null
          extraction_result: Json
          fit_assessment?: Json | null
          id?: string
          label?: string | null
          match_candidates?: Json | null
          party_matches?: Json | null
          raw_text?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string | null
          created_record_ids?: Json | null
          extraction_result?: Json
          fit_assessment?: Json | null
          id?: string
          label?: string | null
          match_candidates?: Json | null
          party_matches?: Json | null
          raw_text?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
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
          category: Database["public"]["Enums"]["entity_category"]
          confidence_score: number | null
          created_at: string | null
          description: string | null
          ein: string | null
          enriched_at: string | null
          enrichment_data: Json | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          formation_date: string | null
          headquarters: string | null
          id: string
          jurisdiction: string | null
          logo_url: string | null
          name: string
          notes: string | null
          ownership_pct: number | null
          parent_entity_id: string | null
          primary_contact_id: string | null
          quality_score: number | null
          specialties: string[] | null
          website_url: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["entity_category"]
          confidence_score?: number | null
          created_at?: string | null
          description?: string | null
          ein?: string | null
          enriched_at?: string | null
          enrichment_data?: Json | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          formation_date?: string | null
          headquarters?: string | null
          id?: string
          jurisdiction?: string | null
          logo_url?: string | null
          name: string
          notes?: string | null
          ownership_pct?: number | null
          parent_entity_id?: string | null
          primary_contact_id?: string | null
          quality_score?: number | null
          specialties?: string[] | null
          website_url?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["entity_category"]
          confidence_score?: number | null
          created_at?: string | null
          description?: string | null
          ein?: string | null
          enriched_at?: string | null
          enrichment_data?: Json | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          formation_date?: string | null
          headquarters?: string | null
          id?: string
          jurisdiction?: string | null
          logo_url?: string | null
          name?: string
          notes?: string | null
          ownership_pct?: number | null
          parent_entity_id?: string | null
          primary_contact_id?: string | null
          quality_score?: number | null
          specialties?: string[] | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_parent_entity_id_fkey"
            columns: ["parent_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entities_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "parties"
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
      entity_reviews: {
        Row: {
          created_at: string | null
          entity_id: string
          id: string
          notes: string | null
          on_budget: boolean | null
          on_time: boolean | null
          project_id: string | null
          rating: number
          reviewed_at: string | null
          reviewed_by: string | null
          would_rehire: boolean | null
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          id?: string
          notes?: string | null
          on_budget?: boolean | null
          on_time?: boolean | null
          project_id?: string | null
          rating: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          would_rehire?: boolean | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          id?: string
          notes?: string | null
          on_budget?: boolean | null
          on_time?: boolean | null
          project_id?: string | null
          rating?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          would_rehire?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_reviews_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      equity_scenarios: {
        Row: {
          cap_table_inputs: Json | null
          created_at: string | null
          description: string | null
          exit_scenario_inputs: Json | null
          id: string
          is_baseline: boolean | null
          name: string
          nancy_deal_inputs: Json | null
          originator_fee_inputs: Json | null
          updated_at: string | null
          user_id: string
          valuation_inputs: Json | null
        }
        Insert: {
          cap_table_inputs?: Json | null
          created_at?: string | null
          description?: string | null
          exit_scenario_inputs?: Json | null
          id?: string
          is_baseline?: boolean | null
          name?: string
          nancy_deal_inputs?: Json | null
          originator_fee_inputs?: Json | null
          updated_at?: string | null
          user_id: string
          valuation_inputs?: Json | null
        }
        Update: {
          cap_table_inputs?: Json | null
          created_at?: string | null
          description?: string | null
          exit_scenario_inputs?: Json | null
          id?: string
          is_baseline?: boolean | null
          name?: string
          nancy_deal_inputs?: Json | null
          originator_fee_inputs?: Json | null
          updated_at?: string | null
          user_id?: string
          valuation_inputs?: Json | null
        }
        Relationships: []
      }
      equity_share_links: {
        Row: {
          accessed_count: number | null
          created_at: string | null
          created_by: string
          expires_at: string
          id: string
          max_accesses: number | null
          modules: string[] | null
          scenario_id: string
          token: string
        }
        Insert: {
          accessed_count?: number | null
          created_at?: string | null
          created_by: string
          expires_at: string
          id?: string
          max_accesses?: number | null
          modules?: string[] | null
          scenario_id: string
          token: string
        }
        Update: {
          accessed_count?: number | null
          created_at?: string | null
          created_by?: string
          expires_at?: string
          id?: string
          max_accesses?: number | null
          modules?: string[] | null
          scenario_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "equity_share_links_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "equity_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      federal_scorecards: {
        Row: {
          created_at: string | null
          dart_rate: number | null
          emr: number | null
          entity_id: string
          evaluation_period_end: string | null
          evaluation_period_start: string | null
          evaluator_name: string | null
          evaluator_title: string | null
          id: string
          ncrs_issued: number | null
          ncrs_resolved: number | null
          overall_rating: number | null
          project_id: string | null
          punch_list_items: number | null
          qm_deficiency_tracking: number | null
          qm_documentation: number | null
          qm_material_compliance: number | null
          qm_notes: string | null
          qm_qc_plan: number | null
          qm_rework_rate: number | null
          qm_submittal_timeliness: number | null
          qm_testing_compliance: number | null
          qm_three_phase_inspection: number | null
          rework_pct: number | null
          sh_accident_prevention_plan: number | null
          sh_activity_hazard_analysis: number | null
          sh_corrective_actions: number | null
          sh_incident_rate: number | null
          sh_notes: string | null
          sh_osha_compliance: number | null
          sh_ppe_compliance: number | null
          sh_safety_training: number | null
          sh_site_inspections: number | null
          standard: string
          trir: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          dart_rate?: number | null
          emr?: number | null
          entity_id: string
          evaluation_period_end?: string | null
          evaluation_period_start?: string | null
          evaluator_name?: string | null
          evaluator_title?: string | null
          id?: string
          ncrs_issued?: number | null
          ncrs_resolved?: number | null
          overall_rating?: number | null
          project_id?: string | null
          punch_list_items?: number | null
          qm_deficiency_tracking?: number | null
          qm_documentation?: number | null
          qm_material_compliance?: number | null
          qm_notes?: string | null
          qm_qc_plan?: number | null
          qm_rework_rate?: number | null
          qm_submittal_timeliness?: number | null
          qm_testing_compliance?: number | null
          qm_three_phase_inspection?: number | null
          rework_pct?: number | null
          sh_accident_prevention_plan?: number | null
          sh_activity_hazard_analysis?: number | null
          sh_corrective_actions?: number | null
          sh_incident_rate?: number | null
          sh_notes?: string | null
          sh_osha_compliance?: number | null
          sh_ppe_compliance?: number | null
          sh_safety_training?: number | null
          sh_site_inspections?: number | null
          standard: string
          trir?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          dart_rate?: number | null
          emr?: number | null
          entity_id?: string
          evaluation_period_end?: string | null
          evaluation_period_start?: string | null
          evaluator_name?: string | null
          evaluator_title?: string | null
          id?: string
          ncrs_issued?: number | null
          ncrs_resolved?: number | null
          overall_rating?: number | null
          project_id?: string | null
          punch_list_items?: number | null
          qm_deficiency_tracking?: number | null
          qm_documentation?: number | null
          qm_material_compliance?: number | null
          qm_notes?: string | null
          qm_qc_plan?: number | null
          qm_rework_rate?: number | null
          qm_submittal_timeliness?: number | null
          qm_testing_compliance?: number | null
          qm_three_phase_inspection?: number | null
          rework_pct?: number | null
          sh_accident_prevention_plan?: number | null
          sh_activity_hazard_analysis?: number | null
          sh_corrective_actions?: number | null
          sh_incident_rate?: number | null
          sh_notes?: string | null
          sh_osha_compliance?: number | null
          sh_ppe_compliance?: number | null
          sh_safety_training?: number | null
          sh_site_inspections?: number | null
          standard?: string
          trir?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "federal_scorecards_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "federal_scorecards_project_id_fkey"
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
      funding_sources: {
        Row: {
          agency: string | null
          amount: number | null
          category: Database["public"]["Enums"]["funding_category"]
          component_id: string | null
          conditions: string | null
          contact_party_id: string | null
          created_at: string
          drawdown_notes: string | null
          id: string
          notes: string | null
          percent_of_stack: number | null
          site_id: string | null
          source_name: string
          status: Database["public"]["Enums"]["funding_status"]
          updated_at: string
        }
        Insert: {
          agency?: string | null
          amount?: number | null
          category: Database["public"]["Enums"]["funding_category"]
          component_id?: string | null
          conditions?: string | null
          contact_party_id?: string | null
          created_at?: string
          drawdown_notes?: string | null
          id?: string
          notes?: string | null
          percent_of_stack?: number | null
          site_id?: string | null
          source_name: string
          status?: Database["public"]["Enums"]["funding_status"]
          updated_at?: string
        }
        Update: {
          agency?: string | null
          amount?: number | null
          category?: Database["public"]["Enums"]["funding_category"]
          component_id?: string | null
          conditions?: string | null
          contact_party_id?: string | null
          created_at?: string
          drawdown_notes?: string | null
          id?: string
          notes?: string | null
          percent_of_stack?: number | null
          site_id?: string | null
          source_name?: string
          status?: Database["public"]["Enums"]["funding_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "funding_sources_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_sources_contact_party_id_fkey"
            columns: ["contact_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "funding_sources_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
      media: {
        Row: {
          caption: string | null
          created_at: string
          entity_id: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          is_company: boolean
          is_primary: boolean
          mime_type: string
          party_id: string | null
          project_id: string | null
          sort_order: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          entity_id?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          is_company?: boolean
          is_primary?: boolean
          mime_type: string
          party_id?: string | null
          project_id?: string | null
          sort_order?: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          entity_id?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          is_company?: boolean
          is_primary?: boolean
          mime_type?: string
          party_id?: string | null
          project_id?: string | null
          sort_order?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
          status: string
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
          status?: string
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
          status?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      party_entities: {
        Row: {
          created_at: string | null
          entity_id: string
          id: string
          is_primary: boolean | null
          party_id: string
          role: string | null
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          id?: string
          is_primary?: boolean | null
          party_id: string
          role?: string | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          id?: string
          is_primary?: boolean | null
          party_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "party_entities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_entities_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_briefs: {
        Row: {
          brief_type: string
          content: string
          created_at: string
          generated_by: string
          id: string
          model_used: string | null
          project_id: string | null
        }
        Insert: {
          brief_type: string
          content: string
          created_at?: string
          generated_by?: string
          id?: string
          model_used?: string | null
          project_id?: string | null
        }
        Update: {
          brief_type?: string
          content?: string
          created_at?: string
          generated_by?: string
          id?: string
          model_used?: string | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_briefs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_emails: {
        Row: {
          email_address: string
          graph_message_id: string
          id: string
          internet_message_id: string
          outlook_web_link: string | null
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
          outlook_web_link?: string | null
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
          outlook_web_link?: string | null
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
      project_dependencies: {
        Row: {
          created_at: string
          dependency_type: string
          description: string | null
          downstream_project_id: string
          id: string
          resolved_at: string | null
          severity: string
          status: string
          updated_at: string
          upstream_project_id: string
        }
        Insert: {
          created_at?: string
          dependency_type?: string
          description?: string | null
          downstream_project_id: string
          id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          updated_at?: string
          upstream_project_id: string
        }
        Update: {
          created_at?: string
          dependency_type?: string
          description?: string | null
          downstream_project_id?: string
          id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          updated_at?: string
          upstream_project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_dependencies_downstream_project_id_fkey"
            columns: ["downstream_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_dependencies_upstream_project_id_fkey"
            columns: ["upstream_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          applicable_standards: Json | null
          award_date: string | null
          bid_decision: string
          bid_due_date: string | null
          capture_lead: string | null
          client_entity: string | null
          competitors: Json
          contract_type: string | null
          created_at: string | null
          delivery_method: string | null
          description: string | null
          estimated_value: number | null
          id: string
          incumbent: string | null
          location: string | null
          name: string
          ntp_date: string | null
          parent_project_id: string | null
          sector: Database["public"]["Enums"]["project_sector"]
          solicitation_number: string | null
          stage: Database["public"]["Enums"]["project_stage"] | null
          status: Database["public"]["Enums"]["project_status"] | null
          substantial_completion_date: string | null
          updated_at: string | null
          win_probability: number | null
          win_strategy: string | null
        }
        Insert: {
          applicable_standards?: Json | null
          award_date?: string | null
          bid_decision?: string
          bid_due_date?: string | null
          capture_lead?: string | null
          client_entity?: string | null
          competitors?: Json
          contract_type?: string | null
          created_at?: string | null
          delivery_method?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          incumbent?: string | null
          location?: string | null
          name: string
          ntp_date?: string | null
          parent_project_id?: string | null
          sector: Database["public"]["Enums"]["project_sector"]
          solicitation_number?: string | null
          stage?: Database["public"]["Enums"]["project_stage"] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          substantial_completion_date?: string | null
          updated_at?: string | null
          win_probability?: number | null
          win_strategy?: string | null
        }
        Update: {
          applicable_standards?: Json | null
          award_date?: string | null
          bid_decision?: string
          bid_due_date?: string | null
          capture_lead?: string | null
          client_entity?: string | null
          competitors?: Json
          contract_type?: string | null
          created_at?: string | null
          delivery_method?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          incumbent?: string | null
          location?: string | null
          name?: string
          ntp_date?: string | null
          parent_project_id?: string | null
          sector?: Database["public"]["Enums"]["project_sector"]
          solicitation_number?: string | null
          stage?: Database["public"]["Enums"]["project_stage"] | null
          status?: Database["public"]["Enums"]["project_status"] | null
          substantial_completion_date?: string | null
          updated_at?: string | null
          win_probability?: number | null
          win_strategy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_parent_project_id_fkey"
            columns: ["parent_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_intake_sessions: {
        Row: {
          confirmed_action: string | null
          confirmed_at: string | null
          confirmed_project_id: string | null
          created_at: string | null
          expires_at: string | null
          extraction_result: Json
          id: string
          match_candidates: Json | null
          status: string
          uploaded_files: Json
          user_id: string
        }
        Insert: {
          confirmed_action?: string | null
          confirmed_at?: string | null
          confirmed_project_id?: string | null
          created_at?: string | null
          expires_at?: string | null
          extraction_result: Json
          id?: string
          match_candidates?: Json | null
          status?: string
          uploaded_files: Json
          user_id: string
        }
        Update: {
          confirmed_action?: string | null
          confirmed_at?: string | null
          confirmed_project_id?: string | null
          created_at?: string | null
          expires_at?: string | null
          extraction_result?: Json
          id?: string
          match_candidates?: Json | null
          status?: string
          uploaded_files?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_intake_sessions_confirmed_project_id_fkey"
            columns: ["confirmed_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rail_branches: {
        Row: {
          brand_name: string | null
          corridor_id: string | null
          created_at: string
          designation: string | null
          id: string
          military_connections: string | null
          notes: string | null
          rail_type: Database["public"]["Enums"]["rail_type"] | null
          route_description: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          brand_name?: string | null
          corridor_id?: string | null
          created_at?: string
          designation?: string | null
          id?: string
          military_connections?: string | null
          notes?: string | null
          rail_type?: Database["public"]["Enums"]["rail_type"] | null
          route_description?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          brand_name?: string | null
          corridor_id?: string | null
          created_at?: string
          designation?: string | null
          id?: string
          military_connections?: string | null
          notes?: string | null
          rail_type?: Database["public"]["Enums"]["rail_type"] | null
          route_description?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rail_branches_corridor_id_fkey"
            columns: ["corridor_id"]
            isOneToOne: false
            referencedRelation: "corridors"
            referencedColumns: ["id"]
          },
        ]
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
      revenue_share_agreements: {
        Row: {
          bw_pct: number | null
          cadence: string | null
          city_pct: number | null
          created_at: string
          governance_notes: string | null
          id: string
          notes: string | null
          revenue_base: string | null
          site_id: string
          sunset_date: string | null
          updated_at: string
        }
        Insert: {
          bw_pct?: number | null
          cadence?: string | null
          city_pct?: number | null
          created_at?: string
          governance_notes?: string | null
          id?: string
          notes?: string | null
          revenue_base?: string | null
          site_id: string
          sunset_date?: string | null
          updated_at?: string
        }
        Update: {
          bw_pct?: number | null
          cadence?: string | null
          city_pct?: number | null
          created_at?: string
          governance_notes?: string | null
          id?: string
          notes?: string | null
          revenue_base?: string | null
          site_id?: string
          sunset_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_share_agreements_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: true
            referencedRelation: "sites"
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
      risk_scores: {
        Row: {
          breakdown: Json
          computed_at: string
          id: string
          project_id: string
          score: number
        }
        Insert: {
          breakdown?: Json
          computed_at?: string
          id?: string
          project_id: string
          score: number
        }
        Update: {
          breakdown?: Json
          computed_at?: string
          id?: string
          project_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_scores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_dependencies: {
        Row: {
          created_at: string
          dependency_type: string
          description: string | null
          id: string
          source_site_id: string
          target_site_id: string
        }
        Insert: {
          created_at?: string
          dependency_type: string
          description?: string | null
          id?: string
          source_site_id: string
          target_site_id: string
        }
        Update: {
          created_at?: string
          dependency_type?: string
          description?: string | null
          id?: string
          source_site_id?: string
          target_site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_dependencies_source_site_id_fkey"
            columns: ["source_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_dependencies_target_site_id_fkey"
            columns: ["target_site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          acreage: number | null
          anchor_partner: string | null
          bw_role: Database["public"]["Enums"]["bw_role"] | null
          city: string | null
          corridor_id: string | null
          county: string | null
          created_at: string
          id: string
          is_lead_site: boolean
          military_installations: string[] | null
          military_nexus: string | null
          name: string
          notes: string | null
          procore_link: string | null
          site_number: number | null
          state: string | null
          status: Database["public"]["Enums"]["site_status"]
          stracnet_status: string | null
          updated_at: string
        }
        Insert: {
          acreage?: number | null
          anchor_partner?: string | null
          bw_role?: Database["public"]["Enums"]["bw_role"] | null
          city?: string | null
          corridor_id?: string | null
          county?: string | null
          created_at?: string
          id?: string
          is_lead_site?: boolean
          military_installations?: string[] | null
          military_nexus?: string | null
          name: string
          notes?: string | null
          procore_link?: string | null
          site_number?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["site_status"]
          stracnet_status?: string | null
          updated_at?: string
        }
        Update: {
          acreage?: number | null
          anchor_partner?: string | null
          bw_role?: Database["public"]["Enums"]["bw_role"] | null
          city?: string | null
          corridor_id?: string | null
          county?: string | null
          created_at?: string
          id?: string
          is_lead_site?: boolean
          military_installations?: string[] | null
          military_nexus?: string | null
          name?: string
          notes?: string | null
          procore_link?: string | null
          site_number?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["site_status"]
          stracnet_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_corridor_id_fkey"
            columns: ["corridor_id"]
            isOneToOne: false
            referencedRelation: "corridors"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_interactions: {
        Row: {
          created_at: string
          follow_up: string | null
          id: string
          interaction_date: string
          logged_by: string | null
          medium: string | null
          relationship_id: string
          summary: string
        }
        Insert: {
          created_at?: string
          follow_up?: string | null
          id?: string
          interaction_date?: string
          logged_by?: string | null
          medium?: string | null
          relationship_id: string
          summary: string
        }
        Update: {
          created_at?: string
          follow_up?: string | null
          id?: string
          interaction_date?: string
          logged_by?: string | null
          medium?: string | null
          relationship_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_interactions_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "stakeholder_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_relationships: {
        Row: {
          created_at: string
          id: string
          next_scheduled: string | null
          notes: string | null
          party_id: string
          role: string | null
          site_id: string
          temperature: Database["public"]["Enums"]["stakeholder_temperature"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          next_scheduled?: string | null
          notes?: string | null
          party_id: string
          role?: string | null
          site_id: string
          temperature?: Database["public"]["Enums"]["stakeholder_temperature"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          next_scheduled?: string | null
          notes?: string | null
          party_id?: string
          role?: string | null
          site_id?: string
          temperature?: Database["public"]["Enums"]["stakeholder_temperature"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_relationships_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_relationships_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      stored_briefs: {
        Row: {
          brief_type: string
          content: string
          created_at: string
          id: string
          latency_ms: number | null
          metadata: Json | null
          model_used: string | null
          project_id: string | null
          title: string
        }
        Insert: {
          brief_type?: string
          content: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          model_used?: string | null
          project_id?: string | null
          title: string
        }
        Update: {
          brief_type?: string
          content?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          metadata?: Json | null
          model_used?: string | null
          project_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "stored_briefs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_engagements: {
        Row: {
          apprenticeship_pct: number | null
          bonding_limit: number | null
          cba_local_hire: boolean | null
          company: string
          component_id: string
          contact_email: string | null
          contact_name: string | null
          created_at: string
          engagement_state: Database["public"]["Enums"]["engagement_state"]
          federal_prequals: string[] | null
          id: string
          insurance_verified: boolean | null
          mwbe_dbe_status: string | null
          notes: string | null
          party_id: string | null
          prevailing_wage: boolean | null
          scope_description: string | null
          trade_tags: string[] | null
          updated_at: string
          value: number | null
        }
        Insert: {
          apprenticeship_pct?: number | null
          bonding_limit?: number | null
          cba_local_hire?: boolean | null
          company: string
          component_id: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          engagement_state?: Database["public"]["Enums"]["engagement_state"]
          federal_prequals?: string[] | null
          id?: string
          insurance_verified?: boolean | null
          mwbe_dbe_status?: string | null
          notes?: string | null
          party_id?: string | null
          prevailing_wage?: boolean | null
          scope_description?: string | null
          trade_tags?: string[] | null
          updated_at?: string
          value?: number | null
        }
        Update: {
          apprenticeship_pct?: number | null
          bonding_limit?: number | null
          cba_local_hire?: boolean | null
          company?: string
          component_id?: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          engagement_state?: Database["public"]["Enums"]["engagement_state"]
          federal_prequals?: string[] | null
          id?: string
          insurance_verified?: boolean | null
          mwbe_dbe_status?: string | null
          notes?: string | null
          party_id?: string | null
          prevailing_wage?: boolean | null
          scope_description?: string | null
          trade_tags?: string[] | null
          updated_at?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_engagements_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_engagements_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          counterparty: string | null
          created_at: string | null
          deal_structure: string | null
          description: string | null
          estimated_value: number | null
          id: string
          identified_date: string | null
          lead: string | null
          location: string | null
          name: string
          next_step: string | null
          objective: string | null
          opp_type: string
          ownership_stake: number | null
          priority: string | null
          probability: number | null
          sector: string | null
          source: string | null
          status: string
          target_close_date: string | null
          target_name: string | null
          thesis: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          counterparty?: string | null
          created_at?: string | null
          deal_structure?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          identified_date?: string | null
          lead?: string | null
          location?: string | null
          name: string
          next_step?: string | null
          objective?: string | null
          opp_type?: string
          ownership_stake?: number | null
          priority?: string | null
          probability?: number | null
          sector?: string | null
          source?: string | null
          status?: string
          target_close_date?: string | null
          target_name?: string | null
          thesis?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          counterparty?: string | null
          created_at?: string | null
          deal_structure?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          identified_date?: string | null
          lead?: string | null
          location?: string | null
          name?: string
          next_step?: string | null
          objective?: string | null
          opp_type?: string
          ownership_stake?: number | null
          priority?: string | null
          probability?: number | null
          sector?: string | null
          source?: string | null
          status?: string
          target_close_date?: string | null
          target_name?: string | null
          thesis?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      opportunity_documents: {
        Row: {
          ai_summary: string | null
          doc_type: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          opportunity_id: string
          storage_path: string
          uploaded_at: string | null
        }
        Insert: {
          ai_summary?: string | null
          doc_type?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          opportunity_id: string
          storage_path: string
          uploaded_at?: string | null
        }
        Update: {
          ai_summary?: string | null
          doc_type?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          opportunity_id?: string
          storage_path?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_documents_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_notes: {
        Row: {
          author: string | null
          body: string
          created_at: string | null
          id: string
          opportunity_id: string
        }
        Insert: {
          author?: string | null
          body: string
          created_at?: string | null
          id?: string
          opportunity_id: string
        }
        Update: {
          author?: string | null
          body?: string
          created_at?: string | null
          id?: string
          opportunity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_notes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notes: {
        Row: {
          author: string | null
          body: string
          created_at: string | null
          id: string
          task_id: string
        }
        Insert: {
          author?: string | null
          body: string
          created_at?: string | null
          id?: string
          task_id: string
        }
        Update: {
          author?: string | null
          body?: string
          created_at?: string | null
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_notes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          how: string | null
          id: string
          opportunity_id: string | null
          project_id: string | null
          status: string
          title: string
          updated_at: string | null
          what: string | null
          why: string | null
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          how?: string | null
          id?: string
          opportunity_id?: string | null
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string | null
          what?: string | null
          why?: string | null
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          how?: string | null
          id?: string
          opportunity_id?: string | null
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string | null
          what?: string | null
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          active: boolean
          color: string | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      trade_secrets: {
        Row: {
          classification: string | null
          code: string
          description: string | null
          title: string
        }
        Insert: {
          classification?: string | null
          code: string
          description?: string | null
          title: string
        }
        Update: {
          classification?: string | null
          code?: string
          description?: string | null
          title?: string
        }
        Relationships: []
      }
      ts_exposure_items: {
        Row: {
          created_at: string
          document_id: string
          exposure_level: string | null
          id: string
          notes: string | null
          ts_code: string
        }
        Insert: {
          created_at?: string
          document_id: string
          exposure_level?: string | null
          id?: string
          notes?: string | null
          ts_code: string
        }
        Update: {
          created_at?: string
          document_id?: string
          exposure_level?: string | null
          id?: string
          notes?: string | null
          ts_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "ts_exposure_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ts_exposure_items_ts_code_fkey"
            columns: ["ts_code"]
            isOneToOne: false
            referencedRelation: "trade_secrets"
            referencedColumns: ["code"]
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
          mentioned_projects: Json
          outlook_web_link: string | null
          project_id: string | null
          raw_content: string | null
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
          mentioned_projects?: Json
          outlook_web_link?: string | null
          project_id?: string | null
          raw_content?: string | null
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
          mentioned_projects?: Json
          outlook_web_link?: string | null
          project_id?: string | null
          raw_content?: string | null
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
          filter_after?: string
          filter_entity_ids?: string[]
          filter_include_company?: boolean
          filter_project_ids?: string[]
          match_count?: number
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          entity_id: string
          id: string
          is_company: boolean
          party_id: string
          project_id: string
          similarity: number
          source_confidence: number
          token_count: number
          update_id: string
        }[]
      }
      match_parties_by_name: {
        Args: { search_name: string; threshold?: number }
        Returns: {
          full_name: string
          id: string
          similarity: number
        }[]
      }
      match_projects_by_name: {
        Args: { search_name: string; threshold?: number }
        Returns: {
          id: string
          name: string
          similarity: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      wipe_all_data: { Args: never; Returns: undefined }
    }
    Enums: {
      bw_role:
        | "master_developer_gc"
        | "developer_only"
        | "gc_only"
        | "cm_under_sna"
        | "program_architect"
        | "joint_venture"
      compliance_status:
        | "not_started"
        | "in_progress"
        | "compliant"
        | "non_compliant"
        | "waived"
      component_status:
        | "conceptual"
        | "planning"
        | "pre_development"
        | "design"
        | "procurement"
        | "construction"
        | "commissioning"
        | "operating"
      component_type:
        | "quantum_data_center"
        | "power_nexus"
        | "hospital"
        | "workforce_housing"
        | "light_rail"
        | "freight_rail"
        | "civic_center"
        | "police_station"
        | "fire_station"
        | "airport"
        | "public_safety_complex"
        | "urban_forestry"
        | "cooling_infrastructure"
        | "other"
      dd_severity: "info" | "watch" | "critical" | "blocker"
      engagement_state:
        | "solicited"
        | "bidding"
        | "awarded"
        | "mobilized"
        | "active"
        | "demobilized"
        | "complete"
      entity_category: "vendor" | "partner" | "contractor"
      entity_type:
        | "llc"
        | "corp"
        | "jv"
        | "subsidiary"
        | "trust"
        | "fund"
        | "other"
      funding_category:
        | "federal_grant"
        | "state_grant"
        | "local"
        | "private_equity"
        | "debt"
        | "ppa"
        | "tax_credit"
        | "revenue_share"
      funding_status:
        | "target"
        | "outreach"
        | "application_submitted"
        | "awarded"
        | "closed"
        | "drawn"
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
      rail_type:
        | "passenger"
        | "freight"
        | "stracnet_freight"
        | "passenger_freight"
      review_state: "pending" | "approved" | "rejected"
      site_status: "active" | "planning" | "evaluation" | "lead_site"
      stakeholder_temperature:
        | "champion"
        | "supportive"
        | "neutral"
        | "concerned"
        | "opposed"
        | "unknown"
      update_source:
        | "email"
        | "manual_paste"
        | "document"
        | "agent"
        | "procore"
        | "manual_task"
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
      bw_role: [
        "master_developer_gc",
        "developer_only",
        "gc_only",
        "cm_under_sna",
        "program_architect",
        "joint_venture",
      ],
      compliance_status: [
        "not_started",
        "in_progress",
        "compliant",
        "non_compliant",
        "waived",
      ],
      component_status: [
        "conceptual",
        "planning",
        "pre_development",
        "design",
        "procurement",
        "construction",
        "commissioning",
        "operating",
      ],
      component_type: [
        "quantum_data_center",
        "power_nexus",
        "hospital",
        "workforce_housing",
        "light_rail",
        "freight_rail",
        "civic_center",
        "police_station",
        "fire_station",
        "airport",
        "public_safety_complex",
        "urban_forestry",
        "cooling_infrastructure",
        "other",
      ],
      dd_severity: ["info", "watch", "critical", "blocker"],
      engagement_state: [
        "solicited",
        "bidding",
        "awarded",
        "mobilized",
        "active",
        "demobilized",
        "complete",
      ],
      entity_category: ["vendor", "partner", "contractor"],
      entity_type: [
        "llc",
        "corp",
        "jv",
        "subsidiary",
        "trust",
        "fund",
        "other",
      ],
      funding_category: [
        "federal_grant",
        "state_grant",
        "local",
        "private_equity",
        "debt",
        "ppa",
        "tax_credit",
        "revenue_share",
      ],
      funding_status: [
        "target",
        "outreach",
        "application_submitted",
        "awarded",
        "closed",
        "drawn",
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
      rail_type: [
        "passenger",
        "freight",
        "stracnet_freight",
        "passenger_freight",
      ],
      review_state: ["pending", "approved", "rejected"],
      site_status: ["active", "planning", "evaluation", "lead_site"],
      stakeholder_temperature: [
        "champion",
        "supportive",
        "neutral",
        "concerned",
        "opposed",
        "unknown",
      ],
      update_source: [
        "email",
        "manual_paste",
        "document",
        "agent",
        "procore",
        "manual_task",
      ],
    },
  },
  storage: {
    Enums: {
      buckettype: ["STANDARD", "ANALYTICS", "VECTOR"],
    },
  },
} as const
