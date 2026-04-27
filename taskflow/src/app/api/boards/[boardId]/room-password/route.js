import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function PATCH(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;
  const body = await request.json();
  const roomPassword = body?.roomPassword?.trim();

  if (!roomPassword || roomPassword.length < 6) {
    return fail("Room password must be at least 6 characters", 422);
  }

  const { data, error } = await auth.supabase.rpc("reset_board_room_password", {
    p_board_id: boardId,
    p_new_room_password: roomPassword,
  });

  if (error) {
    return fail(error.message, 400);
  }

  return ok({
    success: Boolean(data),
    message: "Room password updated successfully",
  });
}
