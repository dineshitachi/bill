import { requireSession } from "@/server/auth";
import { decryptField } from "@/server/field-encryption";
import { invoiceLedgerCsv } from "@/server/ledger";

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const invoices = await auth.db.invoice.findMany({
    where: { status: "INVOICE" },
    include: { items: true },
    orderBy: { issuedAt: "asc" },
  });
  const csv = invoiceLedgerCsv(invoices.map((invoice) => ({
    ...invoice,
    customerName: decryptField(invoice.customerName),
    customerGstin: decryptField(invoice.customerGstin),
  })));
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="sales-ledger.csv"',
      "cache-control": "no-store",
    },
  });
}