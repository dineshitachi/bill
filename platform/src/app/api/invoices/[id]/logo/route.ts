import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";
import { decryptField } from "@/server/field-encryption";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const invoice = await auth.db.invoice.findUnique({
    where: { id },
    select: { sellerLogoData: true },
  });
  if (!invoice) return jsonError("Invoice not found", 404);
  return NextResponse.json({ logoData: decryptField(invoice.sellerLogoData) }, {
    headers: { "cache-control": "private, no-store" },
  });
}
