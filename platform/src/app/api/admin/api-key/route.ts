import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";

export async function POST() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const apiKey = `nbp_${randomBytes(32).toString("base64url")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  await prisma.tenant.update({ where: { id: auth.session.tenantId }, data: { apiKeyHash } });
  await auth.db.auditLog.create({
    data: { actorId: auth.session.userId, action: "tenant.api-key.rotated", subject: auth.session.tenantId, details: {} },
  });
  return NextResponse.json({ apiKey, warning: "This key is shown once. Previous tenant node credentials are now invalid." });
}
