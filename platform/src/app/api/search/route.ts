import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { decryptCustomer, decryptField, decryptInvoiceWithPayments } from "@/server/field-encryption";
import { jsonError } from "@/server/http";

export async function GET(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const term = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  if (term.length < 2) return NextResponse.json({ results: [] });
  try {
    const [products, customers, invoices, quotations, vendors, purchaseOrders, interactions] = await Promise.all([
      auth.db.product.findMany({ where: { OR: [{ name: { contains: term, mode: "insensitive" } }, { sku: { contains: term, mode: "insensitive" } }, { hsnCode: { contains: term, mode: "insensitive" } }] }, take: 20 }),
      auth.db.customer.findMany({ take: 200 }),
      auth.db.invoice.findMany({ include: { items: true, payments: { orderBy: { receivedAt: "asc" } } }, orderBy: { issuedAt: "desc" }, take: 200 }),
      auth.db.$queryRaw<Array<{ id: string; number: string; status: string; total: string }>>`SELECT "id", "number", "status", "total"::text AS "total" FROM "Quotation" WHERE LOWER("number") LIKE ${`%${term}%`} OR LOWER("status") LIKE ${`%${term}%`} ORDER BY "createdAt" DESC LIMIT 20`,
      auth.db.$queryRaw<Array<{ id: string; name: string; phone: string; email: string }>>`SELECT "id", "name", "phone", "email" FROM "Vendor" ORDER BY "name" ASC LIMIT 200`,
      auth.db.$queryRaw<Array<{ id: string; number: string; status: string }>>`SELECT "id", "number", "status" FROM "PurchaseOrder" WHERE LOWER("number") LIKE ${`%${term}%`} OR LOWER("status") LIKE ${`%${term}%`} ORDER BY "createdAt" DESC LIMIT 20`,
      auth.db.$queryRaw<Array<{ id: string; subject: string; kind: string }>>`SELECT "id", "subject", "kind" FROM "CrmInteraction" WHERE LOWER("subject") LIKE ${`%${term}%`} OR LOWER("kind") LIKE ${`%${term}%`} ORDER BY "createdAt" DESC LIMIT 20`,
    ]);
    const results = [
      ...products.map((product) => ({ id: product.id, entity: "product", title: product.name, detail: `SKU ${product.sku}`, tab: "inventory" })),
      ...customers.map(decryptCustomer).filter((customer) => `${customer.name} ${customer.phone} ${customer.email} ${customer.gstin}`.toLowerCase().includes(term)).map((customer) => ({ id: customer.id, entity: "customer", title: customer.name, detail: customer.phone || "Customer", tab: "customers" })),
      ...invoices.map((invoice) => decryptInvoiceWithPayments(invoice)).filter((invoice) => `${invoice.number} ${invoice.customerName} ${invoice.paymentStatus}`.toLowerCase().includes(term)).map((invoice) => ({ id: invoice.id, entity: "invoice", title: invoice.number, detail: `${invoice.customerName} · ${invoice.paymentStatus}`, tab: "invoices" })),
      ...quotations.map((quotation) => ({ id: quotation.id, entity: "quotation", title: quotation.number, detail: `${quotation.status} · ${quotation.total}`, tab: "quotation" })),
      ...vendors.map((vendor) => ({ ...vendor, name: decryptField(vendor.name), phone: decryptField(vendor.phone), email: decryptField(vendor.email) })).filter((vendor) => `${vendor.name} ${vendor.phone} ${vendor.email}`.toLowerCase().includes(term)).map((vendor) => ({ id: vendor.id, entity: "vendor", title: vendor.name, detail: vendor.phone || "Vendor", tab: "vendors" })),
      ...purchaseOrders.map((order) => ({ id: order.id, entity: "purchase-order", title: order.number, detail: order.status, tab: "vendors" })),
      ...interactions.map((interaction) => ({ id: interaction.id, entity: "crm", title: interaction.subject, detail: interaction.kind, tab: "crm" })),
    ];
    return NextResponse.json({ results: results.slice(0, 30) });
  } catch (error) {
    console.error("Global search failed", error);
    return jsonError("Global search is temporarily unavailable", 500);
  }
}
