import { requireAuthContext } from "@/lib/supabase";
import { env } from "@/lib/env";
import { fail, ok } from "@/lib/api-response";

/**
 * Browser Supabase Realtime needs URL + anon key + user JWT.
 * Anon key is not a secret (same as NEXT_PUBLIC in typical apps); session stays httpOnly.
 */
export async function GET() {
  const auth = await requireAuthContext();
  if (!auth.authenticated) {
    return fail("Unauthorized", 401);
  }

  return ok({
    supabaseUrl: env.supabaseUrl,
    supabaseAnonKey: env.supabaseAnonKey,
    accessToken: auth.session.accessToken,
    expiresAt: auth.session.expiresAt,
  });
}
