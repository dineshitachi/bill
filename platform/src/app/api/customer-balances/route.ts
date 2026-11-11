import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { decryptField, decryptInvoiceWithPayments } from "@/server/field-encryption";

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const where = { status: "INVOICE" };
  const [totals, pendingInvoices, completedInvoices, recentPayments, paymentTotals, pendingCount, completedCount] = await Promise.all([
    auth.db.invoice.groupBy({
      by: ["customerId"],
      where,
      _sum: { grandTotal: true, amountPaid: true },
    }),
    auth.db.invoice.findMany({
      where: { ...where, paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
      include: { items: true, payments: { orderBy: { receivedAt: "asc" } } },
      orderBy: { issuedAt: "asc" },
    }),
    auth.db.invoice.findMany({
      where: { ...where, paymentStatus: "PAID" },
      include: { items: true, payments: { orderBy: { receivedAt: "asc" } } },
      orderBy: { issuedAt: "desc" },
      take: 200,
    }),
    auth.db.paymentTransaction.findMany({
      where: {
        invoice: {
          is: {
            status: "INVOICE",
          },
        },
      },
      include: { invoice: { include: { items: true, payments: { orderBy: { receivedAt: "asc" } } } } },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    auth.db.invoice.aggregate({
      where,
      _sum: { grandTotal: true, amountPaid: true },
    }),
    auth.db.invoice.count({ where: { ...where, paymentStatus: { in: ["UNPAID", "PARTIAL"] } } }),
    auth.db.invoice.count({ where: { ...where, paymentStatus: "PAID" } }),
  ]);
  const balances = totals.flatMap(({ customerId, _sum }) => {
    if (!customerId) return [];
    const billed = Number(_sum.grandTotal || 0);
    const paid = Number(_sum.amountPaid || 0);
    return [{ customerId, billed, paid, due: Math.max(0, billed - paid) }];
  });
  return NextResponse.json({
    balances,
    pendingInvoices: pendingInvoices.map((invoice) => decryptInvoiceWithPayments(invoice)),
    completedInvoices: completedInvoices.map((invoice) => decryptInvoiceWithPayments(invoice)),
    recentPayments: recentPayments.map((payment) => ({
      ...payment,
      paymentMethod: decryptField(payment.paymentMethod),
      receivedBy: decryptField(payment.receivedBy),
      invoice: decryptInvoiceWithPayments(payment.invoice),
    })),
    paymentSummary: {
      totalBilled: Number(paymentTotals._sum.grandTotal || 0),
      totalReceived: Number(paymentTotals._sum.amountPaid || 0),
      pendingCount,
      completedCount,
    },
  });
}
