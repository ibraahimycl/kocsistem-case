begin;

alter table public.cards
  add column if not exists accent_color text not null default 'blue';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cards_accent_color_valid'
  ) then
    alter table public.cards
      add constraint cards_accent_color_valid
      check (accent_color in ('red', 'blue', 'green', 'pink', 'orange'));
  end if;
end $$;

commit;

-- PostgREST / Supabase API şema önbelleğini yenile (DDL sonrası bazen gerekir)
notify pgrst, 'reload schema';
