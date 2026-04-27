import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function POST(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;
  const body = await request.json();
  const name = body?.name?.trim();

  if (!name) {
    return fail("Column name is required", 422);
  }

  const { data: lastColumn, error: lastColumnError } = await auth.supabase
    .from("columns")
    .select("order_index")
    .eq("board_id", boardId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastColumnError) {
    return fail(lastColumnError.message, 400);
  }

  const orderIndex = (lastColumn?.order_index ?? 0) + 10000;

  const { data, error } = await auth.supabase
    .from("columns")
    .insert({
      board_id: boardId,
      name,
      order_index: orderIndex,
      created_by: auth.user.id,
    })
    .select("id, name, order_index")
    .single();

  if (error) {
    return fail(error.message, 400);
  }

  return ok(
    {
      column: {
        id: data.id,
        name: data.name,
        orderIndex: data.order_index,
        cards: [],
      },
    },
    201
  );
}

export async function PATCH(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;
  const body = await request.json();
  const columnId = body?.columnId;
  const name = body?.name?.trim();

  if (!columnId || !name) {
    return fail("columnId and name are required", 422);
  }

  const { data, error } = await auth.supabase
    .from("columns")
    .update({ name })
    .eq("id", columnId)
    .eq("board_id", boardId)
    .select("id, name")
    .single();

  if (error) {
    return fail(error.message, 400);
  }

  return ok({ column: data });
}

export async function DELETE(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;
  const body = await request.json();
  const columnId = body?.columnId;

  if (!columnId) {
    return fail("columnId is required", 422);
  }

  const { error } = await auth.supabase
    .from("columns")
    .delete()
    .eq("id", columnId)
    .eq("board_id", boardId);

  if (error) {
    return fail(error.message, 400);
  }

  return ok({ success: true });
}
