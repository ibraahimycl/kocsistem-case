begin;

-- Eski policy'leri kaldır
drop policy if exists columns_insert_editors on public.columns;
drop policy if exists columns_update_editors on public.columns;
drop policy if exists columns_delete_editors on public.columns;

-- Sadece board kurucusu sütun ekleyebilsin
create policy columns_insert_owner_only
on public.columns
for insert
to authenticated
with check (
  exists (
    select 1
    from public.boards b
    where b.id = public.columns.board_id
      and b.created_by = auth.uid()
  )
);

-- Sadece board kurucusu sütun güncelleyebilsin (rename/order vb.)
create policy columns_update_owner_only
on public.columns
for update
to authenticated
using (
  exists (
    select 1
    from public.boards b
    where b.id = public.columns.board_id
      and b.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.boards b
    where b.id = public.columns.board_id
      and b.created_by = auth.uid()
  )
);

-- Sadece board kurucusu sütun silebilsin
create policy columns_delete_owner_only
on public.columns
for delete
to authenticated
using (
  exists (
    select 1
    from public.boards b
    where b.id = public.columns.board_id
      and b.created_by = auth.uid()
  )
);

commit;