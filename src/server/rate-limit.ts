import { randomUUID } from "node:crypto";
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

/** Client IP as set by the platform (Vercel overwrites x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
