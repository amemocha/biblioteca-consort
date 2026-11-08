create table if not exists public.consorte_documents (
id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
parent_id text, name text not null, kind text not null default 'other',
record_type text not null check (record_type in ('folder','file')),
instrument text not null default '', song text not null default '', category text not null default '',
cover text not null default '', score_id text, tab_id text, audio_id text, object_path text,
created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index if not exists consorte_documents_user_idx on public.consorte_documents(user_id,updated_at);
alter table public.consorte_documents enable row level security;
drop policy if exists "consorte read own" on public.consorte_documents;
drop policy if exists "consorte insert own" on public.consorte_documents;
drop policy if exists "consorte update own" on public.consorte_documents;
drop policy if exists "consorte delete own" on public.consorte_documents;
create policy "consorte read own" on public.consorte_documents for select to authenticated using (auth.uid()=user_id);
create policy "consorte insert own" on public.consorte_documents for insert to authenticated with check (auth.uid()=user_id);
create policy "consorte update own" on public.consorte_documents for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "consorte delete own" on public.consorte_documents for delete to authenticated using (auth.uid()=user_id);
insert into storage.buckets(id,name,public,file_size_limit)
values ('consorte-private','consorte-private',false,52428800)
on conflict (id) do nothing;
drop policy if exists "consorte own storage read" on storage.objects;
drop policy if exists "consorte own storage insert" on storage.objects;
drop policy if exists "consorte own storage update" on storage.objects;
drop policy if exists "consorte own storage delete" on storage.objects;
create policy "consorte own storage read" on storage.objects for select to authenticated
using (bucket_id='consorte-private' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "consorte own storage insert" on storage.objects for insert to authenticated
with check (bucket_id='consorte-private' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "consorte own storage update" on storage.objects for update to authenticated
using (bucket_id='consorte-private' and (storage.foldername(name))[1]=(select auth.uid()::text))
with check (bucket_id='consorte-private' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "consorte own storage delete" on storage.objects for delete to authenticated
using (bucket_id='consorte-private' and (storage.foldername(name))[1]=(select auth.uid()::text));