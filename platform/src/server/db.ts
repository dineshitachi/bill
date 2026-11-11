import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const tenantClients = new Map<string, PrismaClient>();

export function tenantDb(schemaName: string): PrismaClient {
  if (!/^tenant_[a-f0-9]{32}$/.test(schemaName)) throw new Error("Invalid tenant schema");
  const cached = tenantClients.get(schemaName);
  if (cached) return cached;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schemaName);
  const client = new PrismaClient({
    datasources: { db: { url: url.toString() } },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  tenantClients.set(schemaName, client);
  return client;
}
