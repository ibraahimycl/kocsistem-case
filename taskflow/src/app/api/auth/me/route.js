import { requireAuthContext } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";

export async function GET() {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  return ok({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      userMetadata: auth.user.user_metadata,
    },
  });
}
