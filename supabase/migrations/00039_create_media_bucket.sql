-- Create public media bucket for audio/image files sent by leads
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  10485760, -- 10 MB
  array[
    'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav',
    'audio/webm', 'audio/aac', 'audio/x-m4a',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif'
  ]
)
on conflict (id) do nothing;

-- Allow service role to upload/read (no RLS needed for service role)
create policy "Service role full access to media bucket"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'media')
  with check (bucket_id = 'media');
