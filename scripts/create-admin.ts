// Creates (or re-activates and resets the password of) an administrator.
// This is the only way to create admins; public sign-up is disabled.
//
//   pnpm admin:create --email owner@example.com --name "Owner"
//
// The password is read from the ADMIN_PASSWORD env var or prompted for (hidden).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { createPrismaClient } from "../src/server/prisma-client";

async function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error("No TTY available; set ADMIN_PASSWORD instead.");
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const argsSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  name: z.string().trim().min(1).max(80),
});
const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters");

async function main() {
  const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
  const args = argsSchema.parse({ email: values.email, name: values.name ?? "Administrator" });
  const password = passwordSchema.parse(process.env.ADMIN_PASSWORD ?? (await promptHidden("Password (min 12 chars): ")));

  const prisma = createPrismaClient(process.env.DATABASE_URL!);
  try {
    const hash = await hashPassword(password);
    // Open the connection first: a cold TLS connection to a remote pooler can
    // take longer than Prisma's default 2 s wait for a transaction to start.
    await prisma.$queryRaw`select 1`;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.adminUser.findUnique({ where: { email: args.email } });
      const user =
        existing ??
        (await tx.adminUser.create({
          data: { id: randomUUID(), email: args.email, name: args.name, emailVerified: true, isActive: true },
        }));
      if (existing) {
        await tx.adminUser.update({ where: { id: user.id }, data: { name: args.name, isActive: true } });
        await tx.adminSession.deleteMany({ where: { userId: user.id } }); // sign out everywhere
      }
      const account = await tx.adminAccount.findFirst({ where: { userId: user.id, providerId: "credential" } });
      if (account) {
        await tx.adminAccount.update({ where: { id: account.id }, data: { password: hash } });
      } else {
        await tx.adminAccount.create({
          data: { id: randomUUID(), userId: user.id, accountId: user.id, providerId: "credential", password: hash },
        });
      }
    }, { maxWait: 15_000, timeout: 30_000 });
    console.log(`Administrator ${args.email} is ready.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message : e);
  process.exit(1);
});
