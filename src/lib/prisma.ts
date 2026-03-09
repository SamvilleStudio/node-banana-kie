import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __nodeBananaPrisma: PrismaClient | undefined;
}

const globalForPrisma = globalThis as typeof globalThis & {
  __nodeBananaPrisma?: PrismaClient;
};

let prismaInitError: Error | null = null;

function createPrismaClient(): PrismaClient {
  if (globalForPrisma.__nodeBananaPrisma) {
    return globalForPrisma.__nodeBananaPrisma;
  }

  try {
    const client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });

    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.__nodeBananaPrisma = client;
    }

    return client;
  } catch (error) {
    prismaInitError =
      error instanceof Error
        ? error
        : new Error("Failed to initialize Prisma client");
    throw prismaInitError;
  }
}

export function getPrismaClient(): PrismaClient {
  if (prismaInitError) {
    throw prismaInitError;
  }

  return createPrismaClient();
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrismaClient();
    const value = Reflect.get(client as object, prop);

    if (typeof value === "function") {
      return value.bind(client);
    }

    return value;
  },
});

export function isDatabaseConfigured(): boolean {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0;
}
