import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { decryptField, encryptField } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ category: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(500), amount: z.number().finite().positive(), currency: z.string().trim().toUpperCase().length(3).default("INR"), occurredAt: z.string().datetime(), vendorId: z.string().uuid().optional(), attachmentName: z.string().trim().max(160).default(""), attachmentData: z.string().max(8_000_000).default("") });

export async function GET(request: Request) {
  const auth = await requirePermission("expenses.write");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url); const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
  const expenses = from && to
    ? await auth.db.$queryRaw`SELECT "id", "category", "description", "amount", "currency", "occurredAt", "vendorId", "attachmentName", "createdBy", "createdAt" FROM "Expense" WHERE "occurredAt" >= ${new Date(from)} AND "occurredAt" < ${new Date(to)} ORDER BY "occurredAt" DESC`
    : await auth.db.$queryRaw`SELECT "id", "category", "description", "amount", "currency", "occurredAt", "vendorId", "attachmentName", "createdBy", "createdAt" FROM "Expense" ORDER BY "occurredAt" DESC LIMIT 500`;
  return NextResponse.json({ expenses: (expenses as Array<{ description: string; [key: string]: unknown }>).map((expense) => ({ ...expense, description: decryptField(expense.description) })) });
}

export async function POST(request: Request) {
  const auth = await requirePermission("expenses.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid expense");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "Expense" ("id", "category", "description", "amount", "currency", "occurredAt", "vendorId", "attachmentName", "attachmentData", "createdBy") VALUES (${id}::uuid, ${parsed.data.category}, ${encryptField(parsed.data.description)}, ${parsed.data.amount}, ${parsed.data.currency}, ${new Date(parsed.data.occurredAt)}, ${parsed.data.vendorId || null}::uuid, ${parsed.data.attachmentName}, ${encryptField(parsed.data.attachmentData)}, ${auth.session.username})`;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "expense.created", subject: id, details: { category: parsed.data.category, amount: parsed.data.amount, currency: parsed.data.currency } } });
  return NextResponse.json({ expense: { id, ...parsed.data, attachmentData: undefined } }, { status: 201 });
}
