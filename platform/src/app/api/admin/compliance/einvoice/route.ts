import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSubscription } from "@/server/subscription";
import { decryptInvoiceWithPayments } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

export async function POST(request: Request) {
  const auth = await requireSubscription("compliance.einvoice", ["ADMIN"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request); const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : "";
  if (!invoiceId) return jsonError("Invoice id is required");
  const invoiceRecord = await auth.db.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: { orderBy: { receivedAt: "asc" } } } });
  if (!invoiceRecord) return jsonError("Invoice not found", 404);
  const invoice = decryptInvoiceWithPayments(invoiceRecord);
  const payload = { Version: "1.1", TranDtls: { TaxSch: "GST", SupTyp: "B2B" }, DocDtls: { Typ: "INV", No: invoice.number, Dt: invoice.issuedAt.slice(0, 10) }, SellerDtls: { Gstin: invoice.sellerGstin, LglNm: invoice.sellerLegalName }, BuyerDtls: { Gstin: invoice.customerGstin, LglNm: invoice.customerName }, ItemList: invoice.items.map((item) => ({ PrdDesc: item.name, HsnCd: item.hsnCode, Qty: Number(item.quantity), UnitPrice: Number(item.unitPrice), TaxableValue: Number(item.taxableValue), GstRt: Number(item.gstRate), IgstAmt: Number(item.igst), CgstAmt: Number(item.cgst), SgstAmt: Number(item.sgst), TotItemVal: Number(item.total) })), ValDtls: { AssVal: Number(invoice.subtotal) - Number(invoice.discount), IgstVal: invoice.items.reduce((sum, item) => sum + Number(item.igst), 0), CgstVal: invoice.items.reduce((sum, item) => sum + Number(item.cgst), 0), SgstVal: invoice.items.reduce((sum, item) => sum + Number(item.sgst), 0), TotInvVal: Number(invoice.grandTotal) } };
  const providerUrl = process.env.EINVOICE_PROVIDER_URL?.trim(); const token = process.env.EINVOICE_PROVIDER_TOKEN?.trim() || "";
  let status = "READY"; let provider = "local-payload"; let responsePayload: unknown = payload; let irn = ""; let qrPayload = JSON.stringify({ invoice: invoice.number, seller: invoice.sellerGstin, buyer: invoice.customerGstin, total: invoice.grandTotal });
  if (providerUrl) {
    try {
      const endpoint = new URL(providerUrl); if (endpoint.protocol !== "https:") throw new Error("Provider must use HTTPS");
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000), cache: "no-store" });
      responsePayload = await response.json().catch(() => ({})); if (!response.ok) return jsonError("E-invoice provider rejected the payload", 502);
      if (typeof responsePayload === "object" && responsePayload !== null) { const data = responsePayload as Record<string, unknown>; irn = typeof data.Irn === "string" ? data.Irn : typeof data.irn === "string" ? data.irn : ""; qrPayload = typeof data.SignedQRCode === "string" ? data.SignedQRCode : qrPayload; }
      status = irn ? "SUBMITTED" : "PROVIDER_ACCEPTED"; provider = endpoint.hostname;
    } catch (error) { console.error("E-invoice provider failed", error); return jsonError("E-invoice provider could not be reached", 502); }
  }
  await auth.db.$executeRaw`INSERT INTO "EInvoiceRecord" ("id", "invoiceId", "irn", "ackNumber", "qrPayload", "status", "provider", "response") VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, ${irn}, '', ${qrPayload}, ${status}, ${provider}, ${JSON.stringify(responsePayload)}::jsonb) ON CONFLICT ("invoiceId") DO UPDATE SET "irn" = EXCLUDED."irn", "qrPayload" = EXCLUDED."qrPayload", "status" = EXCLUDED."status", "provider" = EXCLUDED."provider", "response" = EXCLUDED."response", "updatedAt" = CURRENT_TIMESTAMP`;
  return NextResponse.json({ status, provider, irn, qrPayload, payload, providerConfigured: Boolean(providerUrl) });
}
