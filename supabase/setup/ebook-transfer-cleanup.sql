-- Run after deploying cleanup-ebook-transfers and setting the same random
-- secret in Edge Function EBOOK_CLEANUP_SECRET and Vault ebook_cleanup_secret.
-- No service-role key is stored in this job or sent to a browser.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'ebook_cleanup_secret') then
    raise exception 'Create Vault secret ebook_cleanup_secret first';
  end if;
  if exists (select 1 from cron.job where jobname = 'cleanup-ebook-transfers') then
    perform cron.unschedule('cleanup-ebook-transfers');
  end if;
end;
$$;
select cron.schedule('cleanup-ebook-transfers', '* * * * *', $job$
  select net.http_post(
    url := 'https://nwcprblwytxqgheflnfy.supabase.co/functions/v1/cleanup-ebook-transfers',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'ebook_cleanup_secret' limit 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
