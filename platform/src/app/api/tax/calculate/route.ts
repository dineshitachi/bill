import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { calculateLocalizedTax } from "@/server/tax-engine";

const schema = z.object({
  amount: z.number().finite().min(0), rate: z.number().finite().min(0).max(100).default(0),
  taxType: z.enum(["GST", "VAT", "SALES_TAX"]).default("GST"), ruleCode: z.string().trim().toUpperCase().max(40).optional(), origin: z.string().max(80).optional(), destination: z.string().max(80).optional(),
  sellerStateCode: z.string().max(10).optional(), placeOfSupplyStateCode: z.string().max(10).optional(),
});

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid tax calculation");
  let rate = parsed.data.rate;
  let taxType = parsed.data.taxType;
  if (parsed.data.ruleCode) {
    const rules = await auth.db.$queryRaw<Array<{ rate: string; taxType: "GST" | "VAT" | "SALES_TAX"; origin: string; destination: string }>>`SELECT "rate"::text AS "rate", "taxType", "origin", "destination" FROM "TaxRule" WHERE "code" = ${parsed.data.ruleCode} AND "active" = TRUE LIMIT 1`;
    if (!rules[0]) return jsonError("Tax rule not found", 404);
    if ((rules[0].origin && rules[0].origin !== (parsed.data.origin || parsed.data.sellerStateCode || "")) || (rules[0].destination && rules[0].destination !== (parsed.data.destination || parsed.data.placeOfSupplyStateCode || ""))) return jsonError("Tax rule nexus does not match this transaction", 409);
    rate = Number(rules[0].rate); taxType = rules[0].taxType;
  }
  return NextResponse.json({ calculation: calculateLocalizedTax({ ...parsed.data, rate, taxType }) });
}
