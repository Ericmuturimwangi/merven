import { execFileSync } from "node:child_process";
import "dotenv/config";

// Applies migrations to the disposable test database before the run.
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("TEST_DATABASE_URL is not set: integration tests will be skipped.");
    return;
  }
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not be the same as DATABASE_URL");
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
