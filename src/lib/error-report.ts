// Turns a server error into one structured, privacy-safe log line. Used by
// src/instrumentation.ts; Vercel collects stdout/stderr as the error log.
//
// Never includes request headers or cookies (session tokens), strips query
// strings (customer search terms), and redacts secrets and email addresses that
// can appear inside library error messages.

const REDACTIONS: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgres://[redacted]"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "sb_[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, "[redacted-jwt]"],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]"],
  [/\b(password|secret|token|apikey|api_key)(["'\s:=]+)[^\s"',;]+/gi, "$1$2[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function redact(text: string): string {
  return REDACTIONS.reduce((t, [re, sub]) => t.replace(re, sub), text);
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
  return {
    level: "error",
    event: "request_error",
    digest,
    name: err.name,
    message: redact(err.message).slice(0, 500),
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
  };
}
