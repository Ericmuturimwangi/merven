import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPABASE_ROOT_CA_2021 } from "@/server/certs/supabase-root-ca";
import { pgConfig } from "@/server/prisma-client";

const POOLER = "postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

describe("database TLS configuration", () => {
  it("leaves local connections alone", () => {
    for (const cs of ["postgresql://eric@localhost/merven_dev?host=/run/postgresql", "postgresql://u:p@127.0.0.1:5432/db"]) {
      expect(pgConfig(cs)).toEqual({ connectionString: cs });
    }
  });

  it("refuses plaintext connections to remote hosts", () => {
    expect(() => pgConfig(POOLER)).toThrow(/Refusing an unencrypted connection/);
    expect(() => pgConfig(`${POOLER}?sslmode=disable`)).toThrow(/unencrypted/);
    expect(() => pgConfig(`${POOLER}?sslmode=prefer`)).toThrow(/unencrypted/);
  });

  it("verifies Supabase hosts against the bundled Supabase root CA", () => {
    const cfg = pgConfig(`${POOLER}?sslmode=require&sslcert=certs/supabase-ca-2021.crt&sslaccept=strict`);
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true, ca: SUPABASE_ROOT_CA_2021 });
    expect(cfg.connectionString).toBe(POOLER);
    expect(cfg).toMatchObject({ idleTimeoutMillis: 300_000, keepAlive: true, max: 3 });
  });

  it("verifies other remote hosts against the system CAs", () => {
    const cfg = pgConfig("postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require");
    expect(cfg.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("bundles exactly the certificate in certs/", () => {
    expect(SUPABASE_ROOT_CA_2021.trim()).toBe(readFileSync("certs/supabase-ca-2021.crt", "utf8").replace(/\r/g, "").trim());
  });
});
