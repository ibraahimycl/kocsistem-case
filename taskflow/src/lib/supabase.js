import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import {
  clearSessionCookie,
  readSessionFromCookies,
  sessionWillExpireSoon,
  setSessionCookie,
} from "@/lib/session";

export function createPublicSupabaseClient() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAuthedSupabaseClient(accessToken) {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export async function requireAuthContext() {
  const cookieStore = await cookies();
  const storedSession = readSessionFromCookies(cookieStore);

  if (!storedSession) {
    return { authenticated: false, cookieStore };
  }

  let accessToken = storedSession.accessToken;
  let refreshToken = storedSession.refreshToken;
  let expiresAt = storedSession.expiresAt;

  if (sessionWillExpireSoon(expiresAt)) {
    const publicClient = createPublicSupabaseClient();
    const { data, error } = await publicClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      clearSessionCookie(cookieStore);
      return { authenticated: false, cookieStore };
    }

    accessToken = data.session.access_token;
    refreshToken = data.session.refresh_token;
    expiresAt = data.session.expires_at;

    setSessionCookie(cookieStore, {
      accessToken,
      refreshToken,
      expiresAt,
    });
  }

  const authedClient = createAuthedSupabaseClient(accessToken);
  const {
    data: { user },
    error: userError,
  } = await authedClient.auth.getUser();

  if (userError || !user) {
    clearSessionCookie(cookieStore);
    return { authenticated: false, cookieStore };
  }

  return {
    authenticated: true,
    cookieStore,
    supabase: authedClient,
    user,
    session: {
      accessToken,
      refreshToken,
      expiresAt,
    },
  };
}
