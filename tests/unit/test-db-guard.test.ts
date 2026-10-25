import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../support/db";
import {
  bindingGuardSql,
  prepareTestDatabase,
  TEST_DATABASE_MARKER,
  UnsafeTestDatabaseError,
  type GuardConnection,
  type ServerFacts,
} from "../support/test-db-guard";

// The test-database guard, with a scripted connection: no database is touched.

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFileSync }));

const SAFE: ServerFacts = { database: "merven_test", local: true, comment: TEST_DATABASE_MARKER, databaseOid: "16384", serverStartedAt: "1792500000.123456" };

/** A fake connection that answers each facts query from `facts` in turn and records every statement. */
function scriptedConnection(...facts: ServerFacts[]) {
  const statements: string[] = [];
  let ended = false;
  const conn: GuardConnection = {
    async query<T>(sql: string) {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      if (sql.includes("current_database()")) return [facts.shift()] as T[];
      return [] as T[];
    },
    async end() {
      ended = true;
    },
  };
  return { conn, statements, isEnded: () => ended };
}

const run = (facts: ServerFacts[], migrate = vi.fn()) => {
  const s = scriptedConnection(...facts);
  return { ...s, migrate, result: prepareTestDatabase("postgres://test", { connect: async () => s.conn, migrate }) };
};

const mutations = (statements: string[]) => statements.filter((q) => !q.startsWith("SELECT"));

describe("test database guard: refuses before any mutation", () => {
  it.each([
    ["a remote database named merven_test", { ...SAFE, local: false }],
    ["a wrong database name", { ...SAFE, database: "merven_dev" }],
    ["a remote database with another name", { ...SAFE, database: "postgres", local: false }],
    ["an unexpected comment", { ...SAFE, comment: "production" }],
    ["a payment marker for another token", { ...SAFE, comment: "merven-test-payments:some-other-token-000000" }],
    ["a comment that merely mentions test", { ...SAFE, comment: "merven test database" }],
    ["no information from the server", undefined as unknown as ServerFacts],
  ])("%s: no migration, no marker, no cleanup", async (_l, facts) => {
    const r = run([facts]);
    await expect(r.result).rejects.toBeInstanceOf(UnsafeTestDatabaseError);
    expect(r.migrate).not.toHaveBeenCalled();
    expect(mutations(r.statements)).toEqual([]);
    expect(r.isEnded()).toBe(true);
  });

  it("never echoes the unexpected comment in the error", async () => {
    const r = run([{ ...SAFE, comment: "secret-ish-value-123" }]);
    await expect(r.result).rejects.toThrow(/unexpected comment/);
    await expect(r.result).rejects.not.toThrow(/secret-ish-value-123/);
  });

  it("does not mark when the migration client refuses (guard raised)", async () => {
    const r = run([SAFE, SAFE], vi.fn(() => { throw new Error("guard raised"); }));
    await expect(r.result).rejects.toThrow("guard raised");
    expect(mutations(r.statements)).toEqual([]);
  });

  it("does not mark if the database or server changed during setup", async () => {
    const r = run([SAFE, { ...SAFE, databaseOid: "99999" }]);
    await expect(r.result).rejects.toThrow(/changed during setup/);
    expect(r.statements.some((q) => q.startsWith("COMMENT"))).toBe(false);
    expect(r.statements).toContain("ROLLBACK");
  });

  it("does not mark if the comment changed during setup", async () => {
    const r = run([SAFE, { ...SAFE, comment: "someone else's database" }]);
    await expect(r.result).rejects.toBeInstanceOf(UnsafeTestDatabaseError);
    expect(r.statements.some((q) => q.startsWith("COMMENT"))).toBe(false);
  });
});

describe("test database guard: isolated local merven_test", () => {
  it.each([
    ["already marked", SAFE],
    ["not yet marked", { ...SAFE, comment: null }],
  ])("%s: checks, migrates through the bound guard, then marks in one transaction", async (_l, facts) => {
    const r = run([facts, facts]);
    await r.result;
    expect(r.migrate).toHaveBeenCalledOnce();
    expect(r.migrate.mock.calls[0][1]).toBe(bindingGuardSql(facts));
    expect(mutations(r.statements)).toEqual(["BEGIN", "COMMENT ON DATABASE", "COMMIT"]);
    expect(r.isEnded()).toBe(true);
  });

  it("binds the migration client to the verified database and server instance", () => {
    const sql = bindingGuardSql(SAFE);
    expect(sql).toContain("current_database() <> 'merven_test'");
    expect(sql).toContain("<> '16384'");
    expect(sql).toContain("<> '1792500000.123456'");
    expect(sql).toContain("inet_server_addr() IS NULL");
    expect(sql).toContain("RAISE EXCEPTION");
    expect(() => bindingGuardSql({ ...SAFE, databaseOid: "1'; DROP" })).toThrow(UnsafeTestDatabaseError);
  });
});

describe("global setup: Prisma migrations never run after a failed guard", () => {
  beforeEach(() => execFileSync.mockReset());
  const pnpmCalls = () => execFileSync.mock.calls.filter((c) => c[0] === "pnpm").map((c) => (c[1] as string[]).slice(2).join(" "));

  it("stops before `prisma migrate deploy` when the engine-side guard raises", async () => {
    const { migrate } = await import("../support/global-setup");
    execFileSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "pnpm" && args?.includes("execute")) throw new Error("ERROR: merven test-database guard");
    });
    expect(() => migrate("postgres://test", bindingGuardSql(SAFE))).toThrow(/Nothing was migrated/);
    expect(pnpmCalls()).toEqual(["db execute --stdin"]);
    expect(execFileSync.mock.calls.find((c) => c[0] === "pnpm")?.[2]).toMatchObject({ input: bindingGuardSql(SAFE) });
  });

  it("runs the guard before and after migrating, with the same bound guard", async () => {
    const { migrate } = await import("../support/global-setup");
    migrate("postgres://test", bindingGuardSql(SAFE));
    expect(pnpmCalls()).toEqual(["db execute --stdin", "migrate deploy", "db execute --stdin"]);
    const guardInputs = execFileSync.mock.calls.filter((c) => c[0] === "pnpm" && (c[1] as string[]).includes("execute")).map((c) => c[2].input);
    expect(guardInputs).toEqual([bindingGuardSql(SAFE), bindingGuardSql(SAFE)]);
  });

  it("aborts setup when the post-migration guard raises", async () => {
    const { migrate } = await import("../support/global-setup");
    let guardRuns = 0;
    execFileSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "pnpm" && args?.includes("execute") && ++guardRuns === 2) throw new Error("ERROR: merven test-database guard");
    });
    expect(() => migrate("postgres://test", bindingGuardSql(SAFE))).toThrow(/Aborting test setup: after `prisma migrate deploy`/);
    expect(pnpmCalls()).toEqual(["db execute --stdin", "migrate deploy", "db execute --stdin"]);
  });

  it("propagates a failed `migrate deploy` without running anything further", async () => {
    const { migrate } = await import("../support/global-setup");
    execFileSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "pnpm" && args?.includes("deploy")) throw new Error("migration failed");
    });
    expect(() => migrate("postgres://test", bindingGuardSql(SAFE))).toThrow("migration failed");
    expect(pnpmCalls()).toEqual(["db execute --stdin", "migrate deploy"]);
  });

  it("never marks the database when migrate() aborts after migrating", async () => {
    const s = scriptedConnection(SAFE, SAFE);
    const failingAfterDeploy = vi.fn(() => {
      throw new Error("Aborting test setup: after `prisma migrate deploy` …");
    });
    await expect(prepareTestDatabase("postgres://test", { connect: async () => s.conn, migrate: failingAfterDeploy })).rejects.toThrow(/Aborting test setup/);
    expect(mutations(s.statements)).toEqual([]);
    expect(s.isEnded()).toBe(true);
  });
});

describe("resetDb: cleanup refuses an unverified database", () => {
  const fakePrisma = (facts: ServerFacts | undefined) => {
    const executed: string[] = [];
    const tx = {
      $queryRawUnsafe: async () => [facts],
      $executeRawUnsafe: async (sql: string) => {
        executed.push(sql.split(" ")[0]);
        return 0;
      },
    };
    return { executed, prisma: { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
  };

  it.each([
    ["remote merven_test", { ...SAFE, local: false }],
    ["wrong database name", { ...SAFE, database: "merven_dev" }],
    ["unexpected comment", { ...SAFE, comment: "production" }],
  ])("%s: no TRUNCATE", async (_l, facts) => {
    const f = fakePrisma(facts);
    await expect(resetDb(f.prisma as never)).rejects.toBeInstanceOf(UnsafeTestDatabaseError);
    expect(f.executed).toEqual([]);
  });

  it("isolated local merven_test: truncates", async () => {
    const f = fakePrisma(SAFE);
    await resetDb(f.prisma as never);
    expect(f.executed).toEqual(["TRUNCATE"]);
  });
});
