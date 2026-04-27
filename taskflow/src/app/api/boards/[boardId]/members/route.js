import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function GET(_request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;

  const { data, error } = await auth.supabase.rpc("get_board_members_with_email", {
    p_board_id: boardId,
  });

  if (error) {
    const { data: fallbackData, error: fallbackError } = await auth.supabase
      .from("board_members")
      .select("id, user_id, role, status, created_at")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false });

    if (fallbackError) {
      return fail(error.message, 400);
    }
    return ok({
      members: (fallbackData ?? []).map((member) => ({
        ...member,
        display_name: null,
        email: null,
      })),
    });
  }

  return ok({ members: data ?? [] });
}

export async function PATCH(request, { params }) {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  const { boardId } = await params;
  const body = await request.json();
  const userId = body?.userId;
  const action = body?.action;
  const role = body?.role;

  if (!userId || !action) {
    return fail("userId and action are required", 422);
  }

  if (action === "approve") {
    const { error } = await auth.supabase.rpc("approve_board_member", {
      p_board_id: boardId,
      p_user_id: userId,
      p_role: role ?? null,
    });

    if (error) {
      return fail(error.message, 400);
    }

    return ok({ success: true });
  }

  if (action === "reject") {
    const { error } = await auth.supabase.rpc("reject_board_member", {
      p_board_id: boardId,
      p_user_id: userId,
    });

    if (error) {
      return fail(error.message, 400);
    }

    return ok({ success: true });
  }

  return fail("Invalid action", 422);
}
