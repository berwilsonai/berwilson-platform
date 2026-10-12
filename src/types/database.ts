
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "_bw_task_backfill_20260926": {
                  Row: {
                    "id": string | null,"title": string | null,"why": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string | null,"title"?: string | null,"why"?: string | null
                  }
                  Update: {
                    "id"?: string | null,"title"?: string | null,"why"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"_score_snapshot_20260826": {
                  Row: {
                    "fit_recommendation": string | null,"fit_score": number | null,"id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "fit_recommendation"?: string | null,"fit_score"?: number | null,"id"?: string | null
                  }
                  Update: {
                    "fit_recommendation"?: string | null,"fit_score"?: number | null,"id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"_score_snapshot_doc": {
                  Row: {
                    "fit_recommendation": string | null,"fit_score": number | null,"id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "fit_recommendation"?: string | null,"fit_score"?: number | null,"id"?: string | null
                  }
                  Update: {
                    "fit_recommendation"?: string | null,"fit_score"?: number | null,"id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"access_grants": {
                  Row: {
                    "created_at": string | null,"id": string,"resource_id": string,"resource_type": string,"team_member_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"id"?: string,"resource_id": string,"resource_type": string,"team_member_id": string
                  }
                  Update: {
                    "created_at"?: string | null,"id"?: string,"resource_id"?: string,"resource_type"?: string,"team_member_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "access_grants_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_log": {
                  Row: {
                    "action": string,"actor_email": string | null,"actor_id": string | null,"actor_type": string | null,"created_at": string | null,"field_changes": Json | null,"id": string,"metadata": Json | null,"project_id": string | null,"record_id": string | null,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_email"?: string | null,"actor_id"?: string | null,"actor_type"?: string | null,"created_at"?: string | null,"field_changes"?: Json | null,"id"?: string,"metadata"?: Json | null,"project_id"?: string | null,"record_id"?: string | null,"table_name": string
                  }
                  Update: {
                    "action"?: string,"actor_email"?: string | null,"actor_id"?: string | null,"actor_type"?: string | null,"created_at"?: string | null,"field_changes"?: Json | null,"id"?: string,"metadata"?: Json | null,"project_id"?: string | null,"record_id"?: string | null,"table_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_log_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_conversations": {
                  Row: {
                    "created_at": string | null,"document_id": string | null,"id": string,"opportunity_id": string | null,"project_id": string | null,"title": string | null,"updated_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"document_id"?: string | null,"id"?: string,"opportunity_id"?: string | null,"project_id"?: string | null,"title"?: string | null,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string | null,"document_id"?: string | null,"id"?: string,"opportunity_id"?: string | null,"project_id"?: string | null,"title"?: string | null,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_conversations_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_conversations_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_conversations_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_messages": {
                  Row: {
                    "content": string,"conversation_id": string,"created_at": string | null,"id": string,"latency_ms": number | null,"model_used": string | null,"rating": number | null,"role": string,"tokens_in": number | null,"tokens_out": number | null,"tool_calls": Json | null,"tool_results": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"conversation_id": string,"created_at"?: string | null,"id"?: string,"latency_ms"?: number | null,"model_used"?: string | null,"rating"?: number | null,"role": string,"tokens_in"?: number | null,"tokens_out"?: number | null,"tool_calls"?: Json | null,"tool_results"?: Json | null
                  }
                  Update: {
                    "content"?: string,"conversation_id"?: string,"created_at"?: string | null,"id"?: string,"latency_ms"?: number | null,"model_used"?: string | null,"rating"?: number | null,"role"?: string,"tokens_in"?: number | null,"tokens_out"?: number | null,"tool_calls"?: Json | null,"tool_results"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "agent_conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_queries": {
                  Row: {
                    "cited_records": Json | null,"created_at": string | null,"id": string,"latency_ms": number | null,"model_used": string,"project_id": string | null,"prompt_version": string | null,"query_text": string,"rating": number | null,"response_text": string,"tokens_in": number | null,"tokens_out": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cited_records"?: Json | null,"created_at"?: string | null,"id"?: string,"latency_ms"?: number | null,"model_used": string,"project_id"?: string | null,"prompt_version"?: string | null,"query_text": string,"rating"?: number | null,"response_text": string,"tokens_in"?: number | null,"tokens_out"?: number | null,"user_id": string
                  }
                  Update: {
                    "cited_records"?: Json | null,"created_at"?: string | null,"id"?: string,"latency_ms"?: number | null,"model_used"?: string,"project_id"?: string | null,"prompt_version"?: string | null,"query_text"?: string,"rating"?: number | null,"response_text"?: string,"tokens_in"?: number | null,"tokens_out"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_queries_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"certifications": {
                  Row: {
                    "cert_number": string | null,"created_at": string,"document_id": string | null,"expiration_date": string | null,"id": string,"is_active": boolean,"issued_date": string | null,"issuing_body": string | null,"name": string,"notes": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cert_number"?: string | null,"created_at"?: string,"document_id"?: string | null,"expiration_date"?: string | null,"id"?: string,"is_active"?: boolean,"issued_date"?: string | null,"issuing_body"?: string | null,"name": string,"notes"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "cert_number"?: string | null,"created_at"?: string,"document_id"?: string | null,"expiration_date"?: string | null,"id"?: string,"is_active"?: boolean,"issued_date"?: string | null,"issuing_body"?: string | null,"name"?: string,"notes"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "certifications_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"chunks": {
                  Row: {
                    "chunk_index": number,"content": string,"created_at": string | null,"document_id": string | null,"embedding": string | null,"entity_id": string | null,"id": string,"investor_id": string | null,"is_company": boolean,"opportunity_document_id": string | null,"opportunity_id": string | null,"party_id": string | null,"project_id": string | null,"source_type": string | null,"token_count": number | null,"update_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "chunk_index": number,"content": string,"created_at"?: string | null,"document_id"?: string | null,"embedding"?: string | null,"entity_id"?: string | null,"id"?: string,"investor_id"?: string | null,"is_company"?: boolean,"opportunity_document_id"?: string | null,"opportunity_id"?: string | null,"party_id"?: string | null,"project_id"?: string | null,"source_type"?: string | null,"token_count"?: number | null,"update_id"?: string | null
                  }
                  Update: {
                    "chunk_index"?: number,"content"?: string,"created_at"?: string | null,"document_id"?: string | null,"embedding"?: string | null,"entity_id"?: string | null,"id"?: string,"investor_id"?: string | null,"is_company"?: boolean,"opportunity_document_id"?: string | null,"opportunity_id"?: string | null,"party_id"?: string | null,"project_id"?: string | null,"source_type"?: string | null,"token_count"?: number | null,"update_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "chunks_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_entity_id_fkey"
      columns: ["entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_investor_id_fkey"
      columns: ["investor_id"]
isOneToOne: false
      referencedRelation: "investors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_opportunity_document_id_fkey"
      columns: ["opportunity_document_id"]
isOneToOne: false
      referencedRelation: "opportunity_documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_update_id_fkey"
      columns: ["update_id"]
isOneToOne: false
      referencedRelation: "updates"
      referencedColumns: ["id"]
    }
                  ]
                },"commitment_action_tokens": {
                  Row: {
                    "commitment_id": string,"created_at": string,"expires_at": string,"id": string,"team_member_id": string | null,"token_hash": string,"used_action": string | null,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "commitment_id": string,"created_at"?: string,"expires_at": string,"id"?: string,"team_member_id"?: string | null,"token_hash": string,"used_action"?: string | null,"used_at"?: string | null
                  }
                  Update: {
                    "commitment_id"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"team_member_id"?: string | null,"token_hash"?: string,"used_action"?: string | null,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "commitment_action_tokens_commitment_id_fkey"
      columns: ["commitment_id"]
isOneToOne: false
      referencedRelation: "commitments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitment_action_tokens_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"commitments": {
                  Row: {
                    "chase_draft_id": string | null,"chase_drafted_at": string | null,"chase_mailbox": string | null,"chase_text": string | null,"confidence": number | null,"created_at": string,"due_date": string | null,"id": string,"item_key": string,"opportunity_id": string | null,"owner_name": string | null,"project_id": string | null,"settled_at": string | null,"settled_by": string | null,"side": string,"snoozed_until": string | null,"status": string,"thread_id": string,"updated_at": string | null,"what": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chase_draft_id"?: string | null,"chase_drafted_at"?: string | null,"chase_mailbox"?: string | null,"chase_text"?: string | null,"confidence"?: number | null,"created_at"?: string,"due_date"?: string | null,"id"?: string,"item_key": string,"opportunity_id"?: string | null,"owner_name"?: string | null,"project_id"?: string | null,"settled_at"?: string | null,"settled_by"?: string | null,"side": string,"snoozed_until"?: string | null,"status"?: string,"thread_id": string,"updated_at"?: string | null,"what": string
                  }
                  Update: {
                    "chase_draft_id"?: string | null,"chase_drafted_at"?: string | null,"chase_mailbox"?: string | null,"chase_text"?: string | null,"confidence"?: number | null,"created_at"?: string,"due_date"?: string | null,"id"?: string,"item_key"?: string,"opportunity_id"?: string | null,"owner_name"?: string | null,"project_id"?: string | null,"settled_at"?: string | null,"settled_by"?: string | null,"side"?: string,"snoozed_until"?: string | null,"status"?: string,"thread_id"?: string,"updated_at"?: string | null,"what"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "commitments_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commitments_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "email_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"company_profile": {
                  Row: {
                    "about": string | null,"aggregate_bonding": number | null,"annual_revenue": number | null,"bonding_capacity": number | null,"bonding_company": string | null,"capabilities": string | null,"contract_types": (string)[],"dba_name": string | null,"dbe_certified": boolean,"delivery_methods": (string)[],"differentiators": string | null,"disqualifiers": string | null,"email": string | null,"founded_year": number | null,"hq_address": string | null,"id": string,"legal_name": string,"logo_url": string | null,"max_project_value": number | null,"mbe_certified": boolean,"min_project_value": number | null,"naics_codes": (string)[],"past_performance": string | null,"phone": string | null,"pursuit_notes": string | null,"sbe_certified": boolean,"sic_codes": (string)[],"sweet_spot_value": number | null,"target_geographies": (string)[],"target_sectors": (string)[],"updated_at": string,"wbe_certified": boolean,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "about"?: string | null,"aggregate_bonding"?: number | null,"annual_revenue"?: number | null,"bonding_capacity"?: number | null,"bonding_company"?: string | null,"capabilities"?: string | null,"contract_types"?: (string)[],"dba_name"?: string | null,"dbe_certified"?: boolean,"delivery_methods"?: (string)[],"differentiators"?: string | null,"disqualifiers"?: string | null,"email"?: string | null,"founded_year"?: number | null,"hq_address"?: string | null,"id"?: string,"legal_name"?: string,"logo_url"?: string | null,"max_project_value"?: number | null,"mbe_certified"?: boolean,"min_project_value"?: number | null,"naics_codes"?: (string)[],"past_performance"?: string | null,"phone"?: string | null,"pursuit_notes"?: string | null,"sbe_certified"?: boolean,"sic_codes"?: (string)[],"sweet_spot_value"?: number | null,"target_geographies"?: (string)[],"target_sectors"?: (string)[],"updated_at"?: string,"wbe_certified"?: boolean,"website"?: string | null
                  }
                  Update: {
                    "about"?: string | null,"aggregate_bonding"?: number | null,"annual_revenue"?: number | null,"bonding_capacity"?: number | null,"bonding_company"?: string | null,"capabilities"?: string | null,"contract_types"?: (string)[],"dba_name"?: string | null,"dbe_certified"?: boolean,"delivery_methods"?: (string)[],"differentiators"?: string | null,"disqualifiers"?: string | null,"email"?: string | null,"founded_year"?: number | null,"hq_address"?: string | null,"id"?: string,"legal_name"?: string,"logo_url"?: string | null,"max_project_value"?: number | null,"mbe_certified"?: boolean,"min_project_value"?: number | null,"naics_codes"?: (string)[],"past_performance"?: string | null,"phone"?: string | null,"pursuit_notes"?: string | null,"sbe_certified"?: boolean,"sic_codes"?: (string)[],"sweet_spot_value"?: number | null,"target_geographies"?: (string)[],"target_sectors"?: (string)[],"updated_at"?: string,"wbe_certified"?: boolean,"website"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"compliance_items": {
                  Row: {
                    "created_at": string | null,"due_date": string | null,"evidence_doc_id": string | null,"framework": string,"id": string,"notes": string | null,"opportunity_id": string | null,"project_id": string | null,"requirement": string,"responsible_party": string | null,"status": Database["public"]['Enums']["compliance_status"] | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"due_date"?: string | null,"evidence_doc_id"?: string | null,"framework": string,"id"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"requirement": string,"responsible_party"?: string | null,"status"?: Database["public"]['Enums']["compliance_status"] | null,"updated_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"due_date"?: string | null,"evidence_doc_id"?: string | null,"framework"?: string,"id"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"requirement"?: string,"responsible_party"?: string | null,"status"?: Database["public"]['Enums']["compliance_status"] | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "compliance_items_evidence_doc_id_fkey"
      columns: ["evidence_doc_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "compliance_items_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "compliance_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "compliance_items_responsible_party_fkey"
      columns: ["responsible_party"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    }
                  ]
                },"conflict_disclosures": {
                  Row: {
                    "created_at": string | null,"description": string | null,"disclosed_on": string,"document_id": string | null,"has_conflicts": boolean,"id": string,"kind": string,"org_node_id": string | null,"party_id": string | null,"period": string | null,"person_name": string,"personnel_id": string | null,"project_id": string | null,"recused": boolean,"related_entity_id": string | null,"related_name": string | null,"related_party_id": string | null,"resolution_id": string | null,"reviewed_by": string | null,"reviewed_on": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"description"?: string | null,"disclosed_on": string,"document_id"?: string | null,"has_conflicts"?: boolean,"id"?: string,"kind"?: string,"org_node_id"?: string | null,"party_id"?: string | null,"period"?: string | null,"person_name": string,"personnel_id"?: string | null,"project_id"?: string | null,"recused"?: boolean,"related_entity_id"?: string | null,"related_name"?: string | null,"related_party_id"?: string | null,"resolution_id"?: string | null,"reviewed_by"?: string | null,"reviewed_on"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"description"?: string | null,"disclosed_on"?: string,"document_id"?: string | null,"has_conflicts"?: boolean,"id"?: string,"kind"?: string,"org_node_id"?: string | null,"party_id"?: string | null,"period"?: string | null,"person_name"?: string,"personnel_id"?: string | null,"project_id"?: string | null,"recused"?: boolean,"related_entity_id"?: string | null,"related_name"?: string | null,"related_party_id"?: string | null,"resolution_id"?: string | null,"reviewed_by"?: string | null,"reviewed_on"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "conflict_disclosures_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conflict_disclosures_org_node_id_fkey"
      columns: ["org_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conflict_disclosures_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conflict_disclosures_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conflict_disclosures_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conflict_disclosures_related_entity_id_fkey"
      columns: ["related_entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conflict_disclosures_related_party_id_fkey"
      columns: ["related_party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conflict_disclosures_resolution_id_fkey"
      columns: ["resolution_id"]
isOneToOne: false
      referencedRelation: "resolutions"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_aliases": {
                  Row: {
                    "alias": string,"alias_key": string | null,"created_at": string | null,"id": string,"party_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alias": string,"alias_key"?: never,"created_at"?: string | null,"id"?: string,"party_id": string
                  }
                  Update: {
                    "alias"?: string,"alias_key"?: never,"created_at"?: string | null,"id"?: string,"party_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_aliases_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    }
                  ]
                },"dd_items": {
                  Row: {
                    "assigned_to": string | null,"category": string,"created_at": string | null,"id": string,"item": string,"notes": string | null,"opportunity_id": string | null,"project_id": string | null,"resolved_at": string | null,"severity": Database["public"]['Enums']["dd_severity"] | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"category": string,"created_at"?: string | null,"id"?: string,"item": string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"resolved_at"?: string | null,"severity"?: Database["public"]['Enums']["dd_severity"] | null,"status"?: string
                  }
                  Update: {
                    "assigned_to"?: string | null,"category"?: string,"created_at"?: string | null,"id"?: string,"item"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"resolved_at"?: string | null,"severity"?: Database["public"]['Enums']["dd_severity"] | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "dd_items_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dd_items_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "dd_items_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"deal_economics": {
                  Row: {
                    "base_year": number | null,"cap_rate_pct": number | null,"computed_asset_value": number | null,"computed_at": string | null,"computed_bw_gross_annual_recurring": number | null,"computed_bw_gross_contract_value": number | null,"computed_bw_gross_one_time": number | null,"computed_bw_net_annual_recurring": number | null,"computed_bw_net_contract_value": number | null,"computed_bw_net_one_time": number | null,"computed_bw_net_tax_credits": number | null,"computed_capture_pct_of_gross": number | null,"computed_firm_mw": number | null,"computed_gross_annual_recurring": number | null,"computed_gross_contract_value": number | null,"computed_gross_one_time": number | null,"computed_gross_project_value": number | null,"computed_status": string | null,"computed_undetermined_annual_recurring": number | null,"computed_undetermined_one_time": number | null,"computed_utilization_pct": number | null,"computed_valid": boolean | null,"created_at": string,"discount_rate_pct": number | null,"id": string,"notes": string | null,"opportunity_id": string | null,"project_id": string | null,"stated_total_amount": number | null,"stated_total_shape": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "base_year"?: number | null,"cap_rate_pct"?: number | null,"computed_asset_value"?: number | null,"computed_at"?: string | null,"computed_bw_gross_annual_recurring"?: number | null,"computed_bw_gross_contract_value"?: number | null,"computed_bw_gross_one_time"?: number | null,"computed_bw_net_annual_recurring"?: number | null,"computed_bw_net_contract_value"?: number | null,"computed_bw_net_one_time"?: number | null,"computed_bw_net_tax_credits"?: number | null,"computed_capture_pct_of_gross"?: number | null,"computed_firm_mw"?: number | null,"computed_gross_annual_recurring"?: number | null,"computed_gross_contract_value"?: number | null,"computed_gross_one_time"?: number | null,"computed_gross_project_value"?: number | null,"computed_status"?: string | null,"computed_undetermined_annual_recurring"?: number | null,"computed_undetermined_one_time"?: number | null,"computed_utilization_pct"?: number | null,"computed_valid"?: boolean | null,"created_at"?: string,"discount_rate_pct"?: number | null,"id"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"stated_total_amount"?: number | null,"stated_total_shape"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "base_year"?: number | null,"cap_rate_pct"?: number | null,"computed_asset_value"?: number | null,"computed_at"?: string | null,"computed_bw_gross_annual_recurring"?: number | null,"computed_bw_gross_contract_value"?: number | null,"computed_bw_gross_one_time"?: number | null,"computed_bw_net_annual_recurring"?: number | null,"computed_bw_net_contract_value"?: number | null,"computed_bw_net_one_time"?: number | null,"computed_bw_net_tax_credits"?: number | null,"computed_capture_pct_of_gross"?: number | null,"computed_firm_mw"?: number | null,"computed_gross_annual_recurring"?: number | null,"computed_gross_contract_value"?: number | null,"computed_gross_one_time"?: number | null,"computed_gross_project_value"?: number | null,"computed_status"?: string | null,"computed_undetermined_annual_recurring"?: number | null,"computed_undetermined_one_time"?: number | null,"computed_utilization_pct"?: number | null,"computed_valid"?: boolean | null,"created_at"?: string,"discount_rate_pct"?: number | null,"id"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"stated_total_amount"?: number | null,"stated_total_shape"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "deal_economics_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deal_economics_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"dev_notes": {
                  Row: {
                    "body": string | null,"created_at": string | null,"id": string,"kind": string,"page_path": string | null,"priority": string,"reporter_id": string | null,"reporter_name": string | null,"resolution": string | null,"resolved_at": string | null,"resolved_by": string | null,"status": string,"title": string,"updated_at": string | null,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string | null,"id"?: string,"kind"?: string,"page_path"?: string | null,"priority"?: string,"reporter_id"?: string | null,"reporter_name"?: string | null,"resolution"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"title": string,"updated_at"?: string | null,"user_agent"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string | null,"id"?: string,"kind"?: string,"page_path"?: string | null,"priority"?: string,"reporter_id"?: string | null,"reporter_name"?: string | null,"resolution"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string | null,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "dev_notes_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"dino_notes": {
                  Row: {
                    "author": string | null,"body": string,"created_at": string | null,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body": string,"created_at"?: string | null,"id"?: string
                  }
                  Update: {
                    "author"?: string | null,"body"?: string,"created_at"?: string | null,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"dino_payments": {
                  Row: {
                    "amount": number,"created_at": string | null,"due_date": string | null,"id": string,"label": string | null,"notes": string | null,"paid": boolean,"paid_date": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number,"created_at"?: string | null,"due_date"?: string | null,"id"?: string,"label"?: string | null,"notes"?: string | null,"paid"?: boolean,"paid_date"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "amount"?: number,"created_at"?: string | null,"due_date"?: string | null,"id"?: string,"label"?: string | null,"notes"?: string | null,"paid"?: boolean,"paid_date"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"dino_revenue": {
                  Row: {
                    "amount": number,"client_name": string | null,"created_at": string | null,"description": string | null,"id": string,"notes": string | null,"project_id": string | null,"revenue_date": string,"source_type": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number,"client_name"?: string | null,"created_at"?: string | null,"description"?: string | null,"id"?: string,"notes"?: string | null,"project_id"?: string | null,"revenue_date": string,"source_type"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "amount"?: number,"client_name"?: string | null,"created_at"?: string | null,"description"?: string | null,"id"?: string,"notes"?: string | null,"project_id"?: string | null,"revenue_date"?: string,"source_type"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "dino_revenue_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "ai_summary": string | null,"classification": string | null,"confidence": number | null,"content_sha256": string | null,"doc_type": string | null,"drive_file_id": string | null,"drive_folder_path": string | null,"drive_modified_at": string | null,"drive_published_id": string | null,"duplicate_of": string | null,"embedding_status": string | null,"entity_id": string | null,"excluded_at": string | null,"excluded_reason": string | null,"extracted_text": string | null,"file_name": string,"file_size_bytes": number | null,"filing_confirmed_at": string | null,"id": string,"is_company": boolean,"is_reference": boolean,"meeting_id": string | null,"mime_type": string | null,"project_id": string | null,"source": Database["public"]['Enums']["update_source"] | null,"steel_deal_id": string | null,"storage_path": string,"superseded_at": string | null,"superseded_by_hand": boolean,"superseded_reason": string | null,"uploaded_at": string | null,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_summary"?: string | null,"classification"?: string | null,"confidence"?: number | null,"content_sha256"?: string | null,"doc_type"?: string | null,"drive_file_id"?: string | null,"drive_folder_path"?: string | null,"drive_modified_at"?: string | null,"drive_published_id"?: string | null,"duplicate_of"?: string | null,"embedding_status"?: string | null,"entity_id"?: string | null,"excluded_at"?: string | null,"excluded_reason"?: string | null,"extracted_text"?: string | null,"file_name": string,"file_size_bytes"?: number | null,"filing_confirmed_at"?: string | null,"id"?: string,"is_company"?: boolean,"is_reference"?: boolean,"meeting_id"?: string | null,"mime_type"?: string | null,"project_id"?: string | null,"source"?: Database["public"]['Enums']["update_source"] | null,"steel_deal_id"?: string | null,"storage_path": string,"superseded_at"?: string | null,"superseded_by_hand"?: boolean,"superseded_reason"?: string | null,"uploaded_at"?: string | null,"uploaded_by"?: string | null
                  }
                  Update: {
                    "ai_summary"?: string | null,"classification"?: string | null,"confidence"?: number | null,"content_sha256"?: string | null,"doc_type"?: string | null,"drive_file_id"?: string | null,"drive_folder_path"?: string | null,"drive_modified_at"?: string | null,"drive_published_id"?: string | null,"duplicate_of"?: string | null,"embedding_status"?: string | null,"entity_id"?: string | null,"excluded_at"?: string | null,"excluded_reason"?: string | null,"extracted_text"?: string | null,"file_name"?: string,"file_size_bytes"?: number | null,"filing_confirmed_at"?: string | null,"id"?: string,"is_company"?: boolean,"is_reference"?: boolean,"meeting_id"?: string | null,"mime_type"?: string | null,"project_id"?: string | null,"source"?: Database["public"]['Enums']["update_source"] | null,"steel_deal_id"?: string | null,"storage_path"?: string,"superseded_at"?: string | null,"superseded_by_hand"?: boolean,"superseded_reason"?: string | null,"uploaded_at"?: string | null,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_duplicate_of_fkey"
      columns: ["duplicate_of"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_entity_id_fkey"
      columns: ["entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_steel_deal_id_fkey"
      columns: ["steel_deal_id"]
isOneToOne: false
      referencedRelation: "steel_deals"
      referencedColumns: ["id"]
    }
                  ]
                },"economics_benchmarks": {
                  Row: {
                    "active": boolean,"as_of": string | null,"created_at": string,"geography": string | null,"id": string,"key": string,"label": string,"needs_review": boolean,"notes": string | null,"sort_order": number,"source": string | null,"tone": string,"unit": string,"updated_at": string | null,"value_high": number | null,"value_low": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"as_of"?: string | null,"created_at"?: string,"geography"?: string | null,"id"?: string,"key": string,"label": string,"needs_review"?: boolean,"notes"?: string | null,"sort_order"?: number,"source"?: string | null,"tone"?: string,"unit": string,"updated_at"?: string | null,"value_high"?: number | null,"value_low"?: number | null
                  }
                  Update: {
                    "active"?: boolean,"as_of"?: string | null,"created_at"?: string,"geography"?: string | null,"id"?: string,"key"?: string,"label"?: string,"needs_review"?: boolean,"notes"?: string | null,"sort_order"?: number,"source"?: string | null,"tone"?: string,"unit"?: string,"updated_at"?: string | null,"value_high"?: number | null,"value_low"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"economics_buckets": {
                  Row: {
                    "created_at": string,"economics_id": string,"id": string,"label": string,"peak_mw": number | null,"priority": number,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"economics_id": string,"id"?: string,"label": string,"peak_mw"?: number | null,"priority"?: number,"updated_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"economics_id"?: string,"id"?: string,"label"?: string,"peak_mw"?: number | null,"priority"?: number,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "economics_buckets_economics_id_fkey"
      columns: ["economics_id"]
isOneToOne: false
      referencedRelation: "deal_economics"
      referencedColumns: ["id"]
    }
                  ]
                },"economics_capacity_sources": {
                  Row: {
                    "availability_pct": number | null,"block_count": number | null,"block_mw": number | null,"created_at": string,"economics_id": string,"id": string,"kind": string,"label": string,"nameplate_mw": number | null,"redundant_blocks": number | null,"sort_order": number,"stated_net_mw": number | null,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "availability_pct"?: number | null,"block_count"?: number | null,"block_mw"?: number | null,"created_at"?: string,"economics_id": string,"id"?: string,"kind"?: string,"label": string,"nameplate_mw"?: number | null,"redundant_blocks"?: number | null,"sort_order"?: number,"stated_net_mw"?: number | null,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "availability_pct"?: number | null,"block_count"?: number | null,"block_mw"?: number | null,"created_at"?: string,"economics_id"?: string,"id"?: string,"kind"?: string,"label"?: string,"nameplate_mw"?: number | null,"redundant_blocks"?: number | null,"sort_order"?: number,"stated_net_mw"?: number | null,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "economics_capacity_sources_economics_id_fkey"
      columns: ["economics_id"]
isOneToOne: false
      referencedRelation: "deal_economics"
      referencedColumns: ["id"]
    }
                  ]
                },"economics_input_proposals": {
                  Row: {
                    "confidence": number | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"economics_id": string,"field_key": string,"id": string,"line_id": string | null,"proposed_label": string | null,"proposed_line_type": string | null,"proposed_unit": string | null,"proposed_value": number | null,"reasoning": string | null,"source_document_id": string | null,"source_quote": string | null,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confidence"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"economics_id": string,"field_key": string,"id"?: string,"line_id"?: string | null,"proposed_label"?: string | null,"proposed_line_type"?: string | null,"proposed_unit"?: string | null,"proposed_value"?: number | null,"reasoning"?: string | null,"source_document_id"?: string | null,"source_quote"?: string | null,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "confidence"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"economics_id"?: string,"field_key"?: string,"id"?: string,"line_id"?: string | null,"proposed_label"?: string | null,"proposed_line_type"?: string | null,"proposed_unit"?: string | null,"proposed_value"?: number | null,"reasoning"?: string | null,"source_document_id"?: string | null,"source_quote"?: string | null,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "economics_input_proposals_economics_id_fkey"
      columns: ["economics_id"]
isOneToOne: false
      referencedRelation: "deal_economics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "economics_input_proposals_line_id_fkey"
      columns: ["line_id"]
isOneToOne: false
      referencedRelation: "economics_lines"
      referencedColumns: ["id"]
    }
                  ]
                },"economics_line_schedule": {
                  Row: {
                    "created_at": string,"due_date": string | null,"id": string,"kind": string,"label": string,"line_id": string,"months_from_ntp": number | null,"pct": number | null,"sort_order": number,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"due_date"?: string | null,"id"?: string,"kind"?: string,"label"?: string,"line_id": string,"months_from_ntp"?: number | null,"pct"?: number | null,"sort_order"?: number,"updated_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"due_date"?: string | null,"id"?: string,"kind"?: string,"label"?: string,"line_id"?: string,"months_from_ntp"?: number | null,"pct"?: number | null,"sort_order"?: number,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "economics_line_schedule_line_id_fkey"
      columns: ["line_id"]
isOneToOne: false
      referencedRelation: "economics_lines"
      referencedColumns: ["id"]
    }
                  ]
                },"economics_lines": {
                  Row: {
                    "acres": number | null,"amount": number | null,"annual_rate_pct": number | null,"annual_rent": number | null,"attribute_kind": string | null,"bucket_id": string | null,"capital_base": number | null,"cost": number | null,"cost_per_mw": number | null,"cost_per_unit": number | null,"counterparty": string | null,"counts_toward_project_value": boolean,"created_at": string,"credit_kind": string | null,"disposition": string | null,"economics_id": string,"escalator_pct": number | null,"fee_base": string | null,"fixed_om_per_kw_year": number | null,"gas_price_per_mmbtu": number | null,"heat_rate": number | null,"id": string,"is_ber_wilson_revenue": boolean,"is_carve_out": boolean,"it_mw": number | null,"label": string,"line_type": string,"load_factor": number | null,"minimum_take_pct": number | null,"mode": string | null,"mw": number | null,"notes": string | null,"occupancy": number | null,"opex_annual": number | null,"our_share_pct": number | null,"partner_label": string | null,"pct_of_line": number | null,"power_passed_through": boolean,"power_revenue_retained": boolean,"price": number | null,"price_per_mw": number | null,"price_per_mwh": number | null,"price_per_unit": number | null,"price_per_unit_month": number | null,"price_unit": string | null,"pue": number | null,"quantity": number | null,"ramp": (number)[] | null,"rate_per_kw_month": number | null,"referenced_line_id": string | null,"rides_on_line_id": string | null,"sort_order": number,"spv_id": string | null,"start_year": number | null,"status": string,"term_years": number | null,"transferable": boolean,"unit_label": string | null,"units": number | null,"updated_at": string | null,"variable_om_per_mwh": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "acres"?: number | null,"amount"?: number | null,"annual_rate_pct"?: number | null,"annual_rent"?: number | null,"attribute_kind"?: string | null,"bucket_id"?: string | null,"capital_base"?: number | null,"cost"?: number | null,"cost_per_mw"?: number | null,"cost_per_unit"?: number | null,"counterparty"?: string | null,"counts_toward_project_value"?: boolean,"created_at"?: string,"credit_kind"?: string | null,"disposition"?: string | null,"economics_id": string,"escalator_pct"?: number | null,"fee_base"?: string | null,"fixed_om_per_kw_year"?: number | null,"gas_price_per_mmbtu"?: number | null,"heat_rate"?: number | null,"id"?: string,"is_ber_wilson_revenue"?: boolean,"is_carve_out"?: boolean,"it_mw"?: number | null,"label": string,"line_type": string,"load_factor"?: number | null,"minimum_take_pct"?: number | null,"mode"?: string | null,"mw"?: number | null,"notes"?: string | null,"occupancy"?: number | null,"opex_annual"?: number | null,"our_share_pct"?: number | null,"partner_label"?: string | null,"pct_of_line"?: number | null,"power_passed_through"?: boolean,"power_revenue_retained"?: boolean,"price"?: number | null,"price_per_mw"?: number | null,"price_per_mwh"?: number | null,"price_per_unit"?: number | null,"price_per_unit_month"?: number | null,"price_unit"?: string | null,"pue"?: number | null,"quantity"?: number | null,"ramp"?: (number)[] | null,"rate_per_kw_month"?: number | null,"referenced_line_id"?: string | null,"rides_on_line_id"?: string | null,"sort_order"?: number,"spv_id"?: string | null,"start_year"?: number | null,"status"?: string,"term_years"?: number | null,"transferable"?: boolean,"unit_label"?: string | null,"units"?: number | null,"updated_at"?: string | null,"variable_om_per_mwh"?: number | null
                  }
                  Update: {
                    "acres"?: number | null,"amount"?: number | null,"annual_rate_pct"?: number | null,"annual_rent"?: number | null,"attribute_kind"?: string | null,"bucket_id"?: string | null,"capital_base"?: number | null,"cost"?: number | null,"cost_per_mw"?: number | null,"cost_per_unit"?: number | null,"counterparty"?: string | null,"counts_toward_project_value"?: boolean,"created_at"?: string,"credit_kind"?: string | null,"disposition"?: string | null,"economics_id"?: string,"escalator_pct"?: number | null,"fee_base"?: string | null,"fixed_om_per_kw_year"?: number | null,"gas_price_per_mmbtu"?: number | null,"heat_rate"?: number | null,"id"?: string,"is_ber_wilson_revenue"?: boolean,"is_carve_out"?: boolean,"it_mw"?: number | null,"label"?: string,"line_type"?: string,"load_factor"?: number | null,"minimum_take_pct"?: number | null,"mode"?: string | null,"mw"?: number | null,"notes"?: string | null,"occupancy"?: number | null,"opex_annual"?: number | null,"our_share_pct"?: number | null,"partner_label"?: string | null,"pct_of_line"?: number | null,"power_passed_through"?: boolean,"power_revenue_retained"?: boolean,"price"?: number | null,"price_per_mw"?: number | null,"price_per_mwh"?: number | null,"price_per_unit"?: number | null,"price_per_unit_month"?: number | null,"price_unit"?: string | null,"pue"?: number | null,"quantity"?: number | null,"ramp"?: (number)[] | null,"rate_per_kw_month"?: number | null,"referenced_line_id"?: string | null,"rides_on_line_id"?: string | null,"sort_order"?: number,"spv_id"?: string | null,"start_year"?: number | null,"status"?: string,"term_years"?: number | null,"transferable"?: boolean,"unit_label"?: string | null,"units"?: number | null,"updated_at"?: string | null,"variable_om_per_mwh"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "economics_lines_bucket_id_fkey"
      columns: ["bucket_id"]
isOneToOne: false
      referencedRelation: "economics_buckets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "economics_lines_economics_id_fkey"
      columns: ["economics_id"]
isOneToOne: false
      referencedRelation: "deal_economics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "economics_lines_referenced_line_id_fkey"
      columns: ["referenced_line_id"]
isOneToOne: false
      referencedRelation: "economics_lines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "economics_lines_rides_on_line_id_fkey"
      columns: ["rides_on_line_id"]
isOneToOne: false
      referencedRelation: "economics_lines"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "economics_lines_spv_id_fkey"
      columns: ["spv_id"]
isOneToOne: false
      referencedRelation: "project_spvs"
      referencedColumns: ["id"]
    }
                  ]
                },"economics_provenance": {
                  Row: {
                    "as_of": string | null,"created_at": string,"economics_id": string,"field_key": string,"id": string,"line_id": string | null,"note": string | null,"source": string | null,"source_ref": string | null,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "as_of"?: string | null,"created_at"?: string,"economics_id": string,"field_key": string,"id"?: string,"line_id"?: string | null,"note"?: string | null,"source"?: string | null,"source_ref"?: string | null,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "as_of"?: string | null,"created_at"?: string,"economics_id"?: string,"field_key"?: string,"id"?: string,"line_id"?: string | null,"note"?: string | null,"source"?: string | null,"source_ref"?: string | null,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "economics_provenance_economics_id_fkey"
      columns: ["economics_id"]
isOneToOne: false
      referencedRelation: "deal_economics"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "economics_provenance_line_id_fkey"
      columns: ["line_id"]
isOneToOne: false
      referencedRelation: "economics_lines"
      referencedColumns: ["id"]
    }
                  ]
                },"economics_templates": {
                  Row: {
                    "active": boolean,"created_at": string,"description": string | null,"id": string,"key": string,"label": string,"sort_order": number,"structure": NonNullable<Json>,"system": boolean,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"description"?: string | null,"id"?: string,"key": string,"label": string,"sort_order"?: number,"structure"?: NonNullable<Json>,"system"?: boolean,"updated_at"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"description"?: string | null,"id"?: string,"key"?: string,"label"?: string,"sort_order"?: number,"structure"?: NonNullable<Json>,"system"?: boolean,"updated_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"economics_versions": {
                  Row: {
                    "created_at": string,"created_by": string | null,"economics_id": string,"id": string,"input_snapshot": NonNullable<Json>,"label": string | null,"note": string | null,"result_snapshot": NonNullable<Json>,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"economics_id": string,"id"?: string,"input_snapshot": NonNullable<Json>,"label"?: string | null,"note"?: string | null,"result_snapshot": NonNullable<Json>,"version": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"economics_id"?: string,"id"?: string,"input_snapshot"?: NonNullable<Json>,"label"?: string | null,"note"?: string | null,"result_snapshot"?: NonNullable<Json>,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "economics_versions_economics_id_fkey"
      columns: ["economics_id"]
isOneToOne: false
      referencedRelation: "deal_economics"
      referencedColumns: ["id"]
    }
                  ]
                },"email_intake_sessions": {
                  Row: {
                    "cluster_id": string | null,"confirmed_at": string | null,"created_at": string | null,"created_record_ids": Json | null,"drive_file_id": string | null,"extraction_result": NonNullable<Json>,"fit_assessment": Json | null,"id": string,"intake_kind": string,"label": string | null,"match_candidates": Json | null,"party_matches": Json | null,"predecision": Json | null,"raw_text": string | null,"source_title": string | null,"staged_attachments": Json | null,"status": string,"updated_at": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cluster_id"?: string | null,"confirmed_at"?: string | null,"created_at"?: string | null,"created_record_ids"?: Json | null,"drive_file_id"?: string | null,"extraction_result": NonNullable<Json>,"fit_assessment"?: Json | null,"id"?: string,"intake_kind"?: string,"label"?: string | null,"match_candidates"?: Json | null,"party_matches"?: Json | null,"predecision"?: Json | null,"raw_text"?: string | null,"source_title"?: string | null,"staged_attachments"?: Json | null,"status"?: string,"updated_at"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "cluster_id"?: string | null,"confirmed_at"?: string | null,"created_at"?: string | null,"created_record_ids"?: Json | null,"drive_file_id"?: string | null,"extraction_result"?: NonNullable<Json>,"fit_assessment"?: Json | null,"id"?: string,"intake_kind"?: string,"label"?: string | null,"match_candidates"?: Json | null,"party_matches"?: Json | null,"predecision"?: Json | null,"raw_text"?: string | null,"source_title"?: string | null,"staged_attachments"?: Json | null,"status"?: string,"updated_at"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_intake_sessions_cluster_id_fkey"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "thread_clusters"
      referencedColumns: ["id"]
    }
                  ]
                },"email_threads": {
                  Row: {
                    "attachment_count": number | null,"cluster_id": string | null,"commitments_at": string | null,"created_at": string | null,"embedded_at": string | null,"fingerprint": string,"first_at": string | null,"gmail_thread_id": string,"id": string,"last_at": string | null,"mailbox": string,"message_count": number | null,"participants": (string)[] | null,"pipeline": string,"raw_markdown": string | null,"routed_at": string | null,"subject": string | null,"summary": Json | null,"summary_error": string | null,"summary_state": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attachment_count"?: number | null,"cluster_id"?: string | null,"commitments_at"?: string | null,"created_at"?: string | null,"embedded_at"?: string | null,"fingerprint": string,"first_at"?: string | null,"gmail_thread_id": string,"id"?: string,"last_at"?: string | null,"mailbox": string,"message_count"?: number | null,"participants"?: (string)[] | null,"pipeline"?: string,"raw_markdown"?: string | null,"routed_at"?: string | null,"subject"?: string | null,"summary"?: Json | null,"summary_error"?: string | null,"summary_state"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "attachment_count"?: number | null,"cluster_id"?: string | null,"commitments_at"?: string | null,"created_at"?: string | null,"embedded_at"?: string | null,"fingerprint"?: string,"first_at"?: string | null,"gmail_thread_id"?: string,"id"?: string,"last_at"?: string | null,"mailbox"?: string,"message_count"?: number | null,"participants"?: (string)[] | null,"pipeline"?: string,"raw_markdown"?: string | null,"routed_at"?: string | null,"subject"?: string | null,"summary"?: Json | null,"summary_error"?: string | null,"summary_state"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_threads_cluster_fk"
      columns: ["cluster_id"]
isOneToOne: false
      referencedRelation: "thread_clusters"
      referencedColumns: ["id"]
    }
                  ]
                },"entities": {
                  Row: {
                    "category": Database["public"]['Enums']["entity_category"],"confidence_score": number | null,"created_at": string | null,"description": string | null,"ein": string | null,"enriched_at": string | null,"enrichment_data": Json | null,"entity_type": Database["public"]['Enums']["entity_type"],"formation_date": string | null,"headquarters": string | null,"id": string,"jurisdiction": string | null,"logo_url": string | null,"name": string,"notes": string | null,"ownership_pct": number | null,"parent_entity_id": string | null,"primary_contact_id": string | null,"quality_score": number | null,"specialties": (string)[] | null,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: Database["public"]['Enums']["entity_category"],"confidence_score"?: number | null,"created_at"?: string | null,"description"?: string | null,"ein"?: string | null,"enriched_at"?: string | null,"enrichment_data"?: Json | null,"entity_type": Database["public"]['Enums']["entity_type"],"formation_date"?: string | null,"headquarters"?: string | null,"id"?: string,"jurisdiction"?: string | null,"logo_url"?: string | null,"name": string,"notes"?: string | null,"ownership_pct"?: number | null,"parent_entity_id"?: string | null,"primary_contact_id"?: string | null,"quality_score"?: number | null,"specialties"?: (string)[] | null,"website_url"?: string | null
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["entity_category"],"confidence_score"?: number | null,"created_at"?: string | null,"description"?: string | null,"ein"?: string | null,"enriched_at"?: string | null,"enrichment_data"?: Json | null,"entity_type"?: Database["public"]['Enums']["entity_type"],"formation_date"?: string | null,"headquarters"?: string | null,"id"?: string,"jurisdiction"?: string | null,"logo_url"?: string | null,"name"?: string,"notes"?: string | null,"ownership_pct"?: number | null,"parent_entity_id"?: string | null,"primary_contact_id"?: string | null,"quality_score"?: number | null,"specialties"?: (string)[] | null,"website_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "entities_parent_entity_id_fkey"
      columns: ["parent_entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entities_primary_contact_id_fkey"
      columns: ["primary_contact_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    }
                  ]
                },"entity_obligations": {
                  Row: {
                    "authority": string | null,"category": string,"cost": number | null,"created_at": string | null,"document_id": string | null,"id": string,"identifier": string | null,"jurisdiction": string | null,"kind": string,"last_filed_on": string | null,"next_due_on": string | null,"note": string | null,"org_node_id": string | null,"org_node_name": string | null,"owner_team_member_id": string | null,"period": string,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "authority"?: string | null,"category"?: string,"cost"?: number | null,"created_at"?: string | null,"document_id"?: string | null,"id"?: string,"identifier"?: string | null,"jurisdiction"?: string | null,"kind": string,"last_filed_on"?: string | null,"next_due_on"?: string | null,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"owner_team_member_id"?: string | null,"period"?: string,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "authority"?: string | null,"category"?: string,"cost"?: number | null,"created_at"?: string | null,"document_id"?: string | null,"id"?: string,"identifier"?: string | null,"jurisdiction"?: string | null,"kind"?: string,"last_filed_on"?: string | null,"next_due_on"?: string | null,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"owner_team_member_id"?: string | null,"period"?: string,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "entity_obligations_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_obligations_org_node_id_fkey"
      columns: ["org_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_obligations_owner_team_member_id_fkey"
      columns: ["owner_team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"entity_projects": {
                  Row: {
                    "created_at": string | null,"entity_id": string,"equity_pct": number | null,"id": string,"notes": string | null,"opportunity_id": string | null,"project_id": string | null,"relationship": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"entity_id": string,"equity_pct"?: number | null,"id"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"relationship": string
                  }
                  Update: {
                    "created_at"?: string | null,"entity_id"?: string,"equity_pct"?: number | null,"id"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"relationship"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entity_projects_entity_id_fkey"
      columns: ["entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_projects_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entity_projects_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"financing_structures": {
                  Row: {
                    "created_at": string | null,"draw_schedule": Json | null,"equity_amount": number | null,"equity_pct": number | null,"id": string,"interest_rate": number | null,"lender": string | null,"ltv": number | null,"mezzanine": number | null,"notes": string | null,"opportunity_id": string | null,"pe_partner": string | null,"project_id": string | null,"senior_debt": number | null,"structure_type": string | null,"updated_at": string | null,"waterfall_notes": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"draw_schedule"?: Json | null,"equity_amount"?: number | null,"equity_pct"?: number | null,"id"?: string,"interest_rate"?: number | null,"lender"?: string | null,"ltv"?: number | null,"mezzanine"?: number | null,"notes"?: string | null,"opportunity_id"?: string | null,"pe_partner"?: string | null,"project_id"?: string | null,"senior_debt"?: number | null,"structure_type"?: string | null,"updated_at"?: string | null,"waterfall_notes"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"draw_schedule"?: Json | null,"equity_amount"?: number | null,"equity_pct"?: number | null,"id"?: string,"interest_rate"?: number | null,"lender"?: string | null,"ltv"?: number | null,"mezzanine"?: number | null,"notes"?: string | null,"opportunity_id"?: string | null,"pe_partner"?: string | null,"project_id"?: string | null,"senior_debt"?: number | null,"structure_type"?: string | null,"updated_at"?: string | null,"waterfall_notes"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "financing_structures_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "financing_structures_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"google_task_lists": {
                  Row: {
                    "created_at": string | null,"google_list_id": string,"last_error": string | null,"last_synced_at": string | null,"mailbox": string,"missing_at": string | null,"team_member_id": string,"title": string,"updated_min": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"google_list_id": string,"last_error"?: string | null,"last_synced_at"?: string | null,"mailbox": string,"missing_at"?: string | null,"team_member_id": string,"title": string,"updated_min"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"google_list_id"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"mailbox"?: string,"missing_at"?: string | null,"team_member_id"?: string,"title"?: string,"updated_min"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "google_task_lists_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: true
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"investments": {
                  Row: {
                    "amount_committed": number | null,"amount_funded": number | null,"amount_indicated": number | null,"committed_date": string | null,"created_at": string | null,"equity_pct": number | null,"first_discussed_date": string | null,"funded_date": string | null,"id": string,"instrument": string | null,"investor_id": string,"next_step": string | null,"preferred_return_pct": number | null,"profit_share_pct": number | null,"project_id": string | null,"raise_id": string | null,"spv_id": string | null,"stage": string,"target_close_date": string | null,"target_kind": string,"terms_notes": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_committed"?: number | null,"amount_funded"?: number | null,"amount_indicated"?: number | null,"committed_date"?: string | null,"created_at"?: string | null,"equity_pct"?: number | null,"first_discussed_date"?: string | null,"funded_date"?: string | null,"id"?: string,"instrument"?: string | null,"investor_id": string,"next_step"?: string | null,"preferred_return_pct"?: number | null,"profit_share_pct"?: number | null,"project_id"?: string | null,"raise_id"?: string | null,"spv_id"?: string | null,"stage"?: string,"target_close_date"?: string | null,"target_kind"?: string,"terms_notes"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "amount_committed"?: number | null,"amount_funded"?: number | null,"amount_indicated"?: number | null,"committed_date"?: string | null,"created_at"?: string | null,"equity_pct"?: number | null,"first_discussed_date"?: string | null,"funded_date"?: string | null,"id"?: string,"instrument"?: string | null,"investor_id"?: string,"next_step"?: string | null,"preferred_return_pct"?: number | null,"profit_share_pct"?: number | null,"project_id"?: string | null,"raise_id"?: string | null,"spv_id"?: string | null,"stage"?: string,"target_close_date"?: string | null,"target_kind"?: string,"terms_notes"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "investments_investor_id_fkey"
      columns: ["investor_id"]
isOneToOne: false
      referencedRelation: "investors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "investments_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "investments_raise_id_fkey"
      columns: ["raise_id"]
isOneToOne: false
      referencedRelation: "raises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "investments_spv_id_fkey"
      columns: ["spv_id"]
isOneToOne: false
      referencedRelation: "project_spvs"
      referencedColumns: ["id"]
    }
                  ]
                },"investor_notes": {
                  Row: {
                    "author": string | null,"body": string,"created_at": string | null,"id": string,"investor_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body": string,"created_at"?: string | null,"id"?: string,"investor_id": string
                  }
                  Update: {
                    "author"?: string | null,"body"?: string,"created_at"?: string | null,"id"?: string,"investor_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "investor_notes_investor_id_fkey"
      columns: ["investor_id"]
isOneToOne: false
      referencedRelation: "investors"
      referencedColumns: ["id"]
    }
                  ]
                },"investor_requirements": {
                  Row: {
                    "category": string,"created_at": string | null,"evidence_doc_id": string | null,"id": string,"investor_id": string,"item": string,"notes": string | null,"project_id": string | null,"sort_order": number,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"created_at"?: string | null,"evidence_doc_id"?: string | null,"id"?: string,"investor_id": string,"item": string,"notes"?: string | null,"project_id"?: string | null,"sort_order"?: number,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "category"?: string,"created_at"?: string | null,"evidence_doc_id"?: string | null,"id"?: string,"investor_id"?: string,"item"?: string,"notes"?: string | null,"project_id"?: string | null,"sort_order"?: number,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "investor_requirements_evidence_doc_id_fkey"
      columns: ["evidence_doc_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "investor_requirements_investor_id_fkey"
      columns: ["investor_id"]
isOneToOne: false
      referencedRelation: "investors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "investor_requirements_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"investors": {
                  Row: {
                    "check_size_max": number | null,"check_size_min": number | null,"created_at": string | null,"email": string | null,"id": string,"interest_level": string | null,"investor_type": string,"last_contact_date": string | null,"name": string,"next_step": string | null,"next_step_date": string | null,"notes": string | null,"party_id": string | null,"phone": string | null,"preferred_structures": (string)[] | null,"referred_by": string | null,"relationship_owner_id": string | null,"sector_interests": (string)[] | null,"source": string | null,"stage": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "check_size_max"?: number | null,"check_size_min"?: number | null,"created_at"?: string | null,"email"?: string | null,"id"?: string,"interest_level"?: string | null,"investor_type"?: string,"last_contact_date"?: string | null,"name": string,"next_step"?: string | null,"next_step_date"?: string | null,"notes"?: string | null,"party_id"?: string | null,"phone"?: string | null,"preferred_structures"?: (string)[] | null,"referred_by"?: string | null,"relationship_owner_id"?: string | null,"sector_interests"?: (string)[] | null,"source"?: string | null,"stage"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "check_size_max"?: number | null,"check_size_min"?: number | null,"created_at"?: string | null,"email"?: string | null,"id"?: string,"interest_level"?: string | null,"investor_type"?: string,"last_contact_date"?: string | null,"name"?: string,"next_step"?: string | null,"next_step_date"?: string | null,"notes"?: string | null,"party_id"?: string | null,"phone"?: string | null,"preferred_structures"?: (string)[] | null,"referred_by"?: string | null,"relationship_owner_id"?: string | null,"sector_interests"?: (string)[] | null,"source"?: string | null,"stage"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "investors_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "investors_relationship_owner_id_fkey"
      columns: ["relationship_owner_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_categories": {
                  Row: {
                    "active": boolean,"chat_webhook_key": string | null,"created_at": string | null,"destination": string,"destination_note": string | null,"drive_folder_id": string | null,"handoff_email": string | null,"id": string,"key": string,"label": string,"owner_team_member_id": string | null,"publish_sheet": boolean,"routing_rule": string | null,"share_with": (string)[],"sort_order": number,"system": boolean,"tone": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"chat_webhook_key"?: string | null,"created_at"?: string | null,"destination"?: string,"destination_note"?: string | null,"drive_folder_id"?: string | null,"handoff_email"?: string | null,"id"?: string,"key": string,"label": string,"owner_team_member_id"?: string | null,"publish_sheet"?: boolean,"routing_rule"?: string | null,"share_with"?: (string)[],"sort_order"?: number,"system"?: boolean,"tone"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"chat_webhook_key"?: string | null,"created_at"?: string | null,"destination"?: string,"destination_note"?: string | null,"drive_folder_id"?: string | null,"handoff_email"?: string | null,"id"?: string,"key"?: string,"label"?: string,"owner_team_member_id"?: string | null,"publish_sheet"?: boolean,"routing_rule"?: string | null,"share_with"?: (string)[],"sort_order"?: number,"system"?: boolean,"tone"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_categories_owner_team_member_id_fkey"
      columns: ["owner_team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_notes": {
                  Row: {
                    "author": string | null,"body": string,"created_at": string | null,"id": string,"lead_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body": string,"created_at"?: string | null,"id"?: string,"lead_id": string
                  }
                  Update: {
                    "author"?: string | null,"body"?: string,"created_at"?: string | null,"id"?: string,"lead_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_notes_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    }
                  ]
                },"leads": {
                  Row: {
                    "attachments": NonNullable<Json>,"bid_due_date": string | null,"created_at": string | null,"draft_created_at": string | null,"drive_folder_id": string | null,"drive_folder_url": string | null,"estimated_value": number | null,"fit_concerns": NonNullable<Json>,"fit_gaps": NonNullable<Json>,"fit_questions": NonNullable<Json>,"fit_recommendation": string | null,"fit_score": number | null,"fit_strengths": NonNullable<Json>,"fit_summary": string | null,"forwarded_at": string | null,"forwarded_to": string | null,"gmail_draft_id": string | null,"gmail_label": string | null,"gmail_labeled_at": string | null,"id": string,"intake_answers": NonNullable<Json>,"key_facts": NonNullable<Json>,"location": string | null,"mailbox": string | null,"notes": string | null,"notified_at": string | null,"promoted_at": string | null,"promoted_opportunity_id": string | null,"promoted_project_id": string | null,"promoted_steel_deal_id": string | null,"received_at": string | null,"requirements": NonNullable<Json>,"rfi_due_date": string | null,"route": string,"scope": string | null,"score_error": string | null,"score_state": string,"sector": string | null,"sender_company": string | null,"sender_email": string | null,"sender_name": string | null,"sender_phone": string | null,"site_visit_date": string | null,"solicitation_number": string | null,"source": string,"spam_reason": string | null,"status": string,"summary": string | null,"task_bid_date": string | null,"task_id": string | null,"task_synced_at": string | null,"thread_id": string | null,"thread_item": number,"title": string,"triage_confidence": number | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attachments"?: NonNullable<Json>,"bid_due_date"?: string | null,"created_at"?: string | null,"draft_created_at"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"estimated_value"?: number | null,"fit_concerns"?: NonNullable<Json>,"fit_gaps"?: NonNullable<Json>,"fit_questions"?: NonNullable<Json>,"fit_recommendation"?: string | null,"fit_score"?: number | null,"fit_strengths"?: NonNullable<Json>,"fit_summary"?: string | null,"forwarded_at"?: string | null,"forwarded_to"?: string | null,"gmail_draft_id"?: string | null,"gmail_label"?: string | null,"gmail_labeled_at"?: string | null,"id"?: string,"intake_answers"?: NonNullable<Json>,"key_facts"?: NonNullable<Json>,"location"?: string | null,"mailbox"?: string | null,"notes"?: string | null,"notified_at"?: string | null,"promoted_at"?: string | null,"promoted_opportunity_id"?: string | null,"promoted_project_id"?: string | null,"promoted_steel_deal_id"?: string | null,"received_at"?: string | null,"requirements"?: NonNullable<Json>,"rfi_due_date"?: string | null,"route"?: string,"scope"?: string | null,"score_error"?: string | null,"score_state"?: string,"sector"?: string | null,"sender_company"?: string | null,"sender_email"?: string | null,"sender_name"?: string | null,"sender_phone"?: string | null,"site_visit_date"?: string | null,"solicitation_number"?: string | null,"source"?: string,"spam_reason"?: string | null,"status"?: string,"summary"?: string | null,"task_bid_date"?: string | null,"task_id"?: string | null,"task_synced_at"?: string | null,"thread_id"?: string | null,"thread_item"?: number,"title": string,"triage_confidence"?: number | null,"updated_at"?: string | null
                  }
                  Update: {
                    "attachments"?: NonNullable<Json>,"bid_due_date"?: string | null,"created_at"?: string | null,"draft_created_at"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"estimated_value"?: number | null,"fit_concerns"?: NonNullable<Json>,"fit_gaps"?: NonNullable<Json>,"fit_questions"?: NonNullable<Json>,"fit_recommendation"?: string | null,"fit_score"?: number | null,"fit_strengths"?: NonNullable<Json>,"fit_summary"?: string | null,"forwarded_at"?: string | null,"forwarded_to"?: string | null,"gmail_draft_id"?: string | null,"gmail_label"?: string | null,"gmail_labeled_at"?: string | null,"id"?: string,"intake_answers"?: NonNullable<Json>,"key_facts"?: NonNullable<Json>,"location"?: string | null,"mailbox"?: string | null,"notes"?: string | null,"notified_at"?: string | null,"promoted_at"?: string | null,"promoted_opportunity_id"?: string | null,"promoted_project_id"?: string | null,"promoted_steel_deal_id"?: string | null,"received_at"?: string | null,"requirements"?: NonNullable<Json>,"rfi_due_date"?: string | null,"route"?: string,"scope"?: string | null,"score_error"?: string | null,"score_state"?: string,"sector"?: string | null,"sender_company"?: string | null,"sender_email"?: string | null,"sender_name"?: string | null,"sender_phone"?: string | null,"site_visit_date"?: string | null,"solicitation_number"?: string | null,"source"?: string,"spam_reason"?: string | null,"status"?: string,"summary"?: string | null,"task_bid_date"?: string | null,"task_id"?: string | null,"task_synced_at"?: string | null,"thread_id"?: string | null,"thread_item"?: number,"title"?: string,"triage_confidence"?: number | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "leads_promoted_opportunity_id_fkey"
      columns: ["promoted_opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_promoted_project_id_fkey"
      columns: ["promoted_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_promoted_steel_deal_id_fkey"
      columns: ["promoted_steel_deal_id"]
isOneToOne: false
      referencedRelation: "steel_deals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_route_fkey"
      columns: ["route"]
isOneToOne: false
      referencedRelation: "lead_categories"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "leads_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "email_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"mailbox_sync": {
                  Row: {
                    "completed_at": string | null,"duplicates_skipped": number,"last_error": string | null,"mailbox": string,"page_token": string | null,"since_days": number | null,"started_at": string | null,"state": string,"threads_new": number,"threads_seen": number,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"duplicates_skipped"?: number,"last_error"?: string | null,"mailbox": string,"page_token"?: string | null,"since_days"?: number | null,"started_at"?: string | null,"state"?: string,"threads_new"?: number,"threads_seen"?: number,"updated_at"?: string | null
                  }
                  Update: {
                    "completed_at"?: string | null,"duplicates_skipped"?: number,"last_error"?: string | null,"mailbox"?: string,"page_token"?: string | null,"since_days"?: number | null,"started_at"?: string | null,"state"?: string,"threads_new"?: number,"threads_seen"?: number,"updated_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"media": {
                  Row: {
                    "caption": string | null,"created_at": string,"entity_id": string | null,"file_name": string,"file_size_bytes": number | null,"id": string,"is_company": boolean,"is_primary": boolean,"mime_type": string,"party_id": string | null,"project_id": string | null,"sort_order": number,"storage_path": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "caption"?: string | null,"created_at"?: string,"entity_id"?: string | null,"file_name": string,"file_size_bytes"?: number | null,"id"?: string,"is_company"?: boolean,"is_primary"?: boolean,"mime_type": string,"party_id"?: string | null,"project_id"?: string | null,"sort_order"?: number,"storage_path": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "caption"?: string | null,"created_at"?: string,"entity_id"?: string | null,"file_name"?: string,"file_size_bytes"?: number | null,"id"?: string,"is_company"?: boolean,"is_primary"?: boolean,"mime_type"?: string,"party_id"?: string | null,"project_id"?: string | null,"sort_order"?: number,"storage_path"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_entity_id_fkey"
      columns: ["entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"meetings": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"attendees": NonNullable<Json>,"chair": string | null,"confidential": boolean,"created_at": string | null,"decisions": NonNullable<Json>,"drive_file_id": string | null,"id": string,"index_ai": boolean,"kind": string,"location": string | null,"meeting_date": string,"meeting_time": string | null,"meeting_type_label": string | null,"minutes": string | null,"minutes_approved_at_meeting_id": string | null,"minutes_document_id": string | null,"opportunity_id": string | null,"project_id": string | null,"scope": string,"secretary": string | null,"status": string,"summary": string | null,"title": string,"transcript": string | null,"transcription_status": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"attendees"?: NonNullable<Json>,"chair"?: string | null,"confidential"?: boolean,"created_at"?: string | null,"decisions"?: NonNullable<Json>,"drive_file_id"?: string | null,"id"?: string,"index_ai"?: boolean,"kind"?: string,"location"?: string | null,"meeting_date": string,"meeting_time"?: string | null,"meeting_type_label"?: string | null,"minutes"?: string | null,"minutes_approved_at_meeting_id"?: string | null,"minutes_document_id"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"scope"?: string,"secretary"?: string | null,"status"?: string,"summary"?: string | null,"title": string,"transcript"?: string | null,"transcription_status"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"attendees"?: NonNullable<Json>,"chair"?: string | null,"confidential"?: boolean,"created_at"?: string | null,"decisions"?: NonNullable<Json>,"drive_file_id"?: string | null,"id"?: string,"index_ai"?: boolean,"kind"?: string,"location"?: string | null,"meeting_date"?: string,"meeting_time"?: string | null,"meeting_type_label"?: string | null,"minutes"?: string | null,"minutes_approved_at_meeting_id"?: string | null,"minutes_document_id"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"scope"?: string,"secretary"?: string | null,"status"?: string,"summary"?: string | null,"title"?: string,"transcript"?: string | null,"transcription_status"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "meetings_minutes_approved_at_meeting_id_fkey"
      columns: ["minutes_approved_at_meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_minutes_document_id_fkey"
      columns: ["minutes_document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meetings_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"milestones": {
                  Row: {
                    "completed_at": string | null,"created_at": string | null,"id": string,"label": string,"notes": string | null,"opportunity_id": string | null,"project_id": string | null,"sort_order": number,"stage": string,"target_date": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string | null,"id"?: string,"label": string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"sort_order"?: number,"stage": string,"target_date"?: string | null
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string | null,"id"?: string,"label"?: string,"notes"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"sort_order"?: number,"stage"?: string,"target_date"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "milestones_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "milestones_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_log": {
                  Row: {
                    "channel": string,"created_at": string | null,"dedupe_key": string | null,"error": string | null,"id": string,"kind": string,"sent_date": string,"status": string,"task_count": number | null,"team_member_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"created_at"?: string | null,"dedupe_key"?: string | null,"error"?: string | null,"id"?: string,"kind"?: string,"sent_date"?: string,"status"?: string,"task_count"?: number | null,"team_member_id"?: string | null
                  }
                  Update: {
                    "channel"?: string,"created_at"?: string | null,"dedupe_key"?: string | null,"error"?: string | null,"id"?: string,"kind"?: string,"sent_date"?: string,"status"?: string,"task_count"?: number | null,"team_member_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_log_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"objectives": {
                  Row: {
                    "bucket": string,"created_at": string | null,"health": string,"id": string,"note": string | null,"owner_id": string | null,"sort_order": number,"status": string,"target_date": string | null,"title": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket"?: string,"created_at"?: string | null,"health"?: string,"id"?: string,"note"?: string | null,"owner_id"?: string | null,"sort_order"?: number,"status"?: string,"target_date"?: string | null,"title": string,"updated_at"?: string | null
                  }
                  Update: {
                    "bucket"?: string,"created_at"?: string | null,"health"?: string,"id"?: string,"note"?: string | null,"owner_id"?: string | null,"sort_order"?: number,"status"?: string,"target_date"?: string | null,"title"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "objectives_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"opportunities": {
                  Row: {
                    "counterparty": string | null,"created_at": string | null,"deal_structure": string | null,"description": string | null,"drive_folder_id": string | null,"drive_folder_url": string | null,"drive_source_folder_id": string | null,"drive_source_folder_url": string | null,"economics_capture_value": number | null,"economics_computed_at": string | null,"economics_status": string | null,"estimated_value": number | null,"id": string,"identified_date": string | null,"lead": string | null,"location": string | null,"match_aliases": (string)[],"name": string,"next_step": string | null,"objective": string | null,"opp_type": string,"ownership_stake": number | null,"priority": string | null,"probability": number | null,"sector": string | null,"source": string | null,"status": string,"target_close_date": string | null,"target_name": string | null,"thesis": string | null,"updated_at": string | null,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "counterparty"?: string | null,"created_at"?: string | null,"deal_structure"?: string | null,"description"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"drive_source_folder_id"?: string | null,"drive_source_folder_url"?: string | null,"economics_capture_value"?: number | null,"economics_computed_at"?: string | null,"economics_status"?: string | null,"estimated_value"?: number | null,"id"?: string,"identified_date"?: string | null,"lead"?: string | null,"location"?: string | null,"match_aliases"?: (string)[],"name": string,"next_step"?: string | null,"objective"?: string | null,"opp_type"?: string,"ownership_stake"?: number | null,"priority"?: string | null,"probability"?: number | null,"sector"?: string | null,"source"?: string | null,"status"?: string,"target_close_date"?: string | null,"target_name"?: string | null,"thesis"?: string | null,"updated_at"?: string | null,"website"?: string | null
                  }
                  Update: {
                    "counterparty"?: string | null,"created_at"?: string | null,"deal_structure"?: string | null,"description"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"drive_source_folder_id"?: string | null,"drive_source_folder_url"?: string | null,"economics_capture_value"?: number | null,"economics_computed_at"?: string | null,"economics_status"?: string | null,"estimated_value"?: number | null,"id"?: string,"identified_date"?: string | null,"lead"?: string | null,"location"?: string | null,"match_aliases"?: (string)[],"name"?: string,"next_step"?: string | null,"objective"?: string | null,"opp_type"?: string,"ownership_stake"?: number | null,"priority"?: string | null,"probability"?: number | null,"sector"?: string | null,"source"?: string | null,"status"?: string,"target_close_date"?: string | null,"target_name"?: string | null,"thesis"?: string | null,"updated_at"?: string | null,"website"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"opportunity_documents": {
                  Row: {
                    "ai_summary": string | null,"content_sha256": string | null,"doc_type": string | null,"drive_file_id": string | null,"drive_folder_path": string | null,"drive_modified_at": string | null,"drive_published_id": string | null,"duplicate_of": string | null,"embedding_status": string | null,"extracted_text": string | null,"file_name": string,"file_size_bytes": number | null,"id": string,"mime_type": string | null,"opportunity_id": string,"storage_path": string,"superseded_at": string | null,"superseded_by_hand": boolean,"superseded_reason": string | null,"uploaded_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_summary"?: string | null,"content_sha256"?: string | null,"doc_type"?: string | null,"drive_file_id"?: string | null,"drive_folder_path"?: string | null,"drive_modified_at"?: string | null,"drive_published_id"?: string | null,"duplicate_of"?: string | null,"embedding_status"?: string | null,"extracted_text"?: string | null,"file_name": string,"file_size_bytes"?: number | null,"id"?: string,"mime_type"?: string | null,"opportunity_id": string,"storage_path": string,"superseded_at"?: string | null,"superseded_by_hand"?: boolean,"superseded_reason"?: string | null,"uploaded_at"?: string | null
                  }
                  Update: {
                    "ai_summary"?: string | null,"content_sha256"?: string | null,"doc_type"?: string | null,"drive_file_id"?: string | null,"drive_folder_path"?: string | null,"drive_modified_at"?: string | null,"drive_published_id"?: string | null,"duplicate_of"?: string | null,"embedding_status"?: string | null,"extracted_text"?: string | null,"file_name"?: string,"file_size_bytes"?: number | null,"id"?: string,"mime_type"?: string | null,"opportunity_id"?: string,"storage_path"?: string,"superseded_at"?: string | null,"superseded_by_hand"?: boolean,"superseded_reason"?: string | null,"uploaded_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "opportunity_documents_duplicate_of_fkey"
      columns: ["duplicate_of"]
isOneToOne: false
      referencedRelation: "opportunity_documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "opportunity_documents_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    }
                  ]
                },"opportunity_notes": {
                  Row: {
                    "author": string | null,"body": string,"created_at": string | null,"id": string,"opportunity_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body": string,"created_at"?: string | null,"id"?: string,"opportunity_id": string
                  }
                  Update: {
                    "author"?: string | null,"body"?: string,"created_at"?: string | null,"id"?: string,"opportunity_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "opportunity_notes_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    }
                  ]
                },"org_nodes": {
                  Row: {
                    "created_at": string | null,"entity_type": string | null,"id": string,"kind": string,"location": string | null,"name": string,"note": string | null,"parent_id": string | null,"sort_order": number,"updated_at": string | null,"vertical": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"entity_type"?: string | null,"id"?: string,"kind"?: string,"location"?: string | null,"name": string,"note"?: string | null,"parent_id"?: string | null,"sort_order"?: number,"updated_at"?: string | null,"vertical"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"entity_type"?: string | null,"id"?: string,"kind"?: string,"location"?: string | null,"name"?: string,"note"?: string | null,"parent_id"?: string | null,"sort_order"?: number,"updated_at"?: string | null,"vertical"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_nodes_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    }
                  ]
                },"org_people": {
                  Row: {
                    "created_at": string | null,"departed_on": string | null,"detail": string | null,"id": string,"name": string | null,"node_id": string | null,"personnel_id": string | null,"role": string,"sort_order": number,"status": string,"tier": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"departed_on"?: string | null,"detail"?: string | null,"id"?: string,"name"?: string | null,"node_id"?: string | null,"personnel_id"?: string | null,"role": string,"sort_order"?: number,"status"?: string,"tier"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"departed_on"?: string | null,"detail"?: string | null,"id"?: string,"name"?: string | null,"node_id"?: string | null,"personnel_id"?: string | null,"role"?: string,"sort_order"?: number,"status"?: string,"tier"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_people_node_id_fkey"
      columns: ["node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_people_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    }
                  ]
                },"org_roles": {
                  Row: {
                    "appointed_by": string | null,"appointing_resolution_id": string | null,"authority_note": string | null,"bank_signatory": boolean,"can_bind_surety": boolean,"can_sign_contracts": boolean,"created_at": string | null,"effective_from": string,"effective_to": string | null,"end_reason": string | null,"ending_resolution_id": string | null,"id": string,"is_director": boolean,"is_manager": boolean,"is_officer": boolean,"note": string | null,"org_node_id": string | null,"org_node_name": string | null,"org_person_id": string | null,"party_id": string | null,"person_name": string,"personnel_id": string | null,"signing_limit": number | null,"title": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "appointed_by"?: string | null,"appointing_resolution_id"?: string | null,"authority_note"?: string | null,"bank_signatory"?: boolean,"can_bind_surety"?: boolean,"can_sign_contracts"?: boolean,"created_at"?: string | null,"effective_from": string,"effective_to"?: string | null,"end_reason"?: string | null,"ending_resolution_id"?: string | null,"id"?: string,"is_director"?: boolean,"is_manager"?: boolean,"is_officer"?: boolean,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"org_person_id"?: string | null,"party_id"?: string | null,"person_name": string,"personnel_id"?: string | null,"signing_limit"?: number | null,"title": string,"updated_at"?: string | null
                  }
                  Update: {
                    "appointed_by"?: string | null,"appointing_resolution_id"?: string | null,"authority_note"?: string | null,"bank_signatory"?: boolean,"can_bind_surety"?: boolean,"can_sign_contracts"?: boolean,"created_at"?: string | null,"effective_from"?: string,"effective_to"?: string | null,"end_reason"?: string | null,"ending_resolution_id"?: string | null,"id"?: string,"is_director"?: boolean,"is_manager"?: boolean,"is_officer"?: boolean,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"org_person_id"?: string | null,"party_id"?: string | null,"person_name"?: string,"personnel_id"?: string | null,"signing_limit"?: number | null,"title"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_roles_appointing_resolution_id_fkey"
      columns: ["appointing_resolution_id"]
isOneToOne: false
      referencedRelation: "resolutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_roles_ending_resolution_id_fkey"
      columns: ["ending_resolution_id"]
isOneToOne: false
      referencedRelation: "resolutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_roles_org_node_id_fkey"
      columns: ["org_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_roles_org_person_id_fkey"
      columns: ["org_person_id"]
isOneToOne: false
      referencedRelation: "org_people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_roles_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_roles_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    }
                  ]
                },"ownership_interests": {
                  Row: {
                    "acquired_from_id": string | null,"authorizing_resolution_id": string | null,"capital_contributed": number | null,"certificate_number": string | null,"class": string,"consideration": number | null,"created_at": string | null,"effective_from": string,"effective_to": string | null,"holder_entity_id": string | null,"holder_name": string,"holder_node_id": string | null,"holder_party_id": string | null,"id": string,"investor_id": string | null,"note": string | null,"org_node_id": string,"org_node_name": string | null,"percent": number | null,"units": number | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "acquired_from_id"?: string | null,"authorizing_resolution_id"?: string | null,"capital_contributed"?: number | null,"certificate_number"?: string | null,"class"?: string,"consideration"?: number | null,"created_at"?: string | null,"effective_from": string,"effective_to"?: string | null,"holder_entity_id"?: string | null,"holder_name": string,"holder_node_id"?: string | null,"holder_party_id"?: string | null,"id"?: string,"investor_id"?: string | null,"note"?: string | null,"org_node_id": string,"org_node_name"?: string | null,"percent"?: number | null,"units"?: number | null,"updated_at"?: string | null
                  }
                  Update: {
                    "acquired_from_id"?: string | null,"authorizing_resolution_id"?: string | null,"capital_contributed"?: number | null,"certificate_number"?: string | null,"class"?: string,"consideration"?: number | null,"created_at"?: string | null,"effective_from"?: string,"effective_to"?: string | null,"holder_entity_id"?: string | null,"holder_name"?: string,"holder_node_id"?: string | null,"holder_party_id"?: string | null,"id"?: string,"investor_id"?: string | null,"note"?: string | null,"org_node_id"?: string,"org_node_name"?: string | null,"percent"?: number | null,"units"?: number | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ownership_interests_acquired_from_id_fkey"
      columns: ["acquired_from_id"]
isOneToOne: false
      referencedRelation: "ownership_interests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ownership_interests_authorizing_resolution_id_fkey"
      columns: ["authorizing_resolution_id"]
isOneToOne: false
      referencedRelation: "resolutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ownership_interests_holder_entity_id_fkey"
      columns: ["holder_entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ownership_interests_holder_node_id_fkey"
      columns: ["holder_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ownership_interests_holder_party_id_fkey"
      columns: ["holder_party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ownership_interests_investor_id_fkey"
      columns: ["investor_id"]
isOneToOne: false
      referencedRelation: "investors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ownership_interests_org_node_id_fkey"
      columns: ["org_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    }
                  ]
                },"parties": {
                  Row: {
                    "avatar_url": string | null,"company": string | null,"created_at": string | null,"email": string | null,"enrichment_conflicts": Json | null,"enrichment_notes": Json | null,"full_name": string,"google_contacts": NonNullable<Json>,"google_contacts_hash": string | null,"government_contract_history": string | null,"graph_enriched_at": string | null,"id": string,"is_organization": boolean | null,"linkedin_url": string | null,"perplexity_enriched_at": string | null,"phone": string | null,"relationship_notes": string | null,"status": string,"tags": (string)[],"title": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"company"?: string | null,"created_at"?: string | null,"email"?: string | null,"enrichment_conflicts"?: Json | null,"enrichment_notes"?: Json | null,"full_name": string,"google_contacts"?: NonNullable<Json>,"google_contacts_hash"?: string | null,"government_contract_history"?: string | null,"graph_enriched_at"?: string | null,"id"?: string,"is_organization"?: boolean | null,"linkedin_url"?: string | null,"perplexity_enriched_at"?: string | null,"phone"?: string | null,"relationship_notes"?: string | null,"status"?: string,"tags"?: (string)[],"title"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "avatar_url"?: string | null,"company"?: string | null,"created_at"?: string | null,"email"?: string | null,"enrichment_conflicts"?: Json | null,"enrichment_notes"?: Json | null,"full_name"?: string,"google_contacts"?: NonNullable<Json>,"google_contacts_hash"?: string | null,"government_contract_history"?: string | null,"graph_enriched_at"?: string | null,"id"?: string,"is_organization"?: boolean | null,"linkedin_url"?: string | null,"perplexity_enriched_at"?: string | null,"phone"?: string | null,"relationship_notes"?: string | null,"status"?: string,"tags"?: (string)[],"title"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"party_entities": {
                  Row: {
                    "created_at": string | null,"entity_id": string,"id": string,"is_primary": boolean | null,"party_id": string,"role": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"entity_id": string,"id"?: string,"is_primary"?: boolean | null,"party_id": string,"role"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"entity_id"?: string,"id"?: string,"is_primary"?: boolean | null,"party_id"?: string,"role"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "party_entities_entity_id_fkey"
      columns: ["entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "party_entities_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    }
                  ]
                },"pepper_note_items": {
                  Row: {
                    "created_at": string,"first_named_on": string,"id": string,"item_key": string,"kind": string,"last_named_on": string,"team_member_id": string,"times_named": number,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"first_named_on": string,"id"?: string,"item_key": string,"kind": string,"last_named_on": string,"team_member_id": string,"times_named"?: number,"updated_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"first_named_on"?: string,"id"?: string,"item_key"?: string,"kind"?: string,"last_named_on"?: string,"team_member_id"?: string,"times_named"?: number,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pepper_note_items_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"personnel": {
                  Row: {
                    "classification": string,"created_at": string | null,"employing_entity_id": string | null,"employing_entity_name": string | null,"engaged_on": string | null,"full_name": string,"id": string,"legal_hold": boolean,"legal_hold_reason": string | null,"org_person_id": string | null,"party_id": string | null,"rehire_eligible": boolean | null,"retention_until": string | null,"separated_on": string | null,"separation_notice_on": string | null,"separation_type": string | null,"status": string | null,"team_member_id": string | null,"title": string | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "classification"?: string,"created_at"?: string | null,"employing_entity_id"?: string | null,"employing_entity_name"?: string | null,"engaged_on"?: string | null,"full_name": string,"id"?: string,"legal_hold"?: boolean,"legal_hold_reason"?: string | null,"org_person_id"?: string | null,"party_id"?: string | null,"rehire_eligible"?: boolean | null,"retention_until"?: string | null,"separated_on"?: string | null,"separation_notice_on"?: string | null,"separation_type"?: string | null,"status"?: never,"team_member_id"?: string | null,"title"?: string | null,"updated_at"?: string | null
                  }
                  Update: {
                    "classification"?: string,"created_at"?: string | null,"employing_entity_id"?: string | null,"employing_entity_name"?: string | null,"engaged_on"?: string | null,"full_name"?: string,"id"?: string,"legal_hold"?: boolean,"legal_hold_reason"?: string | null,"org_person_id"?: string | null,"party_id"?: string | null,"rehire_eligible"?: boolean | null,"retention_until"?: string | null,"separated_on"?: string | null,"separation_notice_on"?: string | null,"separation_type"?: string | null,"status"?: never,"team_member_id"?: string | null,"title"?: string | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "personnel_employing_entity_id_fkey"
      columns: ["employing_entity_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "personnel_org_person_id_fkey"
      columns: ["org_person_id"]
isOneToOne: false
      referencedRelation: "org_people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "personnel_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "personnel_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"personnel_agreements": {
                  Row: {
                    "consideration": number | null,"created_at": string | null,"document_id": string | null,"effective_from": string | null,"expires_on": string | null,"id": string,"kind": string,"note": string | null,"personnel_id": string,"signed_on": string | null,"updated_at": string | null,"version": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "consideration"?: number | null,"created_at"?: string | null,"document_id"?: string | null,"effective_from"?: string | null,"expires_on"?: string | null,"id"?: string,"kind": string,"note"?: string | null,"personnel_id": string,"signed_on"?: string | null,"updated_at"?: string | null,"version"?: string | null
                  }
                  Update: {
                    "consideration"?: number | null,"created_at"?: string | null,"document_id"?: string | null,"effective_from"?: string | null,"expires_on"?: string | null,"id"?: string,"kind"?: string,"note"?: string | null,"personnel_id"?: string,"signed_on"?: string | null,"updated_at"?: string | null,"version"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "personnel_agreements_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "personnel_agreements_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    }
                  ]
                },"personnel_note_kinds": {
                  Row: {
                    "active": boolean,"created_at": string | null,"description": string | null,"id": string,"key": string,"label": string,"requires_document": boolean,"sensitive": boolean,"sort_order": number,"system": boolean,"tone": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string | null,"description"?: string | null,"id"?: string,"key": string,"label": string,"requires_document"?: boolean,"sensitive"?: boolean,"sort_order"?: number,"system"?: boolean,"tone"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string | null,"description"?: string | null,"id"?: string,"key"?: string,"label"?: string,"requires_document"?: boolean,"sensitive"?: boolean,"sort_order"?: number,"system"?: boolean,"tone"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"personnel_notes": {
                  Row: {
                    "author": string | null,"body": string,"confidential": boolean,"created_at": string | null,"document_id": string | null,"effective_on": string | null,"id": string,"kind": string,"personnel_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body": string,"confidential"?: boolean,"created_at"?: string | null,"document_id"?: string | null,"effective_on"?: string | null,"id"?: string,"kind": string,"personnel_id": string
                  }
                  Update: {
                    "author"?: string | null,"body"?: string,"confidential"?: boolean,"created_at"?: string | null,"document_id"?: string | null,"effective_on"?: string | null,"id"?: string,"kind"?: string,"personnel_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "personnel_notes_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "personnel_notes_kind_fkey"
      columns: ["kind"]
isOneToOne: false
      referencedRelation: "personnel_note_kinds"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "personnel_notes_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    }
                  ]
                },"personnel_offboarding": {
                  Row: {
                    "category": string,"completed_at": string | null,"completed_by": string | null,"created_at": string | null,"id": string,"label": string,"note": string | null,"personnel_id": string,"required": boolean,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string | null,"id"?: string,"label": string,"note"?: string | null,"personnel_id": string,"required"?: boolean,"sort_order"?: number
                  }
                  Update: {
                    "category"?: string,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string | null,"id"?: string,"label"?: string,"note"?: string | null,"personnel_id"?: string,"required"?: boolean,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "personnel_offboarding_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    }
                  ]
                },"policies": {
                  Row: {
                    "acknowledgement_cadence": string,"adopted_by_resolution_id": string | null,"category": string,"created_at": string | null,"document_id": string | null,"effective_from": string | null,"id": string,"name": string,"requires_acknowledgement": boolean,"retired_on": string | null,"summary": string | null,"updated_at": string | null,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledgement_cadence"?: string,"adopted_by_resolution_id"?: string | null,"category"?: string,"created_at"?: string | null,"document_id"?: string | null,"effective_from"?: string | null,"id"?: string,"name": string,"requires_acknowledgement"?: boolean,"retired_on"?: string | null,"summary"?: string | null,"updated_at"?: string | null,"version": string
                  }
                  Update: {
                    "acknowledgement_cadence"?: string,"adopted_by_resolution_id"?: string | null,"category"?: string,"created_at"?: string | null,"document_id"?: string | null,"effective_from"?: string | null,"id"?: string,"name"?: string,"requires_acknowledgement"?: boolean,"retired_on"?: string | null,"summary"?: string | null,"updated_at"?: string | null,"version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "policies_adopted_by_resolution_id_fkey"
      columns: ["adopted_by_resolution_id"]
isOneToOne: false
      referencedRelation: "resolutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policies_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"policy_acknowledgements": {
                  Row: {
                    "acknowledged_on": string,"created_at": string | null,"document_id": string | null,"id": string,"method": string,"note": string | null,"person_name": string,"personnel_id": string | null,"policy_id": string,"team_member_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_on": string,"created_at"?: string | null,"document_id"?: string | null,"id"?: string,"method"?: string,"note"?: string | null,"person_name": string,"personnel_id"?: string | null,"policy_id": string,"team_member_id"?: string | null
                  }
                  Update: {
                    "acknowledged_on"?: string,"created_at"?: string | null,"document_id"?: string | null,"id"?: string,"method"?: string,"note"?: string | null,"person_name"?: string,"personnel_id"?: string | null,"policy_id"?: string,"team_member_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "policy_acknowledgements_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_acknowledgements_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_acknowledgements_policy_id_fkey"
      columns: ["policy_id"]
isOneToOne: false
      referencedRelation: "policies"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "policy_acknowledgements_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"portfolio_briefs": {
                  Row: {
                    "brief_type": string,"content": string,"created_at": string,"generated_by": string,"id": string,"model_used": string | null,"project_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brief_type": string,"content": string,"created_at"?: string,"generated_by"?: string,"id"?: string,"model_used"?: string | null,"project_id"?: string | null
                  }
                  Update: {
                    "brief_type"?: string,"content"?: string,"created_at"?: string,"generated_by"?: string,"id"?: string,"model_used"?: string | null,"project_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "portfolio_briefs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_dependencies": {
                  Row: {
                    "created_at": string,"dependency_type": string,"description": string | null,"downstream_project_id": string,"id": string,"resolved_at": string | null,"severity": string,"status": string,"updated_at": string,"upstream_project_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dependency_type"?: string,"description"?: string | null,"downstream_project_id": string,"id"?: string,"resolved_at"?: string | null,"severity"?: string,"status"?: string,"updated_at"?: string,"upstream_project_id": string
                  }
                  Update: {
                    "created_at"?: string,"dependency_type"?: string,"description"?: string | null,"downstream_project_id"?: string,"id"?: string,"resolved_at"?: string | null,"severity"?: string,"status"?: string,"updated_at"?: string,"upstream_project_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_dependencies_downstream_project_id_fkey"
      columns: ["downstream_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_dependencies_upstream_project_id_fkey"
      columns: ["upstream_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_parcels": {
                  Row: {
                    "acres": number | null,"assessor_acres": number | null,"centroid_lat": number | null,"centroid_lng": number | null,"color": string | null,"created_at": string,"existing_zone": string | null,"geometry": Json | null,"geometry_asof": string | null,"geometry_source": string | null,"id": string,"label": string | null,"notes": string | null,"opportunity_id": string | null,"owner_name": string | null,"parcel_id": string,"project_id": string | null,"requested_zone": string | null,"sort_order": number,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "acres"?: number | null,"assessor_acres"?: number | null,"centroid_lat"?: number | null,"centroid_lng"?: number | null,"color"?: string | null,"created_at"?: string,"existing_zone"?: string | null,"geometry"?: Json | null,"geometry_asof"?: string | null,"geometry_source"?: string | null,"id"?: string,"label"?: string | null,"notes"?: string | null,"opportunity_id"?: string | null,"owner_name"?: string | null,"parcel_id": string,"project_id"?: string | null,"requested_zone"?: string | null,"sort_order"?: number,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "acres"?: number | null,"assessor_acres"?: number | null,"centroid_lat"?: number | null,"centroid_lng"?: number | null,"color"?: string | null,"created_at"?: string,"existing_zone"?: string | null,"geometry"?: Json | null,"geometry_asof"?: string | null,"geometry_source"?: string | null,"id"?: string,"label"?: string | null,"notes"?: string | null,"opportunity_id"?: string | null,"owner_name"?: string | null,"parcel_id"?: string,"project_id"?: string | null,"requested_zone"?: string | null,"sort_order"?: number,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_parcels_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_parcels_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_players": {
                  Row: {
                    "created_at": string | null,"id": string,"is_primary": boolean | null,"notes": string | null,"opportunity_id": string | null,"party_id": string,"project_id": string | null,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"id"?: string,"is_primary"?: boolean | null,"notes"?: string | null,"opportunity_id"?: string | null,"party_id": string,"project_id"?: string | null,"role": string
                  }
                  Update: {
                    "created_at"?: string | null,"id"?: string,"is_primary"?: boolean | null,"notes"?: string | null,"opportunity_id"?: string | null,"party_id"?: string,"project_id"?: string | null,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_players_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_players_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_players_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_spv_participants": {
                  Row: {
                    "capital_committed": number | null,"capital_funded": number | null,"class": string,"created_at": string,"equity_pct": number | null,"holder_entity_id": string | null,"holder_name": string,"holder_party_id": string | null,"id": string,"investor_id": string | null,"is_ber_wilson": boolean,"note": string | null,"preferred_return_pct": number | null,"profit_share_pct": number | null,"role": string,"sort_order": number,"spv_id": string,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "capital_committed"?: number | null,"capital_funded"?: number | null,"class"?: string,"created_at"?: string,"equity_pct"?: number | null,"holder_entity_id"?: string | null,"holder_name": string,"holder_party_id"?: string | null,"id"?: string,"investor_id"?: string | null,"is_ber_wilson"?: boolean,"note"?: string | null,"preferred_return_pct"?: number | null,"profit_share_pct"?: number | null,"role"?: string,"sort_order"?: number,"spv_id": string,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "capital_committed"?: number | null,"capital_funded"?: number | null,"class"?: string,"created_at"?: string,"equity_pct"?: number | null,"holder_entity_id"?: string | null,"holder_name"?: string,"holder_party_id"?: string | null,"id"?: string,"investor_id"?: string | null,"is_ber_wilson"?: boolean,"note"?: string | null,"preferred_return_pct"?: number | null,"profit_share_pct"?: number | null,"role"?: string,"sort_order"?: number,"spv_id"?: string,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_spv_participants_holder_entity_id_fkey"
      columns: ["holder_entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_spv_participants_holder_party_id_fkey"
      columns: ["holder_party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_spv_participants_investor_id_fkey"
      columns: ["investor_id"]
isOneToOne: false
      referencedRelation: "investors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_spv_participants_spv_id_fkey"
      columns: ["spv_id"]
isOneToOne: false
      referencedRelation: "project_spvs"
      referencedColumns: ["id"]
    }
                  ]
                },"project_spvs": {
                  Row: {
                    "bw_ownership_pct": number | null,"created_at": string,"entity_id": string | null,"id": string,"jurisdiction": string | null,"label": string,"note": string | null,"opportunity_id": string | null,"org_node_id": string | null,"org_node_name": string | null,"project_id": string | null,"purpose": string,"raise_target": number | null,"sort_order": number,"status": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bw_ownership_pct"?: number | null,"created_at"?: string,"entity_id"?: string | null,"id"?: string,"jurisdiction"?: string | null,"label": string,"note"?: string | null,"opportunity_id"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"project_id"?: string | null,"purpose"?: string,"raise_target"?: number | null,"sort_order"?: number,"status"?: string,"updated_at"?: string | null
                  }
                  Update: {
                    "bw_ownership_pct"?: number | null,"created_at"?: string,"entity_id"?: string | null,"id"?: string,"jurisdiction"?: string | null,"label"?: string,"note"?: string | null,"opportunity_id"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"project_id"?: string | null,"purpose"?: string,"raise_target"?: number | null,"sort_order"?: number,"status"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_spvs_entity_id_fkey"
      columns: ["entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_spvs_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_spvs_org_node_id_fkey"
      columns: ["org_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_spvs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "applicable_standards": Json | null,"award_date": string | null,"bid_decision": string,"bid_due_date": string | null,"capture_lead": string | null,"client_entity": string | null,"competitors": NonNullable<Json>,"confidential": boolean,"contract_type": string | null,"created_at": string | null,"deal_folder_id": string | null,"delivery_method": string | null,"description": string | null,"drive_folder_id": string | null,"drive_folder_url": string | null,"drive_source_folder_id": string | null,"drive_source_folder_url": string | null,"economics_capture_value": number | null,"economics_computed_at": string | null,"economics_status": string | null,"estimated_value": number | null,"id": string,"incumbent": string | null,"latitude": number | null,"location": string | null,"longitude": number | null,"map_geometry": Json | null,"map_icon": string | null,"match_aliases": (string)[],"name": string,"ntp_date": string | null,"parent_project_id": string | null,"sector": Database["public"]['Enums']["project_sector"],"solicitation_number": string | null,"stage": Database["public"]['Enums']["project_stage"] | null,"status": Database["public"]['Enums']["project_status"] | null,"substantial_completion_date": string | null,"updated_at": string | null,"win_probability": number | null,"win_strategy": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "applicable_standards"?: Json | null,"award_date"?: string | null,"bid_decision"?: string,"bid_due_date"?: string | null,"capture_lead"?: string | null,"client_entity"?: string | null,"competitors"?: NonNullable<Json>,"confidential"?: boolean,"contract_type"?: string | null,"created_at"?: string | null,"deal_folder_id"?: string | null,"delivery_method"?: string | null,"description"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"drive_source_folder_id"?: string | null,"drive_source_folder_url"?: string | null,"economics_capture_value"?: number | null,"economics_computed_at"?: string | null,"economics_status"?: string | null,"estimated_value"?: number | null,"id"?: string,"incumbent"?: string | null,"latitude"?: number | null,"location"?: string | null,"longitude"?: number | null,"map_geometry"?: Json | null,"map_icon"?: string | null,"match_aliases"?: (string)[],"name": string,"ntp_date"?: string | null,"parent_project_id"?: string | null,"sector": Database["public"]['Enums']["project_sector"],"solicitation_number"?: string | null,"stage"?: Database["public"]['Enums']["project_stage"] | null,"status"?: Database["public"]['Enums']["project_status"] | null,"substantial_completion_date"?: string | null,"updated_at"?: string | null,"win_probability"?: number | null,"win_strategy"?: string | null
                  }
                  Update: {
                    "applicable_standards"?: Json | null,"award_date"?: string | null,"bid_decision"?: string,"bid_due_date"?: string | null,"capture_lead"?: string | null,"client_entity"?: string | null,"competitors"?: NonNullable<Json>,"confidential"?: boolean,"contract_type"?: string | null,"created_at"?: string | null,"deal_folder_id"?: string | null,"delivery_method"?: string | null,"description"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"drive_source_folder_id"?: string | null,"drive_source_folder_url"?: string | null,"economics_capture_value"?: number | null,"economics_computed_at"?: string | null,"economics_status"?: string | null,"estimated_value"?: number | null,"id"?: string,"incumbent"?: string | null,"latitude"?: number | null,"location"?: string | null,"longitude"?: number | null,"map_geometry"?: Json | null,"map_icon"?: string | null,"match_aliases"?: (string)[],"name"?: string,"ntp_date"?: string | null,"parent_project_id"?: string | null,"sector"?: Database["public"]['Enums']["project_sector"],"solicitation_number"?: string | null,"stage"?: Database["public"]['Enums']["project_stage"] | null,"status"?: Database["public"]['Enums']["project_status"] | null,"substantial_completion_date"?: string | null,"updated_at"?: string | null,"win_probability"?: number | null,"win_strategy"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_parent_project_id_fkey"
      columns: ["parent_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"proposal_intake_sessions": {
                  Row: {
                    "confirmed_action": string | null,"confirmed_at": string | null,"confirmed_project_id": string | null,"created_at": string | null,"expires_at": string | null,"extraction_result": NonNullable<Json>,"fit_assessment": Json | null,"id": string,"match_candidates": Json | null,"status": string,"uploaded_files": NonNullable<Json>,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_action"?: string | null,"confirmed_at"?: string | null,"confirmed_project_id"?: string | null,"created_at"?: string | null,"expires_at"?: string | null,"extraction_result": NonNullable<Json>,"fit_assessment"?: Json | null,"id"?: string,"match_candidates"?: Json | null,"status"?: string,"uploaded_files": NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "confirmed_action"?: string | null,"confirmed_at"?: string | null,"confirmed_project_id"?: string | null,"created_at"?: string | null,"expires_at"?: string | null,"extraction_result"?: NonNullable<Json>,"fit_assessment"?: Json | null,"id"?: string,"match_candidates"?: Json | null,"status"?: string,"uploaded_files"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "proposal_intake_sessions_confirmed_project_id_fkey"
      columns: ["confirmed_project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"raises": {
                  Row: {
                    "created_at": string | null,"id": string,"name": string,"notes": string | null,"open_date": string | null,"project_id": string | null,"status": string,"target_amount": number | null,"target_close_date": string | null,"target_kind": string,"tranches": NonNullable<Json>,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"open_date"?: string | null,"project_id"?: string | null,"status"?: string,"target_amount"?: number | null,"target_close_date"?: string | null,"target_kind"?: string,"tranches"?: NonNullable<Json>,"updated_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"open_date"?: string | null,"project_id"?: string | null,"status"?: string,"target_amount"?: number | null,"target_close_date"?: string | null,"target_kind"?: string,"tranches"?: NonNullable<Json>,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "raises_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"record_identifiers": {
                  Row: {
                    "created_at": string | null,"id": string,"kind": string,"normalized": string,"record_id": string,"record_kind": string,"source_thread_id": string | null,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string | null,"id"?: string,"kind": string,"normalized": string,"record_id": string,"record_kind": string,"source_thread_id"?: string | null,"value": string
                  }
                  Update: {
                    "created_at"?: string | null,"id"?: string,"kind"?: string,"normalized"?: string,"record_id"?: string,"record_kind"?: string,"source_thread_id"?: string | null,"value"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "record_identifiers_source_thread_id_fkey"
      columns: ["source_thread_id"]
isOneToOne: false
      referencedRelation: "email_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"related_party_transactions": {
                  Row: {
                    "amount": number | null,"approved_by": string | null,"arms_length_basis": string | null,"counterparty_entity_id": string | null,"counterparty_name": string,"counterparty_party_id": string | null,"created_at": string | null,"disclosed_in": string | null,"document_id": string | null,"ended_on": string | null,"id": string,"nature": string | null,"note": string | null,"org_node_id": string | null,"org_node_name": string | null,"period": string | null,"project_id": string | null,"relationship": string,"resolution_id": string | null,"started_on": string | null,"status": string,"title": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"approved_by"?: string | null,"arms_length_basis"?: string | null,"counterparty_entity_id"?: string | null,"counterparty_name": string,"counterparty_party_id"?: string | null,"created_at"?: string | null,"disclosed_in"?: string | null,"document_id"?: string | null,"ended_on"?: string | null,"id"?: string,"nature"?: string | null,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"period"?: string | null,"project_id"?: string | null,"relationship": string,"resolution_id"?: string | null,"started_on"?: string | null,"status"?: string,"title": string,"updated_at"?: string | null
                  }
                  Update: {
                    "amount"?: number | null,"approved_by"?: string | null,"arms_length_basis"?: string | null,"counterparty_entity_id"?: string | null,"counterparty_name"?: string,"counterparty_party_id"?: string | null,"created_at"?: string | null,"disclosed_in"?: string | null,"document_id"?: string | null,"ended_on"?: string | null,"id"?: string,"nature"?: string | null,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"period"?: string | null,"project_id"?: string | null,"relationship"?: string,"resolution_id"?: string | null,"started_on"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "related_party_transactions_counterparty_entity_id_fkey"
      columns: ["counterparty_entity_id"]
isOneToOne: false
      referencedRelation: "entities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "related_party_transactions_counterparty_party_id_fkey"
      columns: ["counterparty_party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "related_party_transactions_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "related_party_transactions_org_node_id_fkey"
      columns: ["org_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "related_party_transactions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "related_party_transactions_resolution_id_fkey"
      columns: ["resolution_id"]
isOneToOne: false
      referencedRelation: "resolutions"
      referencedColumns: ["id"]
    }
                  ]
                },"research_artifacts": {
                  Row: {
                    "id": string,"model_used": string | null,"opportunity_id": string | null,"project_id": string | null,"query_text": string,"response_text": string,"retrieved_at": string | null,"source_urls": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"model_used"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"query_text": string,"response_text": string,"retrieved_at"?: string | null,"source_urls"?: Json | null
                  }
                  Update: {
                    "id"?: string,"model_used"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"query_text"?: string,"response_text"?: string,"retrieved_at"?: string | null,"source_urls"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "research_artifacts_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "research_artifacts_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"resolutions": {
                  Row: {
                    "adopted_on": string,"adopting_body": string,"created_at": string | null,"document_id": string | null,"effective_on": string | null,"id": string,"kind": string,"meeting_id": string | null,"note": string | null,"org_node_id": string | null,"org_node_name": string | null,"recusals": (string)[],"reference": string | null,"signature_status": string,"signed_on": string | null,"superseded_by_resolution_id": string | null,"text_body": string | null,"title": string,"updated_at": string | null,"votes_abstain": number | null,"votes_against": number | null,"votes_for": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "adopted_on": string,"adopting_body"?: string,"created_at"?: string | null,"document_id"?: string | null,"effective_on"?: string | null,"id"?: string,"kind"?: string,"meeting_id"?: string | null,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"recusals"?: (string)[],"reference"?: string | null,"signature_status"?: string,"signed_on"?: string | null,"superseded_by_resolution_id"?: string | null,"text_body"?: string | null,"title": string,"updated_at"?: string | null,"votes_abstain"?: number | null,"votes_against"?: number | null,"votes_for"?: number | null
                  }
                  Update: {
                    "adopted_on"?: string,"adopting_body"?: string,"created_at"?: string | null,"document_id"?: string | null,"effective_on"?: string | null,"id"?: string,"kind"?: string,"meeting_id"?: string | null,"note"?: string | null,"org_node_id"?: string | null,"org_node_name"?: string | null,"recusals"?: (string)[],"reference"?: string | null,"signature_status"?: string,"signed_on"?: string | null,"superseded_by_resolution_id"?: string | null,"text_body"?: string | null,"title"?: string,"updated_at"?: string | null,"votes_abstain"?: number | null,"votes_against"?: number | null,"votes_for"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "resolutions_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resolutions_meeting_id_fkey"
      columns: ["meeting_id"]
isOneToOne: false
      referencedRelation: "meetings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resolutions_org_node_id_fkey"
      columns: ["org_node_id"]
isOneToOne: false
      referencedRelation: "org_nodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "resolutions_superseded_by_resolution_id_fkey"
      columns: ["superseded_by_resolution_id"]
isOneToOne: false
      referencedRelation: "resolutions"
      referencedColumns: ["id"]
    }
                  ]
                },"review_queue": {
                  Row: {
                    "ai_explanation": string | null,"confidence": number | null,"created_at": string | null,"edit_diff": Json | null,"id": string,"project_id": string | null,"reason": string,"record_id": string,"resolution": string | null,"resolved_at": string | null,"reviewed_by": string | null,"source_table": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_explanation"?: string | null,"confidence"?: number | null,"created_at"?: string | null,"edit_diff"?: Json | null,"id"?: string,"project_id"?: string | null,"reason": string,"record_id": string,"resolution"?: string | null,"resolved_at"?: string | null,"reviewed_by"?: string | null,"source_table": string
                  }
                  Update: {
                    "ai_explanation"?: string | null,"confidence"?: number | null,"created_at"?: string | null,"edit_diff"?: Json | null,"id"?: string,"project_id"?: string | null,"reason"?: string,"record_id"?: string,"resolution"?: string | null,"resolved_at"?: string | null,"reviewed_by"?: string | null,"source_table"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_queue_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"risk_scores": {
                  Row: {
                    "breakdown": NonNullable<Json>,"computed_at": string,"id": string,"project_id": string,"score": number
                  }
                  ComputedFields: never
                  Insert: {
                    "breakdown"?: NonNullable<Json>,"computed_at"?: string,"id"?: string,"project_id": string,"score": number
                  }
                  Update: {
                    "breakdown"?: NonNullable<Json>,"computed_at"?: string,"id"?: string,"project_id"?: string,"score"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "risk_scores_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"steel_deal_notes": {
                  Row: {
                    "author": string | null,"body": string,"created_at": string | null,"deal_id": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body": string,"created_at"?: string | null,"deal_id": string,"id"?: string
                  }
                  Update: {
                    "author"?: string | null,"body"?: string,"created_at"?: string | null,"deal_id"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "steel_deal_notes_deal_id_fkey"
      columns: ["deal_id"]
isOneToOne: false
      referencedRelation: "steel_deals"
      referencedColumns: ["id"]
    }
                  ]
                },"steel_deal_services": {
                  Row: {
                    "commission_pct": number | null,"commissionable": boolean,"cost": number | null,"cost_per_sqft": number | null,"created_at": string | null,"deal_id": string,"description": string | null,"id": string,"price": number | null,"price_per_sqft": number | null,"service_type": string,"sort_order": number,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "commission_pct"?: number | null,"commissionable"?: boolean,"cost"?: number | null,"cost_per_sqft"?: number | null,"created_at"?: string | null,"deal_id": string,"description"?: string | null,"id"?: string,"price"?: number | null,"price_per_sqft"?: number | null,"service_type": string,"sort_order"?: number,"updated_at"?: string | null
                  }
                  Update: {
                    "commission_pct"?: number | null,"commissionable"?: boolean,"cost"?: number | null,"cost_per_sqft"?: number | null,"created_at"?: string | null,"deal_id"?: string,"description"?: string | null,"id"?: string,"price"?: number | null,"price_per_sqft"?: number | null,"service_type"?: string,"sort_order"?: number,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "steel_deal_services_deal_id_fkey"
      columns: ["deal_id"]
isOneToOne: false
      referencedRelation: "steel_deals"
      referencedColumns: ["id"]
    }
                  ]
                },"steel_deals": {
                  Row: {
                    "building_type": string | null,"buying_trigger": string | null,"collected_date": string | null,"created_at": string | null,"customer": string | null,"description": string | null,"drive_folder_id": string | null,"drive_folder_url": string | null,"drive_source_folder_id": string | null,"drive_source_folder_url": string | null,"expected_delivery_date": string | null,"floors": number | null,"icp_segment": string | null,"id": string,"install_fee": number | null,"install_fee_paid": boolean,"install_fee_paid_date": string | null,"lead_source": string,"lead_source_detail": string | null,"marketer_id": string | null,"name": string,"next_step": string | null,"next_step_date": string | null,"price_per_sqft": number | null,"pricing_below_floor": boolean,"referral_fee_paid": boolean,"referral_fee_paid_date": string | null,"referral_fee_type": string,"referral_fee_value": number | null,"referral_party_id": string | null,"sales_commission_paid": boolean,"sales_commission_paid_date": string | null,"sales_rate_override": number | null,"salesperson_id": string | null,"scope_summary": string | null,"site_address": string | null,"square_feet": number | null,"stage": string,"updated_at": string | null,"value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "building_type"?: string | null,"buying_trigger"?: string | null,"collected_date"?: string | null,"created_at"?: string | null,"customer"?: string | null,"description"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"drive_source_folder_id"?: string | null,"drive_source_folder_url"?: string | null,"expected_delivery_date"?: string | null,"floors"?: number | null,"icp_segment"?: string | null,"id"?: string,"install_fee"?: number | null,"install_fee_paid"?: boolean,"install_fee_paid_date"?: string | null,"lead_source"?: string,"lead_source_detail"?: string | null,"marketer_id"?: string | null,"name": string,"next_step"?: string | null,"next_step_date"?: string | null,"price_per_sqft"?: number | null,"pricing_below_floor"?: boolean,"referral_fee_paid"?: boolean,"referral_fee_paid_date"?: string | null,"referral_fee_type"?: string,"referral_fee_value"?: number | null,"referral_party_id"?: string | null,"sales_commission_paid"?: boolean,"sales_commission_paid_date"?: string | null,"sales_rate_override"?: number | null,"salesperson_id"?: string | null,"scope_summary"?: string | null,"site_address"?: string | null,"square_feet"?: number | null,"stage"?: string,"updated_at"?: string | null,"value"?: number | null
                  }
                  Update: {
                    "building_type"?: string | null,"buying_trigger"?: string | null,"collected_date"?: string | null,"created_at"?: string | null,"customer"?: string | null,"description"?: string | null,"drive_folder_id"?: string | null,"drive_folder_url"?: string | null,"drive_source_folder_id"?: string | null,"drive_source_folder_url"?: string | null,"expected_delivery_date"?: string | null,"floors"?: number | null,"icp_segment"?: string | null,"id"?: string,"install_fee"?: number | null,"install_fee_paid"?: boolean,"install_fee_paid_date"?: string | null,"lead_source"?: string,"lead_source_detail"?: string | null,"marketer_id"?: string | null,"name"?: string,"next_step"?: string | null,"next_step_date"?: string | null,"price_per_sqft"?: number | null,"pricing_below_floor"?: boolean,"referral_fee_paid"?: boolean,"referral_fee_paid_date"?: string | null,"referral_fee_type"?: string,"referral_fee_value"?: number | null,"referral_party_id"?: string | null,"sales_commission_paid"?: boolean,"sales_commission_paid_date"?: string | null,"sales_rate_override"?: number | null,"salesperson_id"?: string | null,"scope_summary"?: string | null,"site_address"?: string | null,"square_feet"?: number | null,"stage"?: string,"updated_at"?: string | null,"value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "steel_deals_marketer_id_fkey"
      columns: ["marketer_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "steel_deals_referral_party_id_fkey"
      columns: ["referral_party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "steel_deals_salesperson_id_fkey"
      columns: ["salesperson_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"steel_marketing_spend": {
                  Row: {
                    "amount": number,"channel": string,"created_at": string | null,"description": string | null,"id": string,"notes": string | null,"spend_month": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number,"channel": string,"created_at"?: string | null,"description"?: string | null,"id"?: string,"notes"?: string | null,"spend_month": string,"updated_at"?: string | null
                  }
                  Update: {
                    "amount"?: number,"channel"?: string,"created_at"?: string | null,"description"?: string | null,"id"?: string,"notes"?: string | null,"spend_month"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"steel_quotes": {
                  Row: {
                    "below_floor": boolean,"created_at": string | null,"deal_id": string,"document_id": string | null,"drive_file_id": string | null,"drive_file_url": string | null,"generated_by": string | null,"id": string,"inputs": NonNullable<Json>,"install_amount": number | null,"install_scope": string | null,"issued_at": string | null,"kit_amount": number | null,"kit_scope": string | null,"quote_number": string,"revision": number,"square_feet": number | null,"started_at": string | null,"status": string,"template_doc_id": string | null,"template_revision_id": string | null,"total": number | null,"updated_at": string | null,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "below_floor"?: boolean,"created_at"?: string | null,"deal_id": string,"document_id"?: string | null,"drive_file_id"?: string | null,"drive_file_url"?: string | null,"generated_by"?: string | null,"id"?: string,"inputs"?: NonNullable<Json>,"install_amount"?: number | null,"install_scope"?: string | null,"issued_at"?: string | null,"kit_amount"?: number | null,"kit_scope"?: string | null,"quote_number"?: string,"revision"?: number,"square_feet"?: number | null,"started_at"?: string | null,"status"?: string,"template_doc_id"?: string | null,"template_revision_id"?: string | null,"total"?: number | null,"updated_at"?: string | null,"valid_until"?: string | null
                  }
                  Update: {
                    "below_floor"?: boolean,"created_at"?: string | null,"deal_id"?: string,"document_id"?: string | null,"drive_file_id"?: string | null,"drive_file_url"?: string | null,"generated_by"?: string | null,"id"?: string,"inputs"?: NonNullable<Json>,"install_amount"?: number | null,"install_scope"?: string | null,"issued_at"?: string | null,"kit_amount"?: number | null,"kit_scope"?: string | null,"quote_number"?: string,"revision"?: number,"square_feet"?: number | null,"started_at"?: string | null,"status"?: string,"template_doc_id"?: string | null,"template_revision_id"?: string | null,"total"?: number | null,"updated_at"?: string | null,"valid_until"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "steel_quotes_deal_id_fkey"
      columns: ["deal_id"]
isOneToOne: false
      referencedRelation: "steel_deals"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "steel_quotes_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "steel_quotes_generated_by_fkey"
      columns: ["generated_by"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"step_up_sessions": {
                  Row: {
                    "auth_user_id": string,"created_at": string | null,"expires_at": string,"factor_id": string | null,"id": string,"ip": string | null,"project_id": string,"user_agent": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id": string,"created_at"?: string | null,"expires_at": string,"factor_id"?: string | null,"id"?: string,"ip"?: string | null,"project_id": string,"user_agent"?: string | null
                  }
                  Update: {
                    "auth_user_id"?: string,"created_at"?: string | null,"expires_at"?: string,"factor_id"?: string | null,"id"?: string,"ip"?: string | null,"project_id"?: string,"user_agent"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "step_up_sessions_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"stored_briefs": {
                  Row: {
                    "brief_type": string,"content": string,"created_at": string,"id": string,"latency_ms": number | null,"metadata": Json | null,"model_used": string | null,"opportunity_id": string | null,"project_id": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "brief_type"?: string,"content": string,"created_at"?: string,"id"?: string,"latency_ms"?: number | null,"metadata"?: Json | null,"model_used"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"title": string
                  }
                  Update: {
                    "brief_type"?: string,"content"?: string,"created_at"?: string,"id"?: string,"latency_ms"?: number | null,"metadata"?: Json | null,"model_used"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stored_briefs_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stored_briefs_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"task_google_links": {
                  Row: {
                    "base_due": string | null,"base_status": string | null,"created_at": string | null,"detach_reason": string | null,"detached_at": string | null,"google_list_id": string,"google_task_id": string,"id": string,"last_error": string | null,"last_synced_at": string | null,"origin": string,"state": string,"task_id": string,"team_member_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_due"?: string | null,"base_status"?: string | null,"created_at"?: string | null,"detach_reason"?: string | null,"detached_at"?: string | null,"google_list_id": string,"google_task_id": string,"id"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"origin"?: string,"state"?: string,"task_id": string,"team_member_id": string
                  }
                  Update: {
                    "base_due"?: string | null,"base_status"?: string | null,"created_at"?: string | null,"detach_reason"?: string | null,"detached_at"?: string | null,"google_list_id"?: string,"google_task_id"?: string,"id"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"origin"?: string,"state"?: string,"task_id"?: string,"team_member_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_google_links_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "task_google_links_team_member_id_fkey"
      columns: ["team_member_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    }
                  ]
                },"task_notes": {
                  Row: {
                    "author": string | null,"body": string,"created_at": string | null,"id": string,"task_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author"?: string | null,"body": string,"created_at"?: string | null,"id"?: string,"task_id": string
                  }
                  Update: {
                    "author"?: string | null,"body"?: string,"created_at"?: string | null,"id"?: string,"task_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "task_notes_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "assignee_id": string | null,"completed_at": string | null,"created_at": string | null,"due_date": string | null,"how": string | null,"id": string,"investor_id": string | null,"lead_id": string | null,"objective_id": string | null,"opportunity_id": string | null,"project_id": string | null,"status": string,"title": string,"updated_at": string | null,"what": string | null,"why": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"completed_at"?: string | null,"created_at"?: string | null,"due_date"?: string | null,"how"?: string | null,"id"?: string,"investor_id"?: string | null,"lead_id"?: string | null,"objective_id"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"status"?: string,"title": string,"updated_at"?: string | null,"what"?: string | null,"why"?: string | null
                  }
                  Update: {
                    "assignee_id"?: string | null,"completed_at"?: string | null,"created_at"?: string | null,"due_date"?: string | null,"how"?: string | null,"id"?: string,"investor_id"?: string | null,"lead_id"?: string | null,"objective_id"?: string | null,"opportunity_id"?: string | null,"project_id"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string | null,"what"?: string | null,"why"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_assignee_id_fkey"
      columns: ["assignee_id"]
isOneToOne: false
      referencedRelation: "team_members"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_investor_id_fkey"
      columns: ["investor_id"]
isOneToOne: false
      referencedRelation: "investors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_objective_id_fkey"
      columns: ["objective_id"]
isOneToOne: false
      referencedRelation: "objectives"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tasks_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "active": boolean,"auth_user_id": string | null,"color": string | null,"created_at": string | null,"deactivated_at": string | null,"deactivated_by": string | null,"email": string | null,"id": string,"is_steel_rep": boolean,"name": string,"party_id": string | null,"personnel_id": string | null,"revoked_grants": Json | null,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"auth_user_id"?: string | null,"color"?: string | null,"created_at"?: string | null,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"email"?: string | null,"id"?: string,"is_steel_rep"?: boolean,"name": string,"party_id"?: string | null,"personnel_id"?: string | null,"revoked_grants"?: Json | null,"role"?: string
                  }
                  Update: {
                    "active"?: boolean,"auth_user_id"?: string | null,"color"?: string | null,"created_at"?: string | null,"deactivated_at"?: string | null,"deactivated_by"?: string | null,"email"?: string | null,"id"?: string,"is_steel_rep"?: boolean,"name"?: string,"party_id"?: string | null,"personnel_id"?: string | null,"revoked_grants"?: Json | null,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_members_party_id_fkey"
      columns: ["party_id"]
isOneToOne: false
      referencedRelation: "parties"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_members_personnel_id_fkey"
      columns: ["personnel_id"]
isOneToOne: false
      referencedRelation: "personnel"
      referencedColumns: ["id"]
    }
                  ]
                },"thread_chunks": {
                  Row: {
                    "attachment_name": string | null,"chunk_index": number,"content": string,"created_at": string | null,"embedding": string | null,"id": string,"source": string,"thread_id": string,"token_count": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attachment_name"?: string | null,"chunk_index": number,"content": string,"created_at"?: string | null,"embedding"?: string | null,"id"?: string,"source"?: string,"thread_id": string,"token_count"?: number | null
                  }
                  Update: {
                    "attachment_name"?: string | null,"chunk_index"?: number,"content"?: string,"created_at"?: string | null,"embedding"?: string | null,"id"?: string,"source"?: string,"thread_id"?: string,"token_count"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "thread_chunks_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "email_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"thread_clusters": {
                  Row: {
                    "confirmed_at": string | null,"created_at": string | null,"first_at": string | null,"id": string,"label": string | null,"last_at": string | null,"opportunity_id": string | null,"participants": (string)[] | null,"project_id": string | null,"reason": string | null,"session_id": string | null,"state": string,"thread_count": number | null,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_at"?: string | null,"created_at"?: string | null,"first_at"?: string | null,"id"?: string,"label"?: string | null,"last_at"?: string | null,"opportunity_id"?: string | null,"participants"?: (string)[] | null,"project_id"?: string | null,"reason"?: string | null,"session_id"?: string | null,"state"?: string,"thread_count"?: number | null,"updated_at"?: string | null
                  }
                  Update: {
                    "confirmed_at"?: string | null,"created_at"?: string | null,"first_at"?: string | null,"id"?: string,"label"?: string | null,"last_at"?: string | null,"opportunity_id"?: string | null,"participants"?: (string)[] | null,"project_id"?: string | null,"reason"?: string | null,"session_id"?: string | null,"state"?: string,"thread_count"?: number | null,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "thread_clusters_opportunity_id_fkey"
      columns: ["opportunity_id"]
isOneToOne: false
      referencedRelation: "opportunities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "thread_clusters_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "thread_clusters_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "email_intake_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"thread_links": {
                  Row: {
                    "applied_message_count": number,"attachments_through": number,"certainty": string,"confidence": number | null,"created_at": string | null,"id": string,"last_applied_at": string | null,"reason": string | null,"record_id": string,"record_kind": string,"thread_id": string,"updated_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_message_count"?: number,"attachments_through"?: number,"certainty"?: string,"confidence"?: number | null,"created_at"?: string | null,"id"?: string,"last_applied_at"?: string | null,"reason"?: string | null,"record_id": string,"record_kind": string,"thread_id": string,"updated_at"?: string | null
                  }
                  Update: {
                    "applied_message_count"?: number,"attachments_through"?: number,"certainty"?: string,"confidence"?: number | null,"created_at"?: string | null,"id"?: string,"last_applied_at"?: string | null,"reason"?: string | null,"record_id"?: string,"record_kind"?: string,"thread_id"?: string,"updated_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "thread_links_thread_id_fkey"
      columns: ["thread_id"]
isOneToOne: false
      referencedRelation: "email_threads"
      referencedColumns: ["id"]
    }
                  ]
                },"updates": {
                  Row: {
                    "confidence": number | null,"created_at": string | null,"decisions": Json | null,"embedding_status": string | null,"id": string,"mentioned_parties": NonNullable<Json>,"mentioned_projects": NonNullable<Json>,"project_id": string | null,"raw_content": string | null,"review_state": Database["public"]['Enums']["review_state"] | null,"reviewed_at": string | null,"reviewed_by": string | null,"risks": Json | null,"source": Database["public"]['Enums']["update_source"],"source_ref": string | null,"summary": string | null,"waiting_on": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confidence"?: number | null,"created_at"?: string | null,"decisions"?: Json | null,"embedding_status"?: string | null,"id"?: string,"mentioned_parties"?: NonNullable<Json>,"mentioned_projects"?: NonNullable<Json>,"project_id"?: string | null,"raw_content"?: string | null,"review_state"?: Database["public"]['Enums']["review_state"] | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"risks"?: Json | null,"source": Database["public"]['Enums']["update_source"],"source_ref"?: string | null,"summary"?: string | null,"waiting_on"?: Json | null
                  }
                  Update: {
                    "confidence"?: number | null,"created_at"?: string | null,"decisions"?: Json | null,"embedding_status"?: string | null,"id"?: string,"mentioned_parties"?: NonNullable<Json>,"mentioned_projects"?: NonNullable<Json>,"project_id"?: string | null,"raw_content"?: string | null,"review_state"?: Database["public"]['Enums']["review_state"] | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"risks"?: Json | null,"source"?: Database["public"]['Enums']["update_source"],"source_ref"?: string | null,"summary"?: string | null,"waiting_on"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "updates_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "match_chunks":
{ Args: { "filter_after"?: string,"filter_company_only"?: boolean,"filter_entity_ids"?: (string)[],"filter_exclude_project_ids"?: (string)[],"filter_include_company"?: boolean,"filter_opportunity_ids"?: (string)[],"filter_project_ids"?: (string)[],"match_count"?: number,"query_embedding": string }; Returns: {
              "chunk_index": number,"content": string,"created_at": string,"document_id": string,"entity_id": string,"id": string,"investor_id": string,"is_company": boolean,"opportunity_id": string,"party_id": string,"project_id": string,"similarity": number,"source_confidence": number,"source_type": string,"token_count": number,"update_id": string
            }[]
                           },
"match_parties_by_name":
{ Args: { "search_name": string,"threshold"?: number }; Returns: {
              "full_name": string,"id": string,"similarity": number
            }[]
                           },
"match_projects_by_name":
{ Args: { "search_name": string,"threshold"?: number }; Returns: {
              "id": string,"name": string,"similarity": number
            }[]
                           },
"match_thread_chunks":
{ Args: { "filter_after"?: string,"filter_mailbox"?: string,"match_count"?: number,"query_embedding": string }; Returns: {
              "attachment_name": string,"chunk_index": number,"content": string,"gmail_thread_id": string,"id": string,"last_at": string,"mailbox": string,"participants": (string)[],"similarity": number,"source": string,"subject": string,"thread_id": string
            }[]
                           },
"show_limit":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"show_trgm":
{ Args: { "": string }; Returns: (string)[]
                           },
"wipe_all_data":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           }
          }
          Enums: {
            "compliance_status": "not_started"|"in_progress"|"compliant"|"non_compliant"|"waived","dd_severity": "info"|"watch"|"critical"|"blocker","entity_category": "vendor"|"partner"|"contractor","entity_type": "llc"|"corp"|"jv"|"subsidiary"|"trust"|"fund"|"other","project_sector": "government"|"infrastructure"|"real_estate"|"prefab"|"institutional"|"technology"|"health","project_stage": "pursuit"|"capture"|"bid"|"award"|"mobilization"|"execution"|"closeout","project_status": "active"|"on_hold"|"won"|"lost"|"closed","review_state": "pending"|"approved"|"rejected","update_source": "email"|"manual_paste"|"document"|"agent"|"procore"|"manual_task"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "compliance_status": ["not_started", "in_progress", "compliant", "non_compliant", "waived"],"dd_severity": ["info", "watch", "critical", "blocker"],"entity_category": ["vendor", "partner", "contractor"],"entity_type": ["llc", "corp", "jv", "subsidiary", "trust", "fund", "other"],"project_sector": ["government", "infrastructure", "real_estate", "prefab", "institutional", "technology", "health"],"project_stage": ["pursuit", "capture", "bid", "award", "mobilization", "execution", "closeout"],"project_status": ["active", "on_hold", "won", "lost", "closed"],"review_state": ["pending", "approved", "rejected"],"update_source": ["email", "manual_paste", "document", "agent", "procore", "manual_task"]
          }
        }
} as const
