begin;

-- ------------------------------------------------------------
-- Extensions
-- ------------------------------------------------------------
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_role') then
    create type member_role as enum ('admin', 'editor', 'viewer');
  end if;

  if not exists (select 1 from pg_type where typname = 'member_status') then
    create type member_status as enum ('pending', 'active', 'rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'activity_action') then
    create type activity_action as enum (
      'card_created',
      'card_updated',
      'card_moved',
      'card_deleted',
      'column_created',
      'column_updated',
      'column_deleted',
      'member_requested',
      'member_approved',
      'member_rejected'
    );
  end if;
end $$;

-- ------------------------------------------------------------
-- Utility trigger for updated_at
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Profiles (optional but useful)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Boards
-- ------------------------------------------------------------
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 2),
  room_code text not null unique
    check (room_code ~ '^[A-Z0-9]{4,8}$'),
  room_password_hash text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_boards_updated_at on public.boards;
create trigger trg_boards_updated_at
before update on public.boards
for each row execute function public.set_updated_at();

create index if not exists idx_boards_created_by on public.boards(created_by);

-- ------------------------------------------------------------
-- Board members (pending/active in same table)
-- ------------------------------------------------------------
create table if not exists public.board_members (
  id bigserial primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'viewer',
  status member_status not null default 'pending',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, user_id)
);

drop trigger if exists trg_board_members_updated_at on public.board_members;
create trigger trg_board_members_updated_at
before update on public.board_members
for each row execute function public.set_updated_at();

create index if not exists idx_board_members_board_status
  on public.board_members(board_id, status);

create index if not exists idx_board_members_user
  on public.board_members(user_id);

-- ------------------------------------------------------------
-- Columns
-- ------------------------------------------------------------
create table if not exists public.columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null check (char_length(trim(name)) >= 1),
  order_index bigint not null check (order_index > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, order_index)
);

-- For composite FK from cards(board_id, column_id) -> columns(board_id, id)
create unique index if not exists ux_columns_board_id_id on public.columns(board_id, id);

drop trigger if exists trg_columns_updated_at on public.columns;
create trigger trg_columns_updated_at
before update on public.columns
for each row execute function public.set_updated_at();

create index if not exists idx_columns_board_order
  on public.columns(board_id, order_index);

-- ------------------------------------------------------------
-- Cards
-- ------------------------------------------------------------
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null,
  column_id uuid not null,
  order_index bigint not null check (order_index > 0),
  title text not null check (char_length(trim(title)) >= 1),
  description text not null default '',
  labels jsonb not null default '[]'::jsonb,
  due_date timestamptz,
  assignee_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_cards_column
    foreign key (board_id, column_id)
    references public.columns(board_id, id)
    on delete cascade,
  unique (column_id, order_index)
);

drop trigger if exists trg_cards_updated_at on public.cards;
create trigger trg_cards_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

create index if not exists idx_cards_column_order
  on public.cards(column_id, order_index);

create index if not exists idx_cards_board
  on public.cards(board_id);

create index if not exists idx_cards_assignee
  on public.cards(assignee_id);

-- ------------------------------------------------------------
-- Activity logs
-- ------------------------------------------------------------
create table if not exists public.activity_logs (
  id bigserial primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  card_id uuid references public.cards(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action activity_action not null,
  from_column_id uuid references public.columns(id) on delete set null,
  to_column_id uuid references public.columns(id) on delete set null,
  from_order_index bigint,
  to_order_index bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_logs_board_created
  on public.activity_logs(board_id, created_at desc);

-- ------------------------------------------------------------
-- Helper auth/permission functions (SECURITY DEFINER)
-- ------------------------------------------------------------
create or replace function public.is_board_active_member(p_board_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    where bm.board_id = p_board_id
      and bm.user_id = p_user_id
      and bm.status = 'active'
  );
$$;

create or replace function public.is_board_admin(p_board_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    where bm.board_id = p_board_id
      and bm.user_id = p_user_id
      and bm.status = 'active'
      and bm.role = 'admin'
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    where bm.board_id = p_board_id
      and bm.user_id = p_user_id
      and bm.status = 'active'
      and bm.role in ('admin', 'editor')
  );
$$;

-- ------------------------------------------------------------
-- Room code generator
-- ------------------------------------------------------------
create or replace function public.generate_room_code(p_len int default 6)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_code text := '';
  i int;
begin
  if p_len < 4 then
    p_len := 4;
  end if;

  loop
    out_code := '';
    for i in 1..p_len loop
      out_code := out_code || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    exit when not exists (select 1 from public.boards b where b.room_code = out_code);
  end loop;

  return out_code;
end;
$$;

-- ------------------------------------------------------------
-- RPC: create board + creator becomes active admin + default columns
-- ------------------------------------------------------------
create or replace function public.create_board_with_room(
  p_name text,
  p_room_password text
)
returns uuid
language plpgsql
security definer
set search_path = public
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
    crypt(p_room_password, gen_salt('bf')),
    v_uid
  )
  returning id into v_board_id;

  insert into public.board_members (board_id, user_id, role, status, approved_by, approved_at)
  values (v_board_id, v_uid, 'admin', 'active', v_uid, now());

  -- default columns with spaced bigint ordering
  insert into public.columns (board_id, name, order_index, created_by)
  values
    (v_board_id, 'Backlog', 10000, v_uid),
    (v_board_id, 'In Progress', 20000, v_uid),
    (v_board_id, 'Done', 30000, v_uid);

  return v_board_id;
end;
$$;

-- ------------------------------------------------------------
-- RPC: join request by room code + password
-- ------------------------------------------------------------
create or replace function public.request_join_board(
  p_room_code text,
  p_room_password text,
  p_role member_role default 'viewer'
)
returns uuid
language plpgsql
security definer
set search_path = public
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

  if crypt(p_room_password, v_hash) <> v_hash then
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

-- ------------------------------------------------------------
-- RPC: approve / reject member
-- ------------------------------------------------------------
create or replace function public.approve_board_member(
  p_board_id uuid,
  p_user_id uuid,
  p_role member_role default null
)
returns void
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

  if not public.is_board_admin(p_board_id, v_uid) then
    raise exception 'Only board admin can approve members';
  end if;

  update public.board_members bm
  set
    status = 'active',
    role = coalesce(p_role, bm.role),
    approved_by = v_uid,
    approved_at = now(),
    updated_at = now()
  where bm.board_id = p_board_id
    and bm.user_id = p_user_id;

  if not found then
    raise exception 'Membership request not found';
  end if;

  insert into public.activity_logs (board_id, actor_user_id, action, metadata)
  values (
    p_board_id,
    v_uid,
    'member_approved',
    jsonb_build_object('target_user_id', p_user_id, 'role', coalesce(p_role::text, 'unchanged'))
  );
end;
$$;

create or replace function public.reject_board_member(
  p_board_id uuid,
  p_user_id uuid
)
returns void
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

  if not public.is_board_admin(p_board_id, v_uid) then
    raise exception 'Only board admin can reject members';
  end if;

  update public.board_members bm
  set
    status = 'rejected',
    approved_by = v_uid,
    approved_at = now(),
    updated_at = now()
  where bm.board_id = p_board_id
    and bm.user_id = p_user_id;

  if not found then
    raise exception 'Membership request not found';
  end if;

  insert into public.activity_logs (board_id, actor_user_id, action, metadata)
  values (
    p_board_id,
    v_uid,
    'member_rejected',
    jsonb_build_object('target_user_id', p_user_id)
  );
end;
$$;

-- ------------------------------------------------------------
-- Activity trigger for card movement / create / update / delete
-- ------------------------------------------------------------
create or replace function public.log_card_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();

  if tg_op = 'INSERT' then
    insert into public.activity_logs (
      board_id, card_id, actor_user_id, action, to_column_id, to_order_index, metadata
    )
    values (
      new.board_id, new.id, v_actor, 'card_created', new.column_id, new.order_index,
      jsonb_build_object('title', new.title)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.column_id is distinct from new.column_id
       or old.order_index is distinct from new.order_index then
      insert into public.activity_logs (
        board_id, card_id, actor_user_id, action,
        from_column_id, to_column_id, from_order_index, to_order_index
      )
      values (
        new.board_id, new.id, v_actor, 'card_moved',
        old.column_id, new.column_id, old.order_index, new.order_index
      );
    else
      insert into public.activity_logs (
        board_id, card_id, actor_user_id, action, metadata
      )
      values (
        new.board_id, new.id, v_actor, 'card_updated',
        jsonb_build_object('title_changed', old.title is distinct from new.title)
      );
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.activity_logs (
      board_id, card_id, actor_user_id, action, from_column_id, from_order_index, metadata
    )
    values (
      old.board_id, old.id, v_actor, 'card_deleted', old.column_id, old.order_index,
      jsonb_build_object('title', old.title)
    );
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_cards_activity_insert on public.cards;
create trigger trg_cards_activity_insert
after insert on public.cards
for each row execute function public.log_card_activity();

drop trigger if exists trg_cards_activity_update on public.cards;
create trigger trg_cards_activity_update
after update on public.cards
for each row execute function public.log_card_activity();

drop trigger if exists trg_cards_activity_delete on public.cards;
create trigger trg_cards_activity_delete
after delete on public.cards
for each row execute function public.log_card_activity();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.columns enable row level security;
alter table public.cards enable row level security;
alter table public.activity_logs enable row level security;

-- Profiles policies
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Boards policies
drop policy if exists boards_select_active_member on public.boards;
create policy boards_select_active_member
on public.boards
for select
to authenticated
using (public.is_board_active_member(id));

drop policy if exists boards_insert_creator on public.boards;
create policy boards_insert_creator
on public.boards
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists boards_update_admin on public.boards;
create policy boards_update_admin
on public.boards
for update
to authenticated
using (public.is_board_admin(id))
with check (public.is_board_admin(id));

drop policy if exists boards_delete_admin on public.boards;
create policy boards_delete_admin
on public.boards
for delete
to authenticated
using (public.is_board_admin(id));

-- Board members policies
drop policy if exists members_select_self_or_admin on public.board_members;
create policy members_select_self_or_admin
on public.board_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_board_admin(board_id)
);

drop policy if exists members_insert_pending_self on public.board_members;
create policy members_insert_pending_self
on public.board_members
for insert
to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and role in ('viewer', 'editor')
);

drop policy if exists members_update_admin on public.board_members;
create policy members_update_admin
on public.board_members
for update
to authenticated
using (public.is_board_admin(board_id))
with check (public.is_board_admin(board_id));

drop policy if exists members_delete_self_pending_or_admin on public.board_members;
create policy members_delete_self_pending_or_admin
on public.board_members
for delete
to authenticated
using (
  public.is_board_admin(board_id)
  or (user_id = auth.uid() and status = 'pending')
);

-- Columns policies
drop policy if exists columns_select_active_member on public.columns;
create policy columns_select_active_member
on public.columns
for select
to authenticated
using (public.is_board_active_member(board_id));

drop policy if exists columns_insert_editors on public.columns;
create policy columns_insert_editors
on public.columns
for insert
to authenticated
with check (public.can_edit_board(board_id) and created_by = auth.uid());

drop policy if exists columns_update_editors on public.columns;
create policy columns_update_editors
on public.columns
for update
to authenticated
using (public.can_edit_board(board_id))
with check (public.can_edit_board(board_id));

drop policy if exists columns_delete_editors on public.columns;
create policy columns_delete_editors
on public.columns
for delete
to authenticated
using (public.can_edit_board(board_id));

-- Cards policies
drop policy if exists cards_select_active_member on public.cards;
create policy cards_select_active_member
on public.cards
for select
to authenticated
using (public.is_board_active_member(board_id));

drop policy if exists cards_insert_editors on public.cards;
create policy cards_insert_editors
on public.cards
for insert
to authenticated
with check (public.can_edit_board(board_id) and created_by = auth.uid());

drop policy if exists cards_update_editors on public.cards;
create policy cards_update_editors
on public.cards
for update
to authenticated
using (public.can_edit_board(board_id))
with check (public.can_edit_board(board_id));

drop policy if exists cards_delete_editors on public.cards;
create policy cards_delete_editors
on public.cards
for delete
to authenticated
using (public.can_edit_board(board_id));

-- Activity logs policies
drop policy if exists logs_select_active_member on public.activity_logs;
create policy logs_select_active_member
on public.activity_logs
for select
to authenticated
using (public.is_board_active_member(board_id));

drop policy if exists logs_insert_editors on public.activity_logs;
create policy logs_insert_editors
on public.activity_logs
for insert
to authenticated
with check (public.can_edit_board(board_id));

-- ------------------------------------------------------------
-- Grants (RPC usage)
-- ------------------------------------------------------------
grant usage on schema public to authenticated;
grant execute on function public.create_board_with_room(text, text) to authenticated;
grant execute on function public.request_join_board(text, text, member_role) to authenticated;
grant execute on function public.approve_board_member(uuid, uuid, member_role) to authenticated;
grant execute on function public.reject_board_member(uuid, uuid) to authenticated;
grant execute on function public.generate_room_code(int) to authenticated;

commit;