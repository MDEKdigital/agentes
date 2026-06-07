-- Create knowledge-documents storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'knowledge-documents',
  'knowledge-documents',
  true,
  52428800,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Only org admins/owners can upload
CREATE POLICY "Membros da org podem fazer upload de documentos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'knowledge-documents' AND
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = (storage.foldername(name))[1]::uuid
    AND om.user_id = auth.uid()
    AND om.role != 'agent'
  )
);

-- All org members can read
CREATE POLICY "Membros da org podem ler documentos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'knowledge-documents' AND
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = (storage.foldername(name))[1]::uuid
    AND om.user_id = auth.uid()
  )
);

-- Only org admins/owners can delete
CREATE POLICY "Administradores da org podem excluir documentos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'knowledge-documents' AND
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = (storage.foldername(name))[1]::uuid
    AND om.user_id = auth.uid()
    AND om.role != 'agent'
  )
);
