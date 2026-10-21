import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";

export const AUTH_COOKIE_PREFIX = "merven";

export const auth = betterAuth({
  appName: "Merven Fashions Admin",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  user: { modelName: "adminUser" },
  session: {
    modelName: "adminSession",
    expiresIn: 60 * 60 * 12, // 12 hours
    updateAge: 60 * 60, // refresh at most hourly
  },
  account: { modelName: "adminAccount" },
  verification: { modelName: "adminVerification" },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // admins are created with `pnpm admin:create` only
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  // Only sign-in, sign-out and session reads are needed. Everything else is off.
  disabledPaths: [
    "/sign-up/email",
    "/request-password-reset",
    "/reset-password",
    "/verify-email",
    "/send-verification-email",
    "/change-email",
    "/update-user",
    "/delete-user",
    "/link-social",
    "/unlink-account",
  ],
  rateLimit: {
    enabled: true,
    storage: "database", // shared across serverless instances
    modelName: "rateLimit",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 5 },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Deactivated admins cannot obtain a session.
        before: async (session) => {
          const user = await db.adminUser.findUnique({ where: { id: session.userId }, select: { isActive: true } });
          return Boolean(user?.isActive);
        },
      },
    },
  },
  advanced: {
    cookiePrefix: AUTH_COOKIE_PREFIX,
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
  },
  telemetry: { enabled: false },
  plugins: [nextCookies()],
});
