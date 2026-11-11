import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ partyType: z.enum(["CUSTOMER", "VENDOR"]), partyId: z.string().uuid(), referenceType: z.string().trim().max(40), referenceId: z.string().trim().max(80), referenceNumber: z.string().trim().max(80).default(""), debit: z.number().finite().min(0).default(0), credit: z.number().finite().min(0).default(0), dueDate: z.string().datetime().optional(), description: z.string().max(500).default("") });

export async function GET(request: Request) {
  const auth = await requirePermission("reports.read");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url); const partyType = url.searchParams.get("partyType") || "CUSTOMER"; const partyId = url.searchParams.get("partyId");
  if (!["CUSTOMER", "VENDOR"].includes(partyType)) return jsonError("partyType must be CUSTOMER or VENDOR");
  if (!partyId) {
    const summaries = await auth.db.$queryRaw`SELECT "partyType", "partyId", COALESCE(SUM("debit"), 0)::text AS "debit", COALESCE(SUM("credit"), 0)::text AS "credit", COALESCE(SUM("debit" - "credit"), 0)::text AS "balance" FROM "PartyLedgerEntry" WHERE "partyType" = ${partyType} GROUP BY "partyType", "partyId" ORDER BY "balance" DESC`;
    return NextResponse.json({ partyType, summaries });
  }
  const entries = await auth.db.$queryRaw<Array<{ debit: string; credit: string; dueDate: Date | null; createdAt: Date; [key: string]: unknown }>>`SELECT * FROM "PartyLedgerEntry" WHERE "partyType" = ${partyType} AND "partyId" = ${partyId}::uuid ORDER BY "createdAt" ASC`;
  const now = Date.now(); const aging = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
  for (const entry of entries) { const due = entry.dueDate?.getTime() || entry.createdAt.getTime(); const age = Math.max(0, Math.floor((now - due) / 86_400_000)); const balance = Math.max(0, Number(entry.debit) - Number(entry.credit)); if (age <= 30) aging.days30 += balance; else if (age <= 60) aging.days60 += balance; else if (age <= 90) aging.days90 += balance; else aging.over90 += balance; }
  const debit = entries.reduce((sum, entry) => sum + Number(entry.debit), 0); const credit = entries.reduce((sum, entry) => sum + Number(entry.credit), 0);
  return NextResponse.json({ partyType, partyId, entries, summary: { debit, credit, balance: debit - credit, aging } });
}

export async function POST(request: Request) {
  const auth = await requirePermission("reports.read");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success || parsed.data.debit === 0 && parsed.data.credit === 0) return jsonError("Invalid ledger entry");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "PartyLedgerEntry" ("id", "partyType", "partyId", "referenceType", "referenceId", "referenceNumber", "debit", "credit", "dueDate", "description", "createdBy") VALUES (${id}::uuid, ${parsed.data.partyType}, ${parsed.data.partyId}::uuid, ${parsed.data.referenceType}, ${parsed.data.referenceId}, ${parsed.data.referenceNumber}, ${parsed.data.debit}, ${parsed.data.credit}, ${parsed.data.dueDate ? new Date(parsed.data.dueDate) : null}, ${parsed.data.description}, ${auth.session.username})`;
  return NextResponse.json({ id }, { status: 201 });
}
