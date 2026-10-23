create extension if not exists pg_cron;
do $$ begin
  if exists(select 1 from cron.job where jobname='reader-workspace-cleanup') then perform cron.unschedule('reader-workspace-cleanup'); end if;
end $$;
select cron.schedule('reader-workspace-cleanup','17 * * * *','select public.reader_workspace_housekeeping()');
