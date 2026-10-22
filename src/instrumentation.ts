import type { Instrumentation } from "next";
import { buildErrorReport } from "./lib/error-report";

// Server-side error reporting: one structured line per error in the platform
// logs (Vercel → Logs), matched to the reference shown on error pages via the
// digest. No third-party service; see src/lib/error-report.ts for redaction.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  console.error(JSON.stringify(buildErrorReport(error, request, context)));
};
