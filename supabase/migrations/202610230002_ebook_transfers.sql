-- Temporary, single-recipient ebook handoff. Files are removed through the
-- Storage API, never by deleting storage.objects directly.
create table if not exists public.reader_ebook_transfers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sender_device uuid not null,
  slug text not null check (slug ~ '^ebook-[a-f0-9]{24}$'),
  title text not null check (length(title) between 1 and 250),
  bytes integer not null check (bytes between 1 and 52428800),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  received_at timestamptz
);
create index if not exists reader_ebook_transfers_owner on public.reader_ebook_transfers(user_id, created_at);
alter table public.reader_ebook_transfers enable row level security;
revoke all on public.reader_ebook_transfers from public, anon, authenticated;
grant select on public.reader_ebook_transfers to authenticated;
grant all on public.reader_ebook_transfers to service_role;
grant insert (id, sender_device, slug, title, bytes, sha256) on public.reader_ebook_transfers to authenticated;
grant update (ready) on public.reader_ebook_transfers to authenticated;
drop policy if exists ebook_transfer_owner on public.reader_ebook_transfers;
create policy ebook_transfer_owner on public.reader_ebook_transfers to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.reader_ebook_received(transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.reader_ebook_transfers set received_at = coalesce(received_at, now())
  where id = transfer_id and user_id = (select auth.uid()) and ready and expires_at > now();
  if not found then raise exception 'Transfer expired or unavailable' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.reader_ebook_received(uuid) from public, anon;
grant execute on function public.reader_ebook_received(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ebook-transfers', 'ebook-transfers', false, 52428800, array['application/zip'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/zip'];

drop policy if exists ebook_transfer_upload on storage.objects;
create policy ebook_transfer_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'ebook-transfers' and exists (
    select 1 from public.reader_ebook_transfers t where t.user_id = (select auth.uid())
      and name = t.user_id::text || '/' || t.id::text || '/book.zip'
      and not t.ready and t.received_at is null and t.expires_at > now()
  )
);
drop policy if exists ebook_transfer_download on storage.objects;
create policy ebook_transfer_download on storage.objects for select to authenticated using (
  bucket_id = 'ebook-transfers'
  and storage.allow_any_operation(array['object.get_authenticated', 'object.get_authenticated_info', 'object.head_authenticated_info']) and exists (
    select 1 from public.reader_ebook_transfers t where t.user_id = (select auth.uid())
      and name = t.user_id::text || '/' || t.id::text || '/book.zip'
      and t.ready and t.received_at is null and t.expires_at > now()
  )
);
-- Storage remove requires SELECT as well as DELETE. Permit listing/removal
-- of one's expired/received objects, but not downloading them.
drop policy if exists ebook_transfer_cleanup_select on storage.objects;
create policy ebook_transfer_cleanup_select on storage.objects for select to authenticated using (
  bucket_id = 'ebook-transfers' and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.allow_any_operation(array['object.list', 'object.delete', 'object.delete_many'])
);
drop policy if exists ebook_transfer_delete on storage.objects;
create policy ebook_transfer_delete on storage.objects for delete to authenticated using (
  bucket_id = 'ebook-transfers' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Keep metadata until the Storage API has really removed the object.
create or replace function public.reader_ebook_forget(transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reader_ebook_transfers t where t.id = transfer_id and t.user_id = (select auth.uid())
    and not exists (select 1 from storage.objects o where o.bucket_id = 'ebook-transfers'
      and o.name = t.user_id::text || '/' || t.id::text || '/book.zip');
  if not found then raise exception 'Remove the temporary object first' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.reader_ebook_forget(uuid) from public, anon;
grant execute on function public.reader_ebook_forget(uuid) to authenticated;

-- Admin only: includes orphan uploads (e.g. deleted account), as well as
-- receipts/expired sessions. The worker deletes bytes via Storage API first.
create or replace function public.reader_ebook_cleanup_candidates()
returns table (object_path text, transfer_id uuid)
language sql security definer set search_path = '' as $$
  select t.user_id::text || '/' || t.id::text || '/book.zip', t.id
  from public.reader_ebook_transfers t where t.received_at is not null or t.expires_at <= now()
  union all
  select o.name, null::uuid from storage.objects o
  where o.bucket_id = 'ebook-transfers' and o.created_at <= now() - interval '30 minutes'
    and not exists (select 1 from public.reader_ebook_transfers t
      where o.name = t.user_id::text || '/' || t.id::text || '/book.zip')
  limit 100;
$$;
revoke all on function public.reader_ebook_cleanup_candidates() from public, anon, authenticated;
grant execute on function public.reader_ebook_cleanup_candidates() to service_role;
