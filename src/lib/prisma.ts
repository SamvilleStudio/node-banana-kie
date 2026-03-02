import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __nodeBananaPrisma: PrismaClient | undefined;
}

const globalForPrisma = globalThis as typeof globalThis & {
  __nodeBananaPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.__nodeBananaPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__nodeBananaPrisma = prisma;
}

export function isDatabaseConfigured(): boolean {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0;
}
