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
    const displayName = body?.displayName?.trim();

    if (!email || !password || !displayName) {
      return fail("Email, password and display name are required", 422);
    }

    if (displayName.length < 2) {
      return fail("Display name must be at least 2 characters", 422);
    }

    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    });

    if (isSupabaseNetworkError(error)) {
      return fail(getSupabaseNetworkErrorMessage(), 503);
    }

    if (error) {
      return fail(error.message, 400);
    }

    const cookieStore = await cookies();
    if (data.session) {
      setSessionCookie(cookieStore, {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      });
    }

    return ok({
      user: data.user,
      emailConfirmationRequired: !data.session,
    });
  } catch (error) {
    if (isSupabaseNetworkError(error)) {
      return fail(getSupabaseNetworkErrorMessage(), 503);
    }

    return fail("Unexpected error", 500, error.message);
  }
}
