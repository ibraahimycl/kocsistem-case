import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function GET() {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { data, error } = await auth.supabase
    .from("board_members")
    .select("board_id, role, boards(id, name, room_code, created_at)")
    .eq("user_id", auth.user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false, referencedTable: "boards" });

  if (error) {
    return fail(error.message, 400);
  }

  const boards = (data ?? [])
    .map((item) => ({
      id: item.boards?.id,
      name: item.boards?.name,
      roomCode: item.boards?.room_code,
      createdAt: item.boards?.created_at,
      role: item.role,
    }))
    .filter((item) => Boolean(item.id));

  return ok({ boards });
}

export async function POST(request) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json();
  const name = body?.name?.trim();
  const roomPassword = body?.roomPassword;

  if (!name || !roomPassword) {
    return fail("Board name and room password are required", 422);
  }

  const { data, error } = await auth.supabase.rpc("create_board_with_room", {
    p_name: name,
    p_room_password: roomPassword,
  });

  if (error) {
    return fail(error.message, 400);
  }

  return ok({ boardId: data }, 201);
}
