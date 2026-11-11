import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ baseCurrency: z.string().trim().toUpperCase().length(3), currency: z.string().trim().toUpperCase().length(3), rate: z.number().finite().positive(), source: z.string().trim().max(80).default("manual") });

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const rates = await auth.db.$queryRaw`SELECT * FROM "CurrencyRate" ORDER BY "currency" ASC`;
  return NextResponse.json({ rates });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success || parsed.data.baseCurrency === parsed.data.currency) return jsonError("Invalid currency rate");
  const id = randomUUID();
  await auth.db.$executeRaw`
    INSERT INTO "CurrencyRate" ("id", "baseCurrency", "currency", "rate", "asOf", "source") VALUES (${id}::uuid, ${parsed.data.baseCurrency}, ${parsed.data.currency}, ${parsed.data.rate}, CURRENT_TIMESTAMP, ${parsed.data.source})
    ON CONFLICT ("baseCurrency", "currency") DO UPDATE SET "rate" = EXCLUDED."rate", "asOf" = CURRENT_TIMESTAMP, "source" = EXCLUDED."source"
  `;
  return NextResponse.json({ ok: true, ...parsed.data }, { status: 201 });
}
