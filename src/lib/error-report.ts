// Turns a server error into one structured, privacy-safe log line. Used by
// src/instrumentation.ts; Vercel collects stdout/stderr as the error log.
//
// Never includes request headers or cookies (session tokens), strips query
// strings (customer search terms and order access tokens), and redacts secrets,
// email addresses and phone numbers that can appear inside library error
// messages. Prisma errors are reported by class and code only (and are already
// stripped at the source, see src/server/db-errors.ts).

const REDACTIONS: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgres://[redacted]"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "sb_[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[redacted-jwt]"],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]"],
  [/\b(password|secret|token|apikey|api_key)(["'\s:=]+)[^\s"',;]+/gi, "$1$2[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // Kenyan mobile numbers in the forms customers type and the app stores (+2547…, 2547…, 07…, 01…).
  [/(?<![\d])(?:\+?254|0)[17]\d{8}(?![\d])/g, "[phone]"],
];

export function redact(text: string): string {
  return REDACTIONS.reduce((t, [re, sub]) => t.replace(re, sub), text);
}

/**
 * Allowlisted fields for logging a caught error: its class, a safe code and a
 * redacted, shortened message. Prisma errors are reduced to class and code,
 * since their messages repeat the arguments of the failing call (customer data).
 */
export function safeErrorFields(e: unknown): { errorName: string; code?: string; message?: string } {
  if (!(e instanceof Error)) return { errorName: "unknown" };
  const code = (e as { code?: unknown }).code;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{1,20}$/i.test(code) ? code : undefined;
  if (e.name.startsWith("PrismaClient")) return { errorName: e.name, ...(safeCode ? { code: safeCode } : {}) };
  return { errorName: e.name, ...(safeCode ? { code: safeCode } : {}), message: redact(e.message).slice(0, 200) };
}

export type ErrorReport = {
  level: "error";
  event: "request_error";
  digest?: string;
  name: string;
  message: string;
  method: string;
  path: string;
  route: string;
  routeType: string;
  renderSource?: string;
};

export function buildErrorReport(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string; renderSource?: string },
): ErrorReport {
  const err = error instanceof Error ? error : new Error(String(error));
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  const code = (err as { code?: unknown }).code;
  // A Prisma message repeats the failing call's arguments: report class and code only.
  const message = err.name.startsWith("PrismaClient")
    ? `${err.name}${typeof code === "string" && /^P\d{4}$/.test(code) ? ` ${code}` : ""}`
    : redact(err.message).slice(0, 500);
  return {
    level: "error",
    event: "request_error",
    digest,
    name: err.name,
    message,
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  };
}
