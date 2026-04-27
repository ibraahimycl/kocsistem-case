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
  const title = body?.title?.trim();
  const description = body?.description?.trim() ?? "";
  const startDate = body?.startDate ?? null;
  const dueDate = body?.dueDate ?? null;
  const allowedAccents = new Set(["red", "blue", "green", "pink", "orange"]);
  let accentColor = "blue";
  if (body?.accentColor !== undefined && body.accentColor !== null) {
    const accent = String(body.accentColor).toLowerCase();
    if (!allowedAccents.has(accent)) {
      return fail("accentColor must be one of: red, blue, green, pink, orange", 422);
    }
    accentColor = accent;
  }

  if (!columnId || !title) {
    return fail("columnId and title are required", 422);
  }

  const { data: lastCard, error: lastCardError } = await auth.supabase
    .from("cards")
    .select("order_index")
    .eq("column_id", columnId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastCardError) {
    return fail(lastCardError.message, 400);
  }

  const orderIndex = (lastCard?.order_index ?? 0) + 10000;

  const { data, error } = await auth.supabase
    .from("cards")
    .insert({
      board_id: boardId,
      column_id: columnId,
      title,
      description,
      start_date: startDate,
      due_date: dueDate,
      order_index: orderIndex,
      created_by: auth.user.id,
      accent_color: accentColor,
    })
    .select("id, column_id, order_index, title, description, start_date, due_date, accent_color")
    .single();

  if (error) {
    return fail(error.message, 400);
  }

  return ok(
    {
      card: {
        id: data.id,
        columnId: data.column_id,
        orderIndex: data.order_index,
        title: data.title,
        description: data.description,
        startDate: data.start_date,
        dueDate: data.due_date,
        accentColor: data.accent_color ?? "blue",
      },
    },
    201
  );
}
