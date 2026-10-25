import "server-only";
import { cookies } from "next/headers";
import { BAG_COOKIE, BAG_MAX_AGE_SECONDS, parseBag, serializeBag, type BagLine, type ParsedBag } from "./bag";
import { ensureBagSession } from "./bag-session";

// The bag cookie is read and written only on the server. HttpOnly: page scripts
// never need it, because the server renders the bag. It holds variant ids,
// quantities and display prices only, never personal information.

export async function readBag(): Promise<ParsedBag> {
  return parseBag((await cookies()).get(BAG_COOKIE)?.value);
}

/** Saves the bag (an empty bag deletes the cookie). Only callable from Server Actions and Route Handlers. */
export async function writeBag(lines: BagLine[]): Promise<void> {
  const jar = await cookies();
  if (lines.length === 0) {
    jar.delete(BAG_COOKIE);
    return;
  }
  jar.set(BAG_COOKIE, serializeBag(lines), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: BAG_MAX_AGE_SECONDS,
  });
  // A bag with contents always has a session, renewed with the bag so it can't
  // expire first: a later checkout then has a stable identity.
  await ensureBagSession();
}
