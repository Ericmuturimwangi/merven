import { timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

// Test transactions write orders and deduct stock, so they may only run against
// a database that has been explicitly approved for test writes. The approval
// lives IN the database: a Postgres database comment that only the database
// owner can set, e.g.
//
//   COMMENT ON DATABASE merven_dev IS 'merven-test-payments:<token>';
//
// and the app must be configured with the same token (PAYMENTS_TEST_DATABASE_TOKEN).
// A deployment that points at the production database (which has no such
// comment) is refused even if the token is set. This is an ownership marker,
// not cryptographic proof of identity: anyone able to run COMMENT ON DATABASE
// on production could defeat it, so never set this comment on production.

export const TEST_DATABASE_MARKER_PREFIX = "merven-test-payments:";

type QueryClient = Pick<PrismaClient, "$queryRaw"> | Prisma.TransactionClient;

/** True only if the connected database carries the marker for exactly this token. */
async function databaseComment(db: QueryClient): Promise<string> {
  const rows = await db.$queryRaw<{ comment: string | null }[]>`
    SELECT pg_catalog.shobj_description(d.oid, 'pg_database') AS comment
    FROM pg_catalog.pg_database d
    WHERE d.datname = current_database()`;
  return (rows[0]?.comment ?? "").trim();
}

export async function testDatabaseApproved(db: QueryClient, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const expected = Buffer.from(TEST_DATABASE_MARKER_PREFIX + token);
  const actual = Buffer.from(await databaseComment(db));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Whether the connected database may record payments in this mode:
 * - test: it must carry the test marker for exactly this token;
 * - live: it must NOT carry any test-payments marker, so a production
 *   deployment pointed at a test database never takes real money into it.
 */
export async function databaseApprovedFor(db: QueryClient, mode: "test" | "live", token: string | null | undefined): Promise<boolean> {
  if (mode === "test") return testDatabaseApproved(db, token);
  return !(await databaseComment(db)).startsWith(TEST_DATABASE_MARKER_PREFIX);
}
