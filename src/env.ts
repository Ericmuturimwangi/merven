import { z } from "zod";

// Server-side environment. Parsed lazily so that importing a module never
// crashes a build step that doesn't need a particular variable.
const serverSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    NEXT_PUBLIC_SITE_URL: z.url(),
    WHATSAPP_NUMBER: z.string().regex(/^\d{8,15}$/, "WHATSAPP_NUMBER must be digits only, in international format"),
    IMAGE_STORAGE: z.enum(["local", "supabase"]).default("local"),
    SUPABASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    // Server-only. Never prefix with NEXT_PUBLIC_.
    SUPABASE_SECRET_KEY: z
      .string()
      .startsWith("sb_secret_", "SUPABASE_SECRET_KEY must be a Supabase secret key (sb_secret_…), not a publishable or legacy key")
      .optional(),
    SUPABASE_STORAGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, "Invalid bucket name")
      .default("product-images"),
    LOCAL_UPLOAD_DIR: z.string().default("./uploads"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .superRefine((env, ctx) => {
    if (env.IMAGE_STORAGE === "supabase") {
      for (const key of ["SUPABASE_URL", "SUPABASE_SECRET_KEY"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when IMAGE_STORAGE=supabase` });
      }
    }
    // Vercel's filesystem is ephemeral: local uploads would vanish between requests and deploys.
    if (env.IMAGE_STORAGE === "local" && process.env.VERCEL) {
      ctx.addIssue({ code: "custom", path: ["IMAGE_STORAGE"], message: "IMAGE_STORAGE=local is not allowed on Vercel; use supabase" });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  // Treat blank values (e.g. `SUPABASE_URL=""` in .env) as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
