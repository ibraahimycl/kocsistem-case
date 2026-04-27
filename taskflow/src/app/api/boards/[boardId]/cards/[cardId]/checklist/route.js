import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function GET(_request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { cardId } = await params;

  const { data, error } = await auth.supabase
    .from("card_checklist_items")
    .select("id, card_id, title, description, is_done, order_index")
    .eq("card_id", cardId)
    .order("order_index", { ascending: true });

  if (error) {
    return fail(error.message, 400);
  }

  return ok({
    checklist: (data ?? []).map((item) => ({
      id: item.id,
      cardId: item.card_id,
      title: item.title,
      description: item.description,
      isDone: item.is_done,
      orderIndex: item.order_index,
    })),
  });
}

export async function POST(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { cardId } = await params;
  const body = await request.json();
  const title = body?.title?.trim();
  const description = body?.description?.trim() ?? "";

  if (!title) {
    return fail("title is required", 422);
  }

  const { data: lastItem, error: lastItemError } = await auth.supabase
    .from("card_checklist_items")
    .select("order_index")
    .eq("card_id", cardId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastItemError) {
    return fail(lastItemError.message, 400);
  }

  const orderIndex = (lastItem?.order_index ?? 0) + 10000;

  const { data, error } = await auth.supabase
    .from("card_checklist_items")
    .insert({
      card_id: cardId,
      title,
      description,
      is_done: false,
      order_index: orderIndex,
    })
    .select("id, card_id, title, description, is_done, order_index")
    .single();

  if (error) {
    return fail(error.message, 400);
  }

  return ok(
    {
      item: {
        id: data.id,
        cardId: data.card_id,
        title: data.title,
        description: data.description,
        isDone: data.is_done,
        orderIndex: data.order_index,
      },
    },
    201
  );
}
