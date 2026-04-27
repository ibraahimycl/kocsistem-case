import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function GET(_request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId, cardId } = await params;

  const { data: card, error: cardError } = await auth.supabase
    .from("cards")
    .select(
      "id, board_id, column_id, order_index, title, description, start_date, due_date, accent_color"
    )
    .eq("id", cardId)
    .eq("board_id", boardId)
    .single();

  if (cardError) {
    return fail(cardError.message, 400);
  }

  const { data: checklist, error: checklistError } = await auth.supabase
    .from("card_checklist_items")
    .select("id, card_id, title, description, is_done, order_index")
    .eq("card_id", cardId)
    .order("order_index", { ascending: true });

  if (checklistError) {
    return fail(checklistError.message, 400);
  }

  return ok({
    card: {
      id: card.id,
      boardId: card.board_id,
      columnId: card.column_id,
      orderIndex: card.order_index,
      title: card.title,
      description: card.description,
      startDate: card.start_date,
      dueDate: card.due_date,
      accentColor: card.accent_color ?? "blue",
    },
    checklist: (checklist ?? []).map((item) => ({
      id: item.id,
      cardId: item.card_id,
      title: item.title,
      description: item.description,
      isDone: item.is_done,
      orderIndex: item.order_index,
    })),
  });
}

export async function PATCH(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId, cardId } = await params;
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

  if (body?.startDate !== undefined) {
    updates.start_date = body.startDate || null;
  }

  if (body?.dueDate !== undefined) {
    updates.due_date = body.dueDate || null;
  }

  const allowedAccents = new Set(["red", "blue", "green", "pink", "orange"]);
  if (body?.accentColor !== undefined) {
    const accent = String(body.accentColor).toLowerCase();
    if (!allowedAccents.has(accent)) {
      return fail("accentColor must be one of: red, blue, green, pink, orange", 422);
    }
    updates.accent_color = accent;
  }

  if (Object.keys(updates).length === 0) {
    return fail("No update field provided", 422);
  }

  const { data, error } = await auth.supabase
    .from("cards")
    .update(updates)
    .eq("id", cardId)
    .eq("board_id", boardId)
    .select(
      "id, board_id, column_id, order_index, title, description, start_date, due_date, accent_color"
    )
    .single();

  if (error) {
    return fail(error.message, 400);
  }

  return ok({
    card: {
      id: data.id,
      boardId: data.board_id,
      columnId: data.column_id,
      orderIndex: data.order_index,
      title: data.title,
      description: data.description,
      startDate: data.start_date,
      dueDate: data.due_date,
      accentColor: data.accent_color ?? "blue",
    },
  });
}
