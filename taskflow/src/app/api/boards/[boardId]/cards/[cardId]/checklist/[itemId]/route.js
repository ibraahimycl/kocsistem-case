import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function PATCH(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { itemId } = await params;
  const body = await request.json();

  const updates = {};

  if (typeof body?.title === "string") {
    const title = body.title.trim();
    if (!title) {
      return fail("title cannot be empty", 422);
    }
    updates.title = title;
  }

  if (typeof body?.description === "string") {
    updates.description = body.description;
  }

  if (typeof body?.isDone === "boolean") {
    updates.is_done = body.isDone;
  }

  if (typeof body?.orderIndex === "number") {
    updates.order_index = body.orderIndex;
  }

  if (Object.keys(updates).length === 0) {
    return fail("No update field provided", 422);
  }

  const { data, error } = await auth.supabase
    .from("card_checklist_items")
    .update(updates)
    .eq("id", itemId)
    .select("id, card_id, title, description, is_done, order_index")
    .single();

  if (error) {
    return fail(error.message, 400);
  }

  return ok({
    item: {
      id: data.id,
      cardId: data.card_id,
      title: data.title,
      description: data.description,
      isDone: data.is_done,
      orderIndex: data.order_index,
    },
  });
}

export async function DELETE(_request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { itemId } = await params;

  const { error } = await auth.supabase
    .from("card_checklist_items")
    .delete()
    .eq("id", itemId);

  if (error) {
    return fail(error.message, 400);
  }

  return ok({ success: true });
}
