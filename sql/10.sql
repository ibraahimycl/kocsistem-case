begin;

drop function if exists public.get_board_members_with_email(uuid);

create or replace function public.get_board_members_with_email(
  p_board_id uuid
)
returns table (
  id bigint,
  user_id uuid,
  display_name text,
  email text,
  role member_role,
  status member_status,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.board_members bm
    where bm.board_id = p_board_id
      and bm.user_id = v_uid
      and bm.status = 'active'::member_status
      and bm.role in ('admin'::member_role, 'editor'::member_role)
  ) then
    raise exception 'Not allowed to view member emails';
  end if;

  return query
  select
    bm.id,
    bm.user_id,
    coalesce(
      nullif(trim(p.display_name), ''),
      nullif(trim(coalesce(u.raw_user_meta_data->>'display_name', '')), '')
    )::text as display_name,
    u.email::text,
    bm.role,
    bm.status,
    bm.created_at
  from public.board_members bm
  left join public.profiles p on p.id = bm.user_id
  left join auth.users u on u.id = bm.user_id
  where bm.board_id = p_board_id
  order by bm.created_at desc;
end;
$$;

grant execute on function public.get_board_members_with_email(uuid) to authenticated;

commit;
