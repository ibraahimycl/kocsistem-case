begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'display_name'
  ) then
    update public.profiles
    set display_name = coalesce(nullif(trim(display_name), ''), 'Unknown User')
    where display_name is null or trim(display_name) = '';

    alter table public.profiles
      alter column display_name set not null;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'profiles_display_name_not_blank'
    ) then
      alter table public.profiles
        add constraint profiles_display_name_not_blank
        check (char_length(trim(display_name)) >= 2);
    end if;
  end if;
end $$;

commit;
