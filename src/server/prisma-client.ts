import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { SUPABASE_ROOT_CA_2021 } from "./certs/supabase-root-ca";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);
const SSL_PARAMS = ["sslmode", "sslcert", "sslkey", "sslrootcert", "sslaccept", "uselibpqcompat"];

/**
 * Builds the pg pool config. Remote databases must use TLS with certificate
 * verification (`sslmode=require` or `verify-full`); plaintext is refused.
 * Supabase hosts are verified against Supabase's own root CA, bundled here so
 * it works on Vercel without reading files at runtime.
 */
export function pgConfig(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  const socketHost = url.searchParams.get("host")?.startsWith("/");
  if (LOCAL_HOSTS.has(url.hostname) || socketHost) return { connectionString };

  const mode = url.searchParams.get("sslmode");
  if (mode !== "require" && mode !== "verify-full") {
    throw new Error(
      `Refusing an unencrypted connection to remote database host ${url.hostname}. Add sslmode=require to the connection string.`,
    );
  }
  // pg would let these URL params override the ssl object below, so drop them.
  for (const p of SSL_PARAMS) url.searchParams.delete(p);
  const isSupabase = /\.supabase\.(co|com)$/.test(url.hostname);
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true, ...(isSupabase ? { ca: SUPABASE_ROOT_CA_2021 } : {}) },
    // Opening a TLS connection to a remote pooler costs several round trips, so
    // keep idle connections for 5 minutes instead of pg's default 10 seconds.
    idleTimeoutMillis: 5 * 60_000,
    keepAlive: true,
    // Serverless functions and parallel build workers each get their own pool;
    // keep them small so they fit within the pooler's client limit.
    max: 3,
  };
}

// Kept free of `server-only` so CLI scripts and tests can construct a client.
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pgConfig(connectionString)) });
}

export type { PrismaClient };
