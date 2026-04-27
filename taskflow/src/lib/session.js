import crypto from "node:crypto";
import { env } from "@/lib/env";

export const SESSION_COOKIE_NAME = "tf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function base64UrlEncode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto
    .createHmac("sha256", env.sessionSecret)
    .update(value)
    .digest("base64url");
}

function secureCompare(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function encodeSession(session) {
  const payload = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
  const raw = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(raw);
  return `${raw}.${signature}`;
}

export function decodeSession(value) {
  if (!value || !value.includes(".")) {
    return null;
  }

  const [raw, signature] = value.split(".");
  const expected = sign(raw);
  if (!secureCompare(signature, expected)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(raw));
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function sessionWillExpireSoon(expiresAt, bufferSeconds = 30) {
  return expiresAt - Math.floor(Date.now() / 1000) <= bufferSeconds;
}

export function setSessionCookie(cookieStore, session) {
  cookieStore.set(SESSION_COOKIE_NAME, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(cookieStore) {
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/",
    maxAge: 0,
  });
}

export function readSessionFromCookies(cookieStore) {
  const value = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return decodeSession(value);
}
