-- Reference documents: standalone docs uploaded to be digested (summary + Q&A),
-- kept in a dedicated reference library, queryable later from Ask Ber AI.
-- Not tied to a project/entity/company — a fourth document scope.

-- 1. documents: mark reference docs + allow the standalone scope.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_reference boolean NOT NULL DEFAULT false;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_scope_check;
ALTER TABLE documents ADD CONSTRAINT documents_scope_check
  CHECK (
    project_id IS NOT NULL
    OR entity_id IS NOT NULL
    OR is_company
    OR is_reference
  );

CREATE INDEX IF NOT EXISTS idx_documents_reference
  ON documents(uploaded_at DESC) WHERE is_reference;

-- 2. agent_conversations: scope a Q&A thread to one reference document.
ALTER TABLE agent_conversations
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES documents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_agent_conversations_document
  ON agent_conversations(document_id) WHERE document_id IS NOT NULL;
