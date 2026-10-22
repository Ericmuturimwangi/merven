import { describe, expect, it } from "vitest";
import { buildErrorReport, redact } from "@/lib/error-report";

describe("error report redaction", () => {
  it.each([
    ["postgresql://postgres.ref:S3cret!pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require", "S3cret"],
    ["key sb_secret_abcDEF123_xyz rejected", "sb_secret_abc"],
    ["Authorization: Bearer abc.def.ghijklmnop", "abc.def.ghijklmnop"],
    ["token=7f3a9c2e1d0b; path=/", "7f3a9c2e1d0b"],
    ['password: "hunter2-long"', "hunter2"],
    ["lookup failed for ericmwangi837@gmail.com", "ericmwangi837"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl", "eyJyb2xl"],
  ])("removes secrets from %j", (input, leaked) => {
    expect(redact(input)).not.toContain(leaked);
  });

  it("keeps ordinary diagnostic text", () => {
    expect(redact("P1001: Can't reach database server")).toBe("P1001: Can't reach database server");
  });
});

describe("buildErrorReport", () => {
  const ctx = { routePath: "/(public)/search/page", routeType: "render", renderSource: "react-server-components" };

  it("produces a structured line without query strings or headers", () => {
    const err = Object.assign(new Error("connect failed postgresql://u:pw@host/db"), { digest: "123456" });
    const r = buildErrorReport(err, { path: "/search?q=my+private+search", method: "GET", headers: { cookie: "merven.session_token=abc" } } as never, ctx);
    expect(r).toEqual({
      level: "error",
      event: "request_error",
      digest: "123456",
      name: "Error",
      message: "connect failed postgres://[redacted]",
      method: "GET",
      path: "/search",
      route: "/(public)/search/page",
      routeType: "render",
      renderSource: "react-server-components",
    });
    expect(JSON.stringify(r)).not.toMatch(/session_token|private/);
  });

  it("handles non-Error values and long messages", () => {
    const r = buildErrorReport("x".repeat(2000), { path: "/", method: "GET" }, ctx);
    expect(r.name).toBe("Error");
    expect(r.message).toHaveLength(500);
    expect(r.digest).toBeUndefined();
  });
});
