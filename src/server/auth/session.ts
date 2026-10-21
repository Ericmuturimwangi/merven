import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "../db";
import { auth } from "./auth";

export type AdminPrincipal = { id: string; name: string; email: string };

/** Returns the signed-in, active administrator, or null. Never trusts client input. */
export async function getAdmin(): Promise<AdminPrincipal | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await db.adminUser.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, isActive: true },
  });
  if (!user?.isActive) return null;
  return { id: user.id, name: user.name, email: user.email };
}

/**
 * Authorisation gate for every admin page and server action.
 * Redirects (throws) when there is no active admin session.
 */
export async function requireAdmin(): Promise<AdminPrincipal> {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
