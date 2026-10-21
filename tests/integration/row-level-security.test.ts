import { afterAll, describe, expect, it } from "vitest";
import { hasTestDb, testPrisma } from "../support/db";

// Guards against a future migration adding a table that Supabase's Data API could expose.
describe.skipIf(!hasTestDb)("row-level security", () => {
  const prisma = testPrisma();
  afterAll(() => prisma.$disconnect());

  it("is enabled on every table in the public schema", async () => {
    const rows = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });
});
