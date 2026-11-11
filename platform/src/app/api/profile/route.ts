import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { encryptField } from "@/server/field-encryption";

const profileSchema = z.object({
  theme: z.enum(["dark", "slate", "corporate"]).optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  locale: z.string().trim().min(2).max(32).optional(),
  displayName: z.string().trim().min(2).max(80).optional(),
  avatarData: z.string().max(700_000).regex(/^$|^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "At least one profile field is required");

export async function GET() {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const rows = await auth.db.$queryRaw<Array<{ theme: string; currency: string; locale: string; avatarData: string }>>`SELECT "theme", "currency", "locale", "avatarData" FROM "User" WHERE "id" = ${auth.session.userId}::uuid LIMIT 1`;
  return NextResponse.json({ profile: rows[0] || { theme: "slate", currency: "INR", locale: "en-IN", avatarData: "" } });
}

export async function PUT(request: Request) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const parsed = profileSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid profile preferences");

  const user = await auth.db.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: auth.session.userId },
      data: { ...(parsed.data.theme ? { theme: parsed.data.theme } : {}), ...(parsed.data.displayName ? { displayName: encryptField(parsed.data.displayName) } : {}) },
      select: { id: true, username: true, displayName: true, role: true, theme: true },
    });
    if (parsed.data.currency || parsed.data.locale) await tx.$executeRaw`UPDATE "User" SET "currency" = COALESCE(${parsed.data.currency || null}, "currency"), "locale" = COALESCE(${parsed.data.locale || null}, "locale") WHERE "id" = ${auth.session.userId}::uuid`;
    if (parsed.data.avatarData !== undefined) await tx.$executeRaw`UPDATE "User" SET "avatarData" = ${parsed.data.avatarData} WHERE "id" = ${auth.session.userId}::uuid`;
    await tx.auditLog.create({
      data: {
        actorId: auth.session.userId,
        action: "profile.updated",
        subject: auth.session.userId,
        details: { theme: updated.theme, displayNameChanged: Boolean(parsed.data.displayName), avatarChanged: parsed.data.avatarData !== undefined },
      },
    });
    return updated;
  });
  const profile = await auth.db.$queryRaw<Array<{ theme: string; currency: string; locale: string; avatarData: string }>>`SELECT "theme", "currency", "locale", "avatarData" FROM "User" WHERE "id" = ${auth.session.userId}::uuid LIMIT 1`;
  return NextResponse.json({ theme: user.theme, profile: profile[0] });
}
