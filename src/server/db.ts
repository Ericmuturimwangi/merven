import "server-only";
import { createPrismaClient, type PrismaClient } from "./prisma-client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForPrisma.prisma = createPrismaClient(url);
  }
  return globalForPrisma.prisma;
}

// Lazily constructed so that importing this module never opens a connection.
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
