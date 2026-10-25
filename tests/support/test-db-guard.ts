// Fail-closed guard for the disposable test database. The test run migrates,
// marks (for test-mode payments) and truncates TEST_DATABASE_URL, so before any
// of that the database SERVER must confirm, over the connection being used:
//   - current_database() is exactly "merven_test";
//   - the connection is local: inet_server_addr() is NULL (Unix socket) or loopback;
//   - the database comment is absent or exactly the isolated-test marker.
// Nothing is inferred from the URL text. A remote database named merven_test is refused.

export const TEST_DATABASE_NAME = "merven_test";
export const TEST_DB_TOKEN = "merven-vitest-isolated-db-0001";
export const TEST_DATABASE_MARKER = `merven-test-payments:${TEST_DB_TOKEN}`;

export type ServerFacts = {
  database: string;
  local: boolean;
  comment: string | null;
  /** Identify the database and server instance, to detect a switch between connections. */
  databaseOid: string;
  serverStartedAt: string;
};

const LOCAL_SQL = `(inet_server_addr() IS NULL
  OR inet_server_addr() <<= '127.0.0.0/8'::inet
  OR inet_server_addr() = '::1'::inet
  OR inet_server_addr() <<= '::ffff:127.0.0.0/104'::inet)`;

export const SERVER_FACTS_SQL = `SELECT current_database() AS "database",
  COALESCE(${LOCAL_SQL}, false) AS "local",
  pg_catalog.shobj_description(d.oid, 'pg_database') AS "comment",
  d.oid::text AS "databaseOid",
  extract(epoch FROM pg_postmaster_start_time())::text AS "serverStartedAt"
FROM pg_catalog.pg_database d WHERE d.datname = current_database()`;

/** Why this database must not be touched (empty when it is the isolated test database). Never echoes the comment. */
export function unsafeReasons(facts: ServerFacts | undefined): string[] {
  if (!facts) return ["the server returned no database information"];
  const reasons: string[] = [];
  if (facts.database !== TEST_DATABASE_NAME) reasons.push(`connected database is "${facts.database}", not "${TEST_DATABASE_NAME}"`);
  if (facts.local !== true) reasons.push("the database server is not local (not a Unix socket or loopback address)");
  if (facts.comment !== null && facts.comment.trim() !== TEST_DATABASE_MARKER) reasons.push("the database has an unexpected comment");
  return reasons;
}

export class UnsafeTestDatabaseError extends Error {
  constructor(reasons: string[]) {
    super(`Refusing to use TEST_DATABASE_URL: ${reasons.join("; ")}. Nothing was migrated, marked or cleaned.`);
    this.name = "UnsafeTestDatabaseError";
  }
}

export function assertSafe(facts: ServerFacts | undefined): ServerFacts {
  const reasons = unsafeReasons(facts);
  if (reasons.length > 0) throw new UnsafeTestDatabaseError(reasons);
  return facts!;
}

/**
 * SQL for a second connection (made by a different client, e.g. Prisma's
 * migration engine) that raises unless it reaches the very same database and
 * server instance the guard already checked, and the checks still hold.
 */
export function bindingGuardSql(facts: ServerFacts): string {
  if (!/^\d+$/.test(facts.databaseOid) || !/^\d+(\.\d+)?$/.test(facts.serverStartedAt)) throw new UnsafeTestDatabaseError(["unexpected server identity"]);
  return `DO $guard$
BEGIN
  IF current_database() <> '${TEST_DATABASE_NAME}'
    OR NOT COALESCE(${LOCAL_SQL}, false)
    OR (SELECT d.oid::text FROM pg_catalog.pg_database d WHERE d.datname = current_database()) <> '${facts.databaseOid}'
    OR extract(epoch FROM pg_postmaster_start_time())::text <> '${facts.serverStartedAt}'
    OR COALESCE(btrim(pg_catalog.shobj_description((SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database()), 'pg_database')), '${TEST_DATABASE_MARKER}') <> '${TEST_DATABASE_MARKER}'
  THEN
    RAISE EXCEPTION 'merven test-database guard: not the verified local ${TEST_DATABASE_NAME} database';
  END IF;
END
$guard$;`;
}

/** One open connection: the checks and the marker run on it. */
export type GuardConnection = {
  query<T>(sql: string): Promise<T[]>;
  end(): Promise<void>;
};

export type PrepareDeps = {
  connect(url: string): Promise<GuardConnection>;
  /** Runs `guardSql` through the migration client first, then migrates. Must stop if the guard raises. */
  migrate(url: string, guardSql: string): void | Promise<void>;
};

/**
 * Verifies, migrates and marks the test database. Every check runs before the
 * mutation it protects; any failure throws before anything is changed.
 */
export async function prepareTestDatabase(url: string, deps: PrepareDeps): Promise<void> {
  const conn = await deps.connect(url);
  try {
    const before = assertSafe((await conn.query<ServerFacts>(SERVER_FACTS_SQL))[0]);
    await deps.migrate(url, bindingGuardSql(before));

    // Re-check on the original connection, then mark in the same transaction.
    await conn.query("BEGIN");
    try {
      const after = assertSafe((await conn.query<ServerFacts>(SERVER_FACTS_SQL))[0]);
      if (after.databaseOid !== before.databaseOid || after.serverStartedAt !== before.serverStartedAt) {
        throw new UnsafeTestDatabaseError(["the database or server changed during setup"]);
      }
      await conn.query(`COMMENT ON DATABASE ${TEST_DATABASE_NAME} IS '${TEST_DATABASE_MARKER}'`);
      await conn.query("COMMIT");
    } catch (e) {
      await conn.query("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    await conn.end();
  }
}
