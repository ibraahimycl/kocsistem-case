import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function POST(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;
  const body = await request.json();
  const columnId = body?.columnId;
  const beforeColumnId = body?.beforeColumnId ?? null;

  if (!columnId) {
    return fail("columnId is required", 422);
  }

  const { data: board, error: boardError } = await auth.supabase
    .from("boards")
    .select("id, created_by")
    .eq("id", boardId)
    .single();

  if (boardError) {
    return fail(boardError.message, 400);
  }

  if (board.created_by !== auth.user.id) {
    return fail("Only board owner can reorder columns", 403);
  }

  const { data: columns, error: columnsError } = await auth.supabase
    .from("columns")
    .select("id, order_index")
    .eq("board_id", boardId)
    .order("order_index", { ascending: true });

  if (columnsError) {
    return fail(columnsError.message, 400);
  }

  const filtered = (columns ?? []).filter((col) => col.id !== columnId);
  let insertIndex = filtered.length;
  if (beforeColumnId) {
    const idx = filtered.findIndex((col) => col.id === beforeColumnId);
    insertIndex = idx >= 0 ? idx : filtered.length;
  }
  filtered.splice(insertIndex, 0, { id: columnId });

  const updates = filtered.map((col, index) => ({
    id: col.id,
    order_index: (index + 1) * 10000,
  }));

  const TEMP_OFFSET = 1000000000;

  // Phase 1: move to temporary non-conflicting range
  for (const update of updates) {
    const { error: updateError } = await auth.supabase
      .from("columns")
      .update({ order_index: update.order_index + TEMP_OFFSET })
      .eq("id", update.id)
      .eq("board_id", boardId);
    if (updateError) {
      return fail(updateError.message, 400);
    }
  }

  // Phase 2: write final target order indexes
  for (const update of updates) {
    const { error: updateError } = await auth.supabase
      .from("columns")
      .update({ order_index: update.order_index })
      .eq("id", update.id)
      .eq("board_id", boardId);
    if (updateError) {
      return fail(updateError.message, 400);
    }
  }

  return ok({ success: true });
}
