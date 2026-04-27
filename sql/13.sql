-- 13.sql: columns tablosu için Realtime desteği

begin;

alter table public.columns replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.columns;
  exception
    when duplicate_object then null;
  end;
end $$;

commit;
