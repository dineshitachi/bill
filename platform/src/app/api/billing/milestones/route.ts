import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({
  customerId: z.string().uuid().optional(), name: z.string().trim().min(1).max(120),
  dueDate: z.string().datetime().optional(), amount: z.number().finite().positive(), currency: z.string().trim().toUpperCase().length(3).default("INR"),
});

export async function GET() {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const milestones = await auth.db.$queryRaw`SELECT * FROM "BillingMilestone" ORDER BY "dueDate" ASC NULLS LAST, "createdAt" DESC LIMIT 500`;
  return NextResponse.json({ milestones });
}

export async function POST(request: Request) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid billing milestone");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "BillingMilestone" ("id", "customerId", "name", "dueDate", "amount", "currency", "createdBy") VALUES (${id}::uuid, ${parsed.data.customerId || null}::uuid, ${parsed.data.name}, ${parsed.data.dueDate ? new Date(parsed.data.dueDate) : null}, ${parsed.data.amount}, ${parsed.data.currency}, ${auth.session.username})`;
  return NextResponse.json({ milestone: { id, status: "PLANNED", ...parsed.data } }, { status: 201 });
}
