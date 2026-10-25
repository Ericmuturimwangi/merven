import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { PrismaClient } from "@/generated/prisma/client";

// Fixed-window rate limit stored in Postgres (the `rate_limit` table that
// Better Auth also uses, with distinct key prefixes), so limits hold across
// serverless instances. One atomic upsert per check.

export async function rateLimit(prisma: PrismaClient, key: string, opts: { max: number; windowMs: number }): Promise<{ allowed: boolean }> {
  const now = BigInt(Date.now());
  const windowStart = now - BigInt(opts.windowMs);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit"."lastRequest" < ${windowStart} THEN 1 ELSE "rate_limit"."count" + 1 END,
      "lastRequest" = CASE WHEN "rate_limit"."lastRequest" < ${windowStart} THEN ${now} ELSE "rate_limit"."lastRequest" END
    RETURNING "count"`;
  return { allowed: Number(rows[0]?.count ?? 0) <= opts.max };
}

/** Rate-limit subject when no platform-verified client IP is available (one shared bucket). */
export const UNTRUSTED_CLIENT = "untrusted";

/**
 * The client IP to rate-limit on, taken only from headers the platform sets.
 *
 * Trust model (Vercel request-headers docs): on Vercel, `x-vercel-forwarded-for`
 * and `x-real-ip` carry the client's public IP as Vercel saw it, and Vercel
 * overwrites any client-supplied `X-Forwarded-For` ("do not forward external
 * IPs ... to prevent IP spoofing"); `x-vercel-forwarded-for` also survives a
 * proxy placed in front of Vercel. So they are read only when the code runs on
 * Vercel (VERCEL=1), and only if the value is a single valid IP address.
 *
 * Anywhere else (local dev, another host or proxy) no forwarded header is
 * trusted: every request shares one bucket, which is stricter, never looser,
 * than per-IP limits. Running behind another proxy needs its own trusted header.
 */
export function clientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL !== "1") return UNTRUSTED_CLIENT;
  for (const name of ["x-vercel-forwarded-for", "x-real-ip"]) {
    const value = headers.get(name)?.trim();
    if (value && isIP(value)) return value;
  }
  return UNTRUSTED_CLIENT;
}
