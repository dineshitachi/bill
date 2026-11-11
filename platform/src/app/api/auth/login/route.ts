import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, getEffectivePermissions, setSessionCookie } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { jsonError, readJson } from "@/server/http";
import { decryptField, decryptTenant } from "@/server/field-encryption";
import { ensurePlatformTables } from "@/server/platform-schema";

const loginSchema = z.object({
  tenant: z.string().trim().toLowerCase().min(1).max(50),
  username: z.string().trim().toLowerCase().min(3).max(32),
  password: z.string().min(1).max(128),
});
const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/;

const attempts = new Map<string, { count: number; since: number; blockedUntil: number }>();
const windowMs = 15 * 60 * 1000;
const maxAttempts = 6;

function rateLimitKey(request: Request, tenant: string, username: string): string {
  const address = request.headers.get("x-real-ip") || "unknown";
  return `${address}|${tenant}|${username}`;
}

export async function POST(request: Request) {
  const body = await readJson(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return jsonError("Enter your business, username, and password");
  if (!tenantSlugPattern.test(parsed.data.tenant)) {
    return jsonError("Use the workspace slug shown during provisioning (letters, numbers, and hyphens only).", 400);
  }
  const key = rateLimitKey(request, parsed.data.tenant, parsed.data.username);
  const now = Date.now();
  const current = attempts.get(key);
  if (current?.blockedUntil && current.blockedUntil > now) {
    return jsonError("Too many sign-in attempts. Try again in 15 minutes.", 429);
  }
  if (current && now - current.since > windowMs) attempts.delete(key);
  const fail = () => {
    const entry = attempts.get(key);
    if (!entry || now - entry.since > windowMs) attempts.set(key, { count: 1, since: now, blockedUntil: 0 });
    else {
      entry.count += 1;
      if (entry.count >= maxAttempts) entry.blockedUntil = now + windowMs;
    }
      if (attempts.size > 10_000) {
      for (const [entryKey, value] of attempts) if (now - value.since > windowMs && value.blockedUntil < now) attempts.delete(entryKey);
        while (attempts.size > 10_000) {
          const oldestKey = attempts.keys().next().value;
          if (oldestKey === undefined) break;
          attempts.delete(oldestKey);
        }
      }
  };
  const tenant = await prisma.tenant.findUnique({ where: { slug: parsed.data.tenant } });
  if (!tenant || !tenant.enabled || tenant.maintenanceMode) {
    fail();
    return jsonError("Invalid sign-in details", 401);
  }
  const company = decryptTenant(tenant);

  const db = tenantDb(tenant.schemaName);
  await ensurePlatformTables(db);
  const user = await db.user.findUnique({
    where: { username: parsed.data.username },
  });
  if (!user || user.disabledAt || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    fail();
    return jsonError("Invalid sign-in details", 401);
  }
  attempts.delete(key);
  const role = user.role === "STAFF" ? "SALES" : user.role;
  if (role !== "ADMIN" && role !== "SALES" && role !== "CUSTOMER") return jsonError("Account role is not permitted", 403);
  const displayName = decryptField(user.displayName);
  const permissions = await getEffectivePermissions(db, user.id, role);

  const token = await createSession({
    userId: user.id,
    role,
    tenantId: tenant.id,
    schemaName: tenant.schemaName,
  });
  const response = NextResponse.json({
    user: { id: user.id, username: user.username, displayName, role, theme: user.theme, permissions },
    company: {
      name: company.name,
      legalName: company.legalName,
      gstin: company.gstin,
      stateCode: company.stateCode,
      upiId: company.upiId,
      logoData: company.logoData,
      theme: company.theme,
      lowStockNotifications: company.lowStockNotifications,
      paymentNotifications: company.paymentNotifications,
    },
  });
  setSessionCookie(response, token);
  return response;
}
