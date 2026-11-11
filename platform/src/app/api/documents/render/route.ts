import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { renderDocumentTemplate, type DocumentModel } from "@/server/document-templates";

const schema = z.object({
  kind: z.enum(["invoice", "quotation", "receipt"]), number: z.string().trim().min(1).max(80), issuedAt: z.string().datetime(), currency: z.string().trim().toUpperCase().length(3), locale: z.string().max(32).optional(),
  seller: z.object({ name: z.string().max(160), legalName: z.string().max(160).optional(), taxId: z.string().max(80).optional(), address: z.string().max(500).optional() }),
  customer: z.object({ name: z.string().max(160), taxId: z.string().max(80).optional(), address: z.string().max(500).optional() }),
  lines: z.array(z.object({ name: z.string().max(160), sku: z.string().max(80).optional(), quantity: z.number().positive(), unitPrice: z.number(), taxRate: z.number().optional(), taxableValue: z.number().optional(), taxTotal: z.number().optional(), total: z.number() })).min(1).max(500),
  subtotal: z.number(), discount: z.number().optional(), taxTotal: z.number(), total: z.number(), amountPaid: z.number().optional(), balanceDue: z.number().optional(), terms: z.string().max(5000).optional(),
});

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid document model");
  const result = renderDocumentTemplate(parsed.data as DocumentModel);
  return NextResponse.json(result);
}
