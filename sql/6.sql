begin;

-- 1) boards.revision ekle
alter table public.boards
  add column if not exists revision bigint not null default 0;

-- 2) Realtime için gerekli ayarlar
alter table public.cards replica identity full;
alter table public.boards replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.cards;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.boards;
  exception
    when duplicate_object then null;
  end;
end $$;

-- 3) move_card_transactional fonksiyonunu revision + actor dönecek şekilde güncelle
drop function if exists public.move_card_transactional(uuid, uuid, uuid, uuid);

create function public.move_card_transactional(
  p_board_id uuid,
  p_card_id uuid,
  p_to_column_id uuid,
  p_before_card_id uuid default null
)
returns table (
  mode text,
  new_order_index bigint,
  board_revision bigint,
  actor_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_step bigint := 10000;
  v_n integer;
  v_insertion_index integer;
  v_before_idx integer;
  v_left bigint;
  v_right bigint;
  v_gap bigint;
  v_radius integer;
  v_start_idx integer;
  v_end_idx integer;
  v_window_count integer;
  v_insert_in_window integer;
  v_left_bound bigint;
  v_right_bound bigint;
  v_dist_step bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.can_edit_board(p_board_id, v_uid) then
    raise exception 'Not allowed to edit this board';
  end if;

  actor_user_id := v_uid;

  perform 1
  from public.cards c
  where c.id = p_card_id and c.board_id = p_board_id
  for update;

  if not found then
    raise exception 'Card not found';
  end if;

  perform 1
  from public.columns col
  where col.id = p_to_column_id and col.board_id = p_board_id;

  if not found then
    raise exception 'Target column not found';
  end if;

  perform 1
  from public.cards c
  where c.board_id = p_board_id
    and c.column_id = p_to_column_id
    and c.id <> p_card_id
  for update;

  select count(*)::int
  into v_n
  from public.cards c
  where c.board_id = p_board_id
    and c.column_id = p_to_column_id
    and c.id <> p_card_id;

  if p_before_card_id is not null then
    select x.idx
    into v_before_idx
    from (
      select c.id,
             row_number() over (order by c.order_index asc, c.id asc) - 1 as idx
      from public.cards c
      where c.board_id = p_board_id
        and c.column_id = p_to_column_id
        and c.id <> p_card_id
    ) x
    where x.id = p_before_card_id;

    if v_before_idx is null then
      v_insertion_index := v_n;
    else
      v_insertion_index := v_before_idx;
    end if;
  else
    v_insertion_index := v_n;
  end if;

  if v_insertion_index > 0 then
    select x.order_index
    into v_left
    from (
      select c.order_index,
             row_number() over (order by c.order_index asc, c.id asc) - 1 as idx
      from public.cards c
      where c.board_id = p_board_id
        and c.column_id = p_to_column_id
        and c.id <> p_card_id
    ) x
    where x.idx = v_insertion_index - 1;
  end if;

  if v_insertion_index < v_n then
    select x.order_index
    into v_right
    from (
      select c.order_index,
             row_number() over (order by c.order_index asc, c.id asc) - 1 as idx
      from public.cards c
      where c.board_id = p_board_id
        and c.column_id = p_to_column_id
        and c.id <> p_card_id
    ) x
    where x.idx = v_insertion_index;
  end if;

  if v_left is not null and v_right is not null then
    v_gap := v_right - v_left;
    if v_gap > 1 then
      new_order_index := floor((v_left + v_right) / 2.0)::bigint;
      update public.cards c
      set column_id = p_to_column_id,
          order_index = new_order_index
      where c.id = p_card_id;
      mode := 'single';
    end if;
  elsif v_left is not null and v_right is null then
    new_order_index := v_left + v_step;
    update public.cards c
    set column_id = p_to_column_id,
        order_index = new_order_index
    where c.id = p_card_id;
    mode := 'single';
  elsif v_left is null and v_right is not null and v_right > 1 then
    new_order_index := floor(v_right / 2.0)::bigint;
    update public.cards c
    set column_id = p_to_column_id,
        order_index = new_order_index
    where c.id = p_card_id;
    mode := 'single';
  elsif v_left is null and v_right is null then
    new_order_index := v_step;
    update public.cards c
    set column_id = p_to_column_id,
        order_index = new_order_index
    where c.id = p_card_id;
    mode := 'single';
  end if;

  if mode is null then
    v_radius := 1;
    while v_radius <= v_n + 1 loop
      v_start_idx := greatest(0, v_insertion_index - v_radius);
      v_end_idx := least(v_n - 1, v_insertion_index + v_radius - 1);

      if v_end_idx < v_start_idx then
        v_window_count := 0;
      else
        v_window_count := v_end_idx - v_start_idx + 1;
      end if;

      v_insert_in_window := v_insertion_index - v_start_idx;

      if v_start_idx > 0 then
        select x.order_index
        into v_left_bound
        from (
          select c.order_index,
                 row_number() over (order by c.order_index asc, c.id asc) - 1 as idx
          from public.cards c
          where c.board_id = p_board_id
            and c.column_id = p_to_column_id
            and c.id <> p_card_id
        ) x
        where x.idx = v_start_idx - 1;
      else
        v_left_bound := 0;
      end if;

      if v_end_idx < v_n - 1 then
        select x.order_index
        into v_right_bound
        from (
          select c.order_index,
                 row_number() over (order by c.order_index asc, c.id asc) - 1 as idx
          from public.cards c
          where c.board_id = p_board_id
            and c.column_id = p_to_column_id
            and c.id <> p_card_id
        ) x
        where x.idx = v_end_idx + 1;
      else
        v_right_bound := null;
      end if;

      if v_right_bound is null then
        update public.cards c
        set order_index = (
          v_left_bound + v_step * (
            case
              when src.local_idx < v_insert_in_window then src.local_idx + 1
              else src.local_idx + 2
            end
          )
        )
        from (
          select x.id, (x.idx - v_start_idx) as local_idx
          from (
            select c2.id,
                   row_number() over (order by c2.order_index asc, c2.id asc) - 1 as idx
            from public.cards c2
            where c2.board_id = p_board_id
              and c2.column_id = p_to_column_id
              and c2.id <> p_card_id
          ) x
          where x.idx between v_start_idx and v_end_idx
        ) src
        where c.id = src.id;

        new_order_index := v_left_bound + v_step * (v_insert_in_window + 1);

        update public.cards c
        set column_id = p_to_column_id,
            order_index = new_order_index
        where c.id = p_card_id;

        mode := 'elastic-window';
        exit;
      else
        v_dist_step := floor((v_right_bound - v_left_bound)::numeric / (v_window_count + 2))::bigint;

        if v_dist_step >= 1 then
          update public.cards c
          set order_index = (
            v_left_bound + v_dist_step * (
              case
                when src.local_idx < v_insert_in_window then src.local_idx + 1
                else src.local_idx + 2
              end
            )
          )
          from (
            select x.id, (x.idx - v_start_idx) as local_idx
            from (
              select c2.id,
                     row_number() over (order by c2.order_index asc, c2.id asc) - 1 as idx
              from public.cards c2
              where c2.board_id = p_board_id
                and c2.column_id = p_to_column_id
                and c2.id <> p_card_id
            ) x
            where x.idx between v_start_idx and v_end_idx
          ) src
          where c.id = src.id;

          new_order_index := v_left_bound + v_dist_step * (v_insert_in_window + 1);

          update public.cards c
          set column_id = p_to_column_id,
              order_index = new_order_index
          where c.id = p_card_id;

          mode := 'elastic-window';
          exit;
        end if;
      end if;

      v_radius := v_radius + 1;
    end loop;
  end if;

  if mode is null then
    update public.cards c
    set order_index = v_step * (
      src.pos +
      case
        when src.pos - 1 >= v_insertion_index then 1
        else 0
      end
    )
    from (
      select c2.id,
             row_number() over (order by c2.order_index asc, c2.id asc) as pos
      from public.cards c2
      where c2.board_id = p_board_id
        and c2.column_id = p_to_column_id
        and c2.id <> p_card_id
    ) src
    where c.id = src.id;

    new_order_index := v_step * (v_insertion_index + 1);

    update public.cards c
    set column_id = p_to_column_id,
        order_index = new_order_index
    where c.id = p_card_id;

    mode := 'global-rebalance';
  end if;

  update public.boards b
  set revision = b.revision + 1
  where b.id = p_board_id
  returning b.revision into board_revision;

  return next;
  return;
end;
$$;

grant execute on function public.move_card_transactional(uuid, uuid, uuid, uuid) to authenticated;

commit;