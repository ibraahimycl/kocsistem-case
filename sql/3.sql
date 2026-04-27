begin;

create extension if not exists pgcrypto;

create or replace function public.create_board_with_room(
  p_name text,
  p_room_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_board_id uuid;
  v_room_code text;
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_name is null or char_length(trim(p_name)) < 2 then
    raise exception 'Board name is too short';
  end if;

  if p_room_password is null or char_length(p_room_password) < 6 then
    raise exception 'Room password must be at least 6 characters';
  end if;

  v_room_code := public.generate_room_code(6);

  insert into public.boards (name, room_code, room_password_hash, created_by)
  values (
    trim(p_name),
    v_room_code,
    extensions.crypt(p_room_password, extensions.gen_salt('bf')),
    v_uid
  )
  returning id into v_board_id;

  insert into public.board_members (board_id, user_id, role, status, approved_by, approved_at)
  values (v_board_id, v_uid, 'admin', 'active', v_uid, now());

  insert into public.columns (board_id, name, order_index, created_by)
  values
    (v_board_id, 'Backlog', 10000, v_uid),
    (v_board_id, 'In Progress', 20000, v_uid),
    (v_board_id, 'Done', 30000, v_uid);

  return v_board_id;
end;
$$;

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
  values (v_board_id, v_uid, p_role, 'pending')
  on conflict (board_id, user_id)
  do update set
    role = excluded.role,
    status = case
      when public.board_members.status = 'active' then 'active'
      else 'pending'
    end,
    approved_by = case
      when public.board_members.status = 'active' then public.board_members.approved_by
      else null
    end,
    approved_at = case
      when public.board_members.status = 'active' then public.board_members.approved_at
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
