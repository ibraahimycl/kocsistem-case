begin;

create or replace function public.request_join_board(
  p_room_code text,
  p_room_password text,
  p_role member_role default 'viewer'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_board_id uuid;
  v_hash text;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_role = 'admin' then
    raise exception 'Cannot request admin role';
  end if;

  select b.id, b.room_password_hash
  into v_board_id, v_hash
  from public.boards b
  where b.room_code = upper(trim(p_room_code));

  if v_board_id is null then
    raise exception 'Invalid room code';
  end if;

  if extensions.crypt(p_room_password, v_hash) <> v_hash then
    raise exception 'Invalid room password';
  end if;

  insert into public.board_members (board_id, user_id, role, status)
  values (v_board_id, v_uid, p_role, 'pending'::member_status)
  on conflict (board_id, user_id)
  do update set
    role = excluded.role,
    status = case
      when public.board_members.status = 'active'::member_status then 'active'::member_status
      else 'pending'::member_status
    end,
    approved_by = case
      when public.board_members.status = 'active'::member_status then public.board_members.approved_by
      else null
    end,
    approved_at = case
      when public.board_members.status = 'active'::member_status then public.board_members.approved_at
      else null
    end,
    updated_at = now();

  insert into public.activity_logs (board_id, actor_user_id, action, metadata)
  values (
    v_board_id,
    v_uid,
    'member_requested',
    jsonb_build_object('requested_role', p_role)
  );

  return v_board_id;
end;
$$;

commit;
