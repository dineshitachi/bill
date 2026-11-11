import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/), name: z.string().trim().min(1).max(120), taxType: z.enum(["GST", "VAT", "SALES_TAX"]), rate: z.number().finite().min(0).max(100), origin: z.string().trim().max(80).default(""), destination: z.string().trim().max(80).default(""), nexus: z.record(z.string(), z.string()).default({}), active: z.boolean().default(true) });

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const rules = await auth.db.$queryRaw`SELECT * FROM "TaxRule" WHERE "active" = TRUE ORDER BY "code" ASC`;
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid tax rule");
  try {
    const rule = await auth.db.$queryRaw`
      INSERT INTO "TaxRule" ("id", "code", "name", "taxType", "rate", "origin", "destination", "nexus", "active")
      VALUES (${randomUUID()}::uuid, ${parsed.data.code}, ${parsed.data.name}, ${parsed.data.taxType}, ${parsed.data.rate}, ${parsed.data.origin}, ${parsed.data.destination}, ${JSON.stringify(parsed.data.nexus)}::jsonb, ${parsed.data.active}) RETURNING *
    `;
    await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "tax-rule.created", subject: parsed.data.code, details: { rate: parsed.data.rate, taxType: parsed.data.taxType } } });
    return NextResponse.json({ rule: rule[0] }, { status: 201 });
  } catch (error) {
    console.error("Tax rule creation failed", error); return jsonError("Tax rule could not be created", 409);
  }
}
