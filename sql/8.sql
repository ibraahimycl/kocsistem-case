begin;

create extension if not exists pgcrypto;

create or replace function public.reset_board_room_password(
  p_board_id uuid,
  p_new_room_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_new_room_password is null or char_length(p_new_room_password) < 6 then
    raise exception 'Room password must be at least 6 characters';
  end if;

  update public.boards b
  set room_password_hash = extensions.crypt(p_new_room_password, extensions.gen_salt('bf')),
      updated_at = now()
  where b.id = p_board_id
    and b.created_by = v_uid;

  if not found then
    raise exception 'Only board owner can reset room password';
  end if;

  return true;
end;
$$;

grant execute on function public.reset_board_room_password(uuid, text) to authenticated;

commit;
