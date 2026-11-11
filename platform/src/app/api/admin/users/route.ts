import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { requireSubscription } from "@/server/subscription";
import { jsonError, readJson } from "@/server/http";
import { decryptField, encryptField } from "@/server/field-encryption";
import { prisma } from "@/server/db";

const newUserSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  displayName: z.string().trim().min(2).max(80),
  password: z.string().min(12).max(128),
  role: z.enum(["ADMIN", "SALES", "CUSTOMER"]).default("SALES"),
  customerId: z.string().uuid().or(z.literal("")).optional(),
}).superRefine((value, context) => {
  if (value.role === "CUSTOMER" && !value.customerId) context.addIssue({ code: "custom", path: ["customerId"], message: "Customer accounts must be linked to a customer record" });
});

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const users = (await auth.db.user.findMany({
    select: { id: true, username: true, displayName: true, role: true, theme: true, createdAt: true, disabledAt: true },
    orderBy: { createdAt: "asc" },
  })).map((user) => ({ ...user, displayName: decryptField(user.displayName) }));
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireSubscription("user.create", ["ADMIN"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = newUserSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid account details; use a 12-character or longer password");
  try {
    const user = await auth.db.user.create({
      data: {
        id: randomUUID(),
        username: parsed.data.username,
        displayName: encryptField(parsed.data.displayName),
        role: parsed.data.role,
        passwordHash: await bcrypt.hash(parsed.data.password, 12),
      },
      select: { id: true, username: true, displayName: true, role: true, theme: true, createdAt: true },
    });
    if (parsed.data.customerId) await auth.db.$executeRaw`UPDATE "User" SET "customerId" = ${parsed.data.customerId}::uuid WHERE "id" = ${user.id}::uuid`;
    await prisma.$executeRaw`INSERT INTO "BusinessMembership" ("id", "userId", "tenantId", "role") VALUES (${randomUUID()}::uuid, ${user.id}::uuid, ${auth.session.tenantId}::uuid, ${user.role}) ON CONFLICT ("userId", "tenantId") DO UPDATE SET "role" = EXCLUDED."role"`;
    await auth.db.auditLog.create({
      data: { actorId: auth.session.userId, action: "user.created", subject: user.id, details: { role: user.role } },
    });
    return NextResponse.json({ user: { ...user, displayName: parsed.data.displayName } }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return jsonError("That username is already in use", 409);
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const userId = new URL(request.url).searchParams.get("id");
  if (!userId) return jsonError("A user id is required");
  if (userId === auth.session.userId) return jsonError("You cannot remove your own account");
  const target = await auth.db.user.findUnique({ where: { id: userId } });
  if (!target) return jsonError("User not found", 404);
  if (target.role === "ADMIN") {
    const activeAdmins = await auth.db.user.count({ where: { role: "ADMIN", disabledAt: null } });
    if (activeAdmins <= 1) return jsonError("The last active administrator cannot be removed", 409);
  }
  await auth.db.$transaction([
    auth.db.auditLog.create({
      data: { actorId: auth.session.userId, action: "user.deleted", subject: target.id, details: { username: target.username } },
    }),
    auth.db.user.delete({ where: { id: target.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
