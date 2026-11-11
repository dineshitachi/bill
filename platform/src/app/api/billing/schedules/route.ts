import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({
  customerId: z.string().uuid().optional(), name: z.string().trim().min(1).max(120),
  frequency: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]), intervalCount: z.number().int().min(1).max(12).default(1),
  startAt: z.string().datetime(), nextRunAt: z.string().datetime().optional(), endAt: z.string().datetime().optional(),
  currency: z.string().trim().toUpperCase().length(3).default("INR"),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().positive(), unitPrice: z.number().nonnegative(), taxRate: z.number().min(0).max(100), prorationFactor: z.number().finite().positive().max(10).default(1) })).min(1).max(100),
});

export async function GET() {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const schedules = await auth.db.$queryRaw`SELECT "id", "customerId", "name", "status", "frequency", "intervalCount", "nextRunAt", "startAt", "endAt", "currency", "items", "createdBy", "createdAt", "updatedAt" FROM "BillingSchedule" ORDER BY "nextRunAt" ASC`;
  return NextResponse.json({ schedules });
}

export async function POST(request: Request) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid recurring billing schedule");
  const id = randomUUID();
  const nextRunAt = parsed.data.nextRunAt || parsed.data.startAt;
  await auth.db.$executeRaw`
    INSERT INTO "BillingSchedule" ("id", "customerId", "name", "frequency", "intervalCount", "nextRunAt", "startAt", "endAt", "currency", "items", "createdBy")
    VALUES (${id}::uuid, ${parsed.data.customerId || null}::uuid, ${parsed.data.name}, ${parsed.data.frequency}, ${parsed.data.intervalCount}, ${new Date(nextRunAt)}, ${new Date(parsed.data.startAt)}, ${parsed.data.endAt ? new Date(parsed.data.endAt) : null}, ${parsed.data.currency}, ${JSON.stringify(parsed.data.items)}::jsonb, ${auth.session.username})
  `;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "billing.schedule.created", subject: id, details: { frequency: parsed.data.frequency } } });
  return NextResponse.json({ schedule: { id, status: "ACTIVE", nextRunAt, currency: parsed.data.currency } }, { status: 201 });
}
