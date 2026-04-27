import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function POST(request) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json();
  const roomCode = body?.roomCode?.trim()?.toUpperCase();
  const roomPassword = body?.roomPassword;
  const role = body?.role === "editor" ? "editor" : "viewer";

  if (!roomCode || !roomPassword) {
    return fail("Room code and room password are required", 422);
  }

  const { data, error } = await auth.supabase.rpc("request_join_board", {
    p_room_code: roomCode,
    p_room_password: roomPassword,
    p_role: role,
  });

  if (error) {
    return fail(error.message, 400);
  }

  return ok({ boardId: data, status: "pending_or_active" }, 201);
}
