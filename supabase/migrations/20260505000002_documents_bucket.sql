-- Create documents storage bucket (private — accessed via service role only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,  -- 50 MB limit
  ARRAY[
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/html',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for documents bucket (service role bypasses RLS, so these cover anon/authenticated access)
CREATE POLICY "documents_auth_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents');

CREATE POLICY "documents_auth_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents');

CREATE POLICY "documents_auth_update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'documents');

CREATE POLICY "documents_auth_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'documents');
