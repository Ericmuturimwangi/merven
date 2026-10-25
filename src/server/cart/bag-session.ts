import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { BAG_MAX_AGE_SECONDS } from "./bag";

// A random identifier for this browser's bag, kept apart from the bag cookie
// (whose format is unchanged). It ties a bag checkout to its browser: every tab
// shares it, other browsers can't read or guess it (HttpOnly, 144 random bits).
// Only used to derive the checkout key; it holds no personal information.

export const BAG_SESSION_COOKIE = "merven_bag_session";
const PATTERN = /^[A-Za-z0-9_-]{24}$/;

export async function readBagSession(): Promise<string | null> {
  const value = (await cookies()).get(BAG_SESSION_COOKIE)?.value;
  return value && PATTERN.test(value) ? value : null;
}

/**
 * Keeps the bag session alive alongside the bag: an existing valid value is kept
 * (never rotated) with its expiry renewed; a missing or malformed one is
 * replaced by a new random value. Returns the value set. Only in Server Actions
 * and Route Handlers.
 *
 * A checkout must not use a value created by its own request (see
 * startCheckoutAction): two concurrent requests would each create a different one.
 */
export async function ensureBagSession(): Promise<string> {
  const value = (await readBagSession()) ?? randomBytes(18).toString("base64url");
  (await cookies()).set(BAG_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: BAG_MAX_AGE_SECONDS,
  });
  return value;
}
