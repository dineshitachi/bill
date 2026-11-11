import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/), name: z.string().trim().min(1).max(120), minimumSubtotal: z.number().finite().min(0), maximumSubtotal: z.number().finite().positive().optional(), percentage: z.number().finite().min(0).max(100), active: z.boolean().default(true) });

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const tiers = await auth.db.$queryRaw`SELECT * FROM "DiscountTier" WHERE "active" = TRUE ORDER BY "minimumSubtotal" ASC`;
  return NextResponse.json({ tiers });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success || (parsed.data.maximumSubtotal !== undefined && parsed.data.maximumSubtotal <= parsed.data.minimumSubtotal)) return jsonError("Invalid discount tier");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "DiscountTier" ("id", "code", "name", "minimumSubtotal", "maximumSubtotal", "percentage", "active") VALUES (${id}::uuid, ${parsed.data.code}, ${parsed.data.name}, ${parsed.data.minimumSubtotal}, ${parsed.data.maximumSubtotal ?? null}, ${parsed.data.percentage}, ${parsed.data.active})`;
  return NextResponse.json({ tier: { id, ...parsed.data } }, { status: 201 });
}
