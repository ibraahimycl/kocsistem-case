import { cookies } from "next/headers";
import { clearSessionCookie } from "@/lib/session";
import { ok } from "@/lib/api-response";

export async function POST() {
  const cookieStore = await cookies();
  clearSessionCookie(cookieStore);
  return ok({ success: true });
}
