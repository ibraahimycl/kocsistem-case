-- 14.sql: board_members tablosu için Realtime desteği

begin;

alter table public.board_members replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.board_members;
  exception
    when duplicate_object then null;
  end;
end $$;

commit;
