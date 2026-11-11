import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ customerId: z.string().uuid(), kind: z.enum(["CALL", "EMAIL", "MEETING", "NOTE", "REMINDER"]), subject: z.string().trim().min(1).max(160), body: z.string().max(5000).default(""), dueAt: z.string().datetime().optional() });

export async function GET(request: Request) {
  const auth = await requirePermission("crm.write");
  if ("response" in auth) return auth.response;
  const customerId = new URL(request.url).searchParams.get("customerId");
  const interactions = customerId
    ? await auth.db.$queryRaw`SELECT * FROM "CrmInteraction" WHERE "customerId" = ${customerId}::uuid ORDER BY "createdAt" DESC LIMIT 500`
    : await auth.db.$queryRaw`SELECT * FROM "CrmInteraction" ORDER BY "createdAt" DESC LIMIT 500`;
  return NextResponse.json({ interactions });
}

export async function POST(request: Request) {
  const auth = await requirePermission("crm.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid CRM interaction");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "CrmInteraction" ("id", "customerId", "kind", "subject", "body", "dueAt", "createdBy") VALUES (${id}::uuid, ${parsed.data.customerId}::uuid, ${parsed.data.kind}, ${parsed.data.subject}, ${parsed.data.body}, ${parsed.data.dueAt ? new Date(parsed.data.dueAt) : null}, ${auth.session.username})`;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "crm.interaction.created", subject: id, details: { customerId: parsed.data.customerId, kind: parsed.data.kind } } });
  return NextResponse.json({ interaction: { id, ...parsed.data, createdBy: auth.session.username } }, { status: 201 });
}
