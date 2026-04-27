import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function GET(_request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;

  const [{ data: board, error: boardError }, { data: columns, error: columnError }] =
    await Promise.all([
      auth.supabase
        .from("boards")
        .select("id, name, room_code, revision, created_by, created_at")
        .eq("id", boardId)
        .single(),
      auth.supabase
        .from("columns")
        .select("id, name, order_index")
        .eq("board_id", boardId)
        .order("order_index", { ascending: true }),
    ]);

  if (boardError) {
    return fail(boardError.message, 400);
  }

  if (columnError) {
    return fail(columnError.message, 400);
  }

  const { data: cards, error: cardError } = await auth.supabase
    .from("cards")
    .select("id, column_id, order_index, title, description, start_date, due_date, accent_color")
    .eq("board_id", boardId)
    .order("order_index", { ascending: true });

  if (cardError) {
    return fail(cardError.message, 400);
  }

  const cardsByColumn = new Map();
  for (const card of cards ?? []) {
    if (!cardsByColumn.has(card.column_id)) {
      cardsByColumn.set(card.column_id, []);
    }
    cardsByColumn.get(card.column_id).push({
      id: card.id,
      title: card.title,
      description: card.description,
      startDate: card.start_date,
      dueDate: card.due_date,
      orderIndex: card.order_index,
      columnId: card.column_id,
      accentColor: card.accent_color ?? "blue",
    });
  }

  const normalizedColumns = (columns ?? []).map((column) => ({
    id: column.id,
    name: column.name,
    orderIndex: column.order_index,
    cards: cardsByColumn.get(column.id) ?? [],
  }));

  return ok({
    board: {
      id: board.id,
      name: board.name,
      roomCode: board.room_code,
      revision: board.revision ?? 0,
      createdBy: board.created_by,
      createdAt: board.created_at,
    },
    columns: normalizedColumns,
  });
}
