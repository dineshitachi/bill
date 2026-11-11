import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { decryptInvoiceWithPayments } from "@/server/field-encryption";
import { jsonError } from "@/server/http";

export async function GET() {
  const auth = await requireSession(["CUSTOMER"]);
  if ("response" in auth) return auth.response;
  const scope = await auth.db.$queryRaw<Array<{ customerId: string | null }>>`SELECT "customerId" FROM "User" WHERE "id" = ${auth.session.userId}::uuid LIMIT 1`;
  if (!scope[0]?.customerId) return jsonError("Customer portal is not linked to a customer record", 403);
  const invoices = await auth.db.invoice.findMany({ where: { customerId: scope[0].customerId }, include: { items: true, payments: { orderBy: { receivedAt: "asc" } } }, orderBy: { issuedAt: "desc" }, take: 200 });
  return NextResponse.json({ invoices: invoices.map((invoice) => decryptInvoiceWithPayments(invoice)) });
}
