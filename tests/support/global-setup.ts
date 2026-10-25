import { execFileSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";
import { pgConfig } from "../../src/server/prisma-client";
import { prepareTestDatabase, type GuardConnection } from "./test-db-guard";

// Applies migrations to the disposable test database before the run, then
// approves it (and only it) for test-mode payment writes. Fails closed: see
// ./test-db-guard.ts. Any failed check aborts the whole run before anything
// is migrated, marked or truncated.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("TEST_DATABASE_URL is not set: integration tests will be skipped.");
    return;
  }
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not be the same as DATABASE_URL");
  await prepareTestDatabase(url, { connect, migrate });
}

// Same driver and connection settings as the test clients (tests/support/db.ts).
export async function connect(url: string): Promise<GuardConnection> {
  const client = new pg.Client(pgConfig(url));
  await client.connect();
  return {
    query: async <T,>(sql: string) => (await client.query(sql)).rows as T[],
    end: () => client.end(),
  };
}

// `prisma migrate deploy` opens its own connection through Prisma's engine, which
// resolves the URL independently of pg. `prisma db execute` uses the same engine
// and datasource, so the guard runs there before AND after migrating, and refuses
// unless that engine reaches the database and server instance verified above.
// The second run can only detect a change during migration, not undo it, but it
// stops setup before anything is marked or cleaned.
export function migrate(url: string, guardSql: string) {
  const env = { ...process.env, DATABASE_URL: url };
  const engineGuard = () => execFileSync("pnpm", ["exec", "prisma", "db", "execute", "--stdin"], { env, input: guardSql, stdio: "pipe" });
  try {
    engineGuard();
  } catch {
    throw new Error("Refusing to migrate TEST_DATABASE_URL: Prisma's migration engine did not reach the verified local merven_test database. Nothing was migrated, marked or cleaned.");
  }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { env, stdio: "pipe" });
  try {
    engineGuard();
  } catch {
    throw new Error("Aborting test setup: after `prisma migrate deploy`, Prisma's migration engine no longer reached the verified local merven_test database. Migrations may have gone to an unverified database; nothing was marked or cleaned. Check TEST_DATABASE_URL and the local PostgreSQL server.");
  }
}
