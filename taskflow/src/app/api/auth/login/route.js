import { cookies } from "next/headers";
import { createPublicSupabaseClient } from "@/lib/supabase";
import { fail, ok } from "@/lib/api-response";
import { setSessionCookie } from "@/lib/session";
import {
  getSupabaseNetworkErrorMessage,
  isSupabaseNetworkError,
} from "@/lib/supabase-error";

export async function POST(request) {
  try {
    const body = await request.json();
    const email = body?.email?.trim();
    const password = body?.password;

    if (!email || !password) {
      return fail("Email and password are required", 422);
    }

    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (isSupabaseNetworkError(error)) {
      return fail(getSupabaseNetworkErrorMessage(), 503);
    }

    if (error || !data.session) {
      return fail(error?.message || "Invalid credentials", 401);
    }

    const cookieStore = await cookies();
    setSessionCookie(cookieStore, {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    });

    return ok({ user: data.user });
  } catch (error) {
    if (isSupabaseNetworkError(error)) {
      return fail(getSupabaseNetworkErrorMessage(), 503);
    }

    return fail("Unexpected error", 500, error.message);
  }
}
