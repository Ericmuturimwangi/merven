// Prisma error messages repeat the arguments of the failing call, so a failed
// order write would put the customer's name, email and phone into logs
// (Next.js prints thrown errors to the server log; Vercel keeps it). Prisma's
// `errorFormat` option doesn't prevent this. Each Prisma error is therefore
// rewritten in place, before anyone can log it, to an allowlisted summary:
// the operation, the error class, its code and the affected field names.
// The object keeps its class and `code`, so `instanceof` and code checks
// (e.g. P2002 unique violations) still work.

const SAFE_META_KEYS = ["modelName", "target"] as const;

/** Field names in `meta.target` (an index name or a list of field names), never values. */
function safeTarget(target: unknown): string | string[] | undefined {
  if (typeof target === "string") return target.slice(0, 100);
  if (Array.isArray(target)) return target.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 64));
  return undefined;
}

export function isPrismaError(e: unknown): e is Error {
  return e instanceof Error && e.name.startsWith("PrismaClient");
}

/** Rewrites a Prisma error's message, stack and meta to safe values; other errors are returned untouched. */
export function sanitizePrismaError(e: unknown): unknown {
  if (!isPrismaError(e)) return e;
  const err = e as Error & { code?: unknown; meta?: Record<string, unknown> };
  const operation = err.message.match(/Invalid `[^`\n]{1,120}` invocation/)?.[0] ?? "Database operation failed";
  const code = typeof err.code === "string" && /^P\d{4}$/.test(err.code) ? err.code : null;
  let meta: Record<string, unknown> | undefined;
  if (err.meta && typeof err.meta === "object") {
    meta = {};
    for (const key of SAFE_META_KEYS) {
      const value = key === "target" ? safeTarget(err.meta.target) : typeof err.meta[key] === "string" ? String(err.meta[key]).slice(0, 64) : undefined;
      if (value !== undefined) meta[key] = value;
    }
  }
  const target = meta?.target ? ` on ${Array.isArray(meta.target) ? meta.target.join(", ") : meta.target}` : "";
  // Database identifiers only (never row values): the violated constraint's name and the SQLSTATE.
  const constraint = err.message.match(/constraint "([A-Za-z0-9_]{1,63})"/)?.[1];
  const sqlState = err.message.match(/Code: `([0-9A-Z]{5})`/)?.[1];
  const details = [code, sqlState ? `SQLSTATE ${sqlState}` : null, constraint ? `constraint ${constraint}` : null].filter(Boolean).join(", ");
  const message = `${operation} (${err.name}${details ? ` ${details}` : ""}${target})`;
  const frames = (err.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
  err.message = message;
  err.stack = [`${err.name}: ${message}`, ...frames].join("\n");
  if (meta) err.meta = meta;
  return err;
}
