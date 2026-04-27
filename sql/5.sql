begin;

-- 1) Cards tablosuna start_date ekle (varsa dokunma)
alter table public.cards
  add column if not exists start_date timestamptz;

-- 2) Checklist item tablosu
create table if not exists public.card_checklist_items (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 1),
  description text not null default '',
  is_done boolean not null default false,
  order_index bigint not null check (order_index > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, order_index)
);

-- 3) Performans indexleri
create index if not exists idx_checklist_card_order
  on public.card_checklist_items(card_id, order_index);

create index if not exists idx_checklist_card_done
  on public.card_checklist_items(card_id, is_done);

-- 4) updated_at trigger
drop trigger if exists trg_card_checklist_items_updated_at on public.card_checklist_items;
create trigger trg_card_checklist_items_updated_at
before update on public.card_checklist_items
for each row execute function public.set_updated_at();

-- 5) RLS aktif et
alter table public.card_checklist_items enable row level security;

-- 6) RLS policy: SELECT (active member)
drop policy if exists checklist_select_active_member on public.card_checklist_items;
create policy checklist_select_active_member
on public.card_checklist_items
for select
to authenticated
using (
  exists (
    select 1
    from public.cards c
    where c.id = card_checklist_items.card_id
      and public.is_board_active_member(c.board_id)
  )
);

-- 7) RLS policy: INSERT (editor/admin)
drop policy if exists checklist_insert_editors on public.card_checklist_items;
create policy checklist_insert_editors
on public.card_checklist_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.cards c
    where c.id = card_checklist_items.card_id
      and public.can_edit_board(c.board_id)
  )
);

-- 8) RLS policy: UPDATE (editor/admin)
drop policy if exists checklist_update_editors on public.card_checklist_items;
create policy checklist_update_editors
on public.card_checklist_items
for update
to authenticated
using (
  exists (
    select 1
    from public.cards c
    where c.id = card_checklist_items.card_id
      and public.can_edit_board(c.board_id)
  )
)
with check (
  exists (
    select 1
    from public.cards c
    where c.id = card_checklist_items.card_id
      and public.can_edit_board(c.board_id)
  )
);

-- 9) RLS policy: DELETE (editor/admin)
drop policy if exists checklist_delete_editors on public.card_checklist_items;
create policy checklist_delete_editors
on public.card_checklist_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.cards c
    where c.id = card_checklist_items.card_id
      and public.can_edit_board(c.board_id)
  )
);

commit;