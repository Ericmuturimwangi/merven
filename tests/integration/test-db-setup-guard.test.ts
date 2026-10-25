import { describe, expect, it, vi } from "vitest";
import { connect, migrate } from "../support/global-setup";
import { hasTestDb } from "../support/db";
import {
  assertSafe,
  bindingGuardSql,
  prepareTestDatabase,
  SERVER_FACTS_SQL,
  TEST_DATABASE_MARKER,
  type ServerFacts,
} from "../support/test-db-guard";

// The guard against the real local PostgreSQL server. Read-only except for
// re-applying the existing marker to merven_test itself. Never uses a remote database.

const url = process.env.TEST_DATABASE_URL!;
const facts = async (u: string) => {
  const c = await connect(u);
  try {
    return (await c.query<ServerFacts>(SERVER_FACTS_SQL))[0];
  } finally {
    await c.end();
  }
};

describe.skipIf(!hasTestDb)("test database guard on the local server", () => {
  it("confirms the isolated local merven_test from the server itself", async () => {
    const f = assertSafe(await facts(url));
    expect(f).toMatchObject({ database: "merven_test", local: true, comment: TEST_DATABASE_MARKER });
  });

  it("refuses another database on the same local server (wrong name), before migrating", async () => {
    const other = new URL(url);
    other.pathname = "/postgres";
    const spy = vi.fn();
    await expect(prepareTestDatabase(other.toString(), { connect, migrate: spy })).rejects.toThrow(/connected database is "postgres"/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("Prisma's migration engine accepts only the verified database and server instance", async () => {
    const f = assertSafe(await facts(url));
    // Bound to the right identity: the guard passes. `migrate` itself is not
    // called here; this runs only the engine-side guard.
    const { execFileSync } = await import("node:child_process");
    const engineGuard = (sql: string) =>
      execFileSync("pnpm", ["exec", "prisma", "db", "execute", "--stdin"], { env: { ...process.env, DATABASE_URL: url }, input: sql, stdio: "pipe" });
    expect(() => engineGuard(bindingGuardSql(f))).not.toThrow();
    expect(() => engineGuard(bindingGuardSql({ ...f, databaseOid: "1" }))).toThrow(/merven test-database guard/);
    expect(() => engineGuard(bindingGuardSql({ ...f, serverStartedAt: "1" }))).toThrow(/merven test-database guard/);
    // And migrate() stops at the guard, so `migrate deploy` never runs.
    expect(() => migrate(url, bindingGuardSql({ ...f, databaseOid: "1" }))).toThrow(/Nothing was migrated/);
  });

  it("runs the full setup on the isolated local merven_test (guard, migrations, marker)", async () => {
    await expect(prepareTestDatabase(url, { connect, migrate })).resolves.toBeUndefined();
    expect((await facts(url)).comment).toBe(TEST_DATABASE_MARKER);
  });
});
