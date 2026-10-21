import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Optional so `prisma generate` (run on install, e.g. on Vercel) works without
    // a database; migrate/db commands still fail clearly if it's missing.
    url: process.env.DATABASE_URL,
  },
});
