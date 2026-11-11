import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { tenantDb, prisma } from "@/server/db";
import { decryptField } from "@/server/field-encryption";
import { ensurePlatformTables } from "@/server/platform-schema";

export type Role = "ADMIN" | "SALES" | "CUSTOMER";
export type Permission =
  | "dashboard.read" | "billing.write" | "inventory.read" | "inventory.write"
  | "customers.read" | "customers.write" | "invoices.read" | "payments.write"
  | "crm.write" | "vendors.write" | "expenses.write" | "reports.read"
  | "settings.write" | "team.write" | "security.audit" | "documents.read" | "integrations.write"
  | "backups.write" | "portal.read";
export type Session = {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  tenantId: string;
  schemaName: string;
};

const cookieName = "namma_bill_session";
export const sessionCookieName = cookieName;
export const sessionSlidingWindowSeconds = 30 * 60;
export const sessionLifetimeSeconds = 8 * 60 * 60;

function jwtKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (
    !secret ||
    Buffer.byteLength(secret) < 32 ||
    /^(?:replace|change|your|example|changeme)/i.test(secret.trim()) ||
    /^(.)\1+$/.test(secret)
  ) {
    throw new Error("JWT_SECRET must be a unique, non-placeholder secret of at least 32 bytes");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(session: Omit<Session, "displayName" | "username">): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionLifetimeSeconds}s`)
    .sign(jwtKey());
}

export async function refreshSession(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, jwtKey());
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionLifetimeSeconds}s`)
    .sign(jwtKey());
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwtKey()));
  } catch {
    return null;
  }
  if (
    typeof payload.userId !== "string" ||
    (payload.role !== "ADMIN" && payload.role !== "SALES" && payload.role !== "CUSTOMER" && payload.role !== "STAFF") ||
    typeof payload.tenantId !== "string" ||
    typeof payload.schemaName !== "string" ||
    !/^tenant_[a-f0-9]{32}$/.test(payload.schemaName)
  ) return null;

  const tenant = await prisma.tenant.findUnique({ where: { id: payload.tenantId } });
  if (!tenant || !tenant.enabled || tenant.maintenanceMode || tenant.schemaName !== payload.schemaName) return null;
  const db = tenantDb(tenant.schemaName);
  await ensurePlatformTables(db);
  const user = await db.user.findUnique({
    where: { id: payload.userId },
    select: { disabledAt: true, role: true, username: true, displayName: true },
  });
  const normalizedRole = user?.role === "STAFF" ? "SALES" : user?.role;
  const sessionRole = payload.role === "STAFF" ? "SALES" : payload.role;
  if (!user || user.disabledAt || normalizedRole !== sessionRole) return null;
  return {
    userId: payload.userId,
    username: user.username,
    displayName: decryptField(user.displayName),
    role: normalizedRole as Role,
    tenantId: payload.tenantId,
    schemaName: payload.schemaName,
  };
}

export async function requireSession(roles?: Role[]): Promise<
  | { session: Session; db: ReturnType<typeof tenantDb> }
  | { response: NextResponse }
> {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (roles && !roles.includes(session.role)) {
    return { response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  }
  return { session, db: tenantDb(session.schemaName) };
}

export const defaultPermissions: Record<Role, readonly Permission[]> = {
  ADMIN: [
    "dashboard.read", "billing.write", "inventory.read", "inventory.write", "customers.read", "customers.write",
    "invoices.read", "payments.write", "crm.write", "vendors.write", "expenses.write", "reports.read",
    "settings.write", "team.write", "security.audit", "documents.read", "integrations.write", "backups.write", "portal.read",
  ],
  SALES: ["dashboard.read", "billing.write", "inventory.read", "customers.read", "customers.write", "invoices.read", "payments.write", "crm.write", "vendors.write", "portal.read"],
  CUSTOMER: ["portal.read"],
};

export async function getEffectivePermissions(db: ReturnType<typeof tenantDb>, userId: string, role: Role): Promise<Permission[]> {
  const permissions = new Set<Permission>(defaultPermissions[role]);
  const grants = await db.$queryRaw<Array<{ permission: Permission; enabled: boolean }>>`SELECT "permission", "enabled" FROM "UserPermission" WHERE "userId" = ${userId}::uuid`;
  for (const grant of grants) {
    if (grant.enabled) permissions.add(grant.permission);
    else permissions.delete(grant.permission);
  }
  return [...permissions];
}

export async function requirePermission(permission: Permission): Promise<
  | { session: Session; db: ReturnType<typeof tenantDb> }
  | { response: NextResponse }
> {
  const auth = await requireSession();
  if ("response" in auth) return auth;
  const rows = await auth.db.$queryRaw<Array<{ enabled: boolean }>>`
    SELECT "enabled" FROM "UserPermission" WHERE "userId" = ${auth.session.userId}::uuid AND "permission" = ${permission} LIMIT 1
  `;
  if (rows[0]) return rows[0].enabled ? auth : { response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  if (!defaultPermissions[auth.session.role].includes(permission)) return { response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  return auth;
}
