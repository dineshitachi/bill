import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth";
import { decryptInvoiceWithPayments } from "@/server/field-encryption";

export async function GET(request: Request) {
  const auth = await requirePermission("reports.read");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url); const report = url.searchParams.get("report") || "gstr1"; const format = url.searchParams.get("format") || "json"; const year = Number(url.searchParams.get("year") || new Date().getFullYear());
  const invoices = (await auth.db.invoice.findMany({ where: { status: "INVOICE", issuedAt: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lt: new Date(`${year + 1}-01-01T00:00:00.000Z`) } }, include: { items: true, payments: { orderBy: { receivedAt: "asc" } } }, orderBy: { issuedAt: "asc" } })).map((invoice) => decryptInvoiceWithPayments(invoice));
  const notes = await auth.db.$queryRaw<Array<{ noteType: string; total: string; taxTotal: string; status: string }>>`SELECT "noteType", "total"::text AS "total", "taxTotal"::text AS "taxTotal", "status" FROM "CreditDebitNote" WHERE "status" = 'POSTED' AND EXTRACT(YEAR FROM "createdAt") = ${year}`;
  const hsn = new Map<string, { taxable: number; tax: number; total: number; quantity: number }>();
  for (const invoice of invoices) for (const item of invoice.items) { const current = hsn.get(item.hsnCode || "UNSPECIFIED") || { taxable: 0, tax: 0, total: 0, quantity: 0 }; current.taxable += Number(item.taxableValue); current.tax += Number(item.cgst) + Number(item.sgst) + Number(item.igst); current.total += Number(item.total); current.quantity += Number(item.quantity); hsn.set(item.hsnCode || "UNSPECIFIED", current); }
  const data = report === "gstr3b"
    ? { report, year, outwardSupplies: invoices.reduce((sum, invoice) => sum + Number(invoice.grandTotal), 0), taxLiability: invoices.reduce((sum, invoice) => sum + Number(invoice.taxTotal), 0) - notes.reduce((sum, note) => sum + (note.noteType === "CREDIT" || note.noteType === "SALES_RETURN" ? Number(note.taxTotal) : -Number(note.taxTotal)), 0), notes }
      : report === "gstr2b" ? { report, year, purchaseOrders: await auth.db.$queryRaw`SELECT * FROM "PurchaseOrder" WHERE EXTRACT(YEAR FROM "createdAt") = ${year}` }
        : { report: "gstr1", year, invoices, hsnSummary: [...hsn.entries()].map(([hsnCode, values]) => ({ hsnCode, ...values })), creditDebitNotes: notes };
  if (format === "json") return new NextResponse(JSON.stringify(data), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${report}-${year}.json"` } });
  const rows = report === "gstr1" ? (data as { invoices: typeof invoices }).invoices.map((invoice) => [invoice.number, invoice.customerName, invoice.issuedAt, invoice.subtotal, invoice.taxTotal, invoice.grandTotal].join(",")) : [JSON.stringify(data)];
  return new NextResponse(["document,customer,date,taxable,tax,total", ...rows].join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${report}-${year}.csv"` } });
}
