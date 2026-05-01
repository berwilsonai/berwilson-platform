-- Add linkedin_url and avatar_url to parties
ALTER TABLE public.parties
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create avatars storage bucket (public so URLs work in <img> tags)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB limit
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for avatars bucket
CREATE POLICY "avatars_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_write"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'avatars');
