import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,40}$/), name: z.string().trim().min(1).max(120), customerCategory: z.string().trim().max(40).default(""), items: z.array(z.object({ productId: z.string().uuid(), minQuantity: z.number().positive().default(1), unitPrice: z.number().finite().nonnegative() })).max(1000).default([]) });

export async function GET() {
  const auth = await requirePermission("inventory.read");
  if ("response" in auth) return auth.response;
  const cards = await auth.db.$queryRaw`SELECT * FROM "RateCard" WHERE "active" = TRUE ORDER BY "name" ASC`;
  return NextResponse.json({ rateCards: cards });
}

export async function POST(request: Request) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid rate card");
  const id = randomUUID();
  try {
    await auth.db.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "RateCard" ("id", "code", "name", "customerCategory") VALUES (${id}::uuid, ${parsed.data.code}, ${parsed.data.name}, ${parsed.data.customerCategory})`;
      for (const item of parsed.data.items) await tx.$executeRaw`INSERT INTO "RateCardItem" ("id", "rateCardId", "productId", "minQuantity", "unitPrice") VALUES (${randomUUID()}::uuid, ${id}::uuid, ${item.productId}::uuid, ${item.minQuantity}, ${item.unitPrice})`;
    });
    return NextResponse.json({ rateCard: { id, code: parsed.data.code, name: parsed.data.name } }, { status: 201 });
  } catch (error) { console.error("Rate card creation failed", error); return jsonError("Rate card could not be created", 409); }
}
