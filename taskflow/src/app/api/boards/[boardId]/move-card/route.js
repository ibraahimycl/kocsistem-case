import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function POST(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;
  const body = await request.json();
  const cardId = body?.cardId;
  const toColumnId = body?.toColumnId;
  const beforeCardId = body?.beforeCardId ?? null;
  const mutationId = body?.mutationId ?? null;

  if (!cardId || !toColumnId) {
    return fail("cardId and toColumnId are required", 422);
  }

  const { data, error } = await auth.supabase.rpc("move_card_transactional", {
    p_board_id: boardId,
    p_card_id: cardId,
    p_to_column_id: toColumnId,
    p_before_card_id: beforeCardId,
  });

  if (error) {
    return fail(error.message, 400);
  }

  const result = Array.isArray(data) ? data[0] : data;

  return ok({
    success: true,
    mode: result?.mode ?? "single",
    orderIndex: result?.new_order_index ?? null,
    boardRevision: result?.board_revision ?? null,
    actorUserId: result?.actor_user_id ?? null,
    mutationId,
  });
}
