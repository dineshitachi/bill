import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth";
import { buildCashFlowForecast } from "@/server/cash-flow-forecast";

export async function GET(request: Request) {
  const auth = await requirePermission("reports.read");
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") || 30);
  const openingBalance = Number(url.searchParams.get("openingBalance") || 0);
  if (![30, 60, 90].includes(days)) return NextResponse.json({ error: "Forecast horizon must be 30, 60, or 90 days" }, { status: 400 });
  if (!Number.isFinite(openingBalance) || openingBalance < 0) return NextResponse.json({ error: "Opening cash must be a non-negative number" }, { status: 400 });

  const now = new Date();
  const historyStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const expenseStart = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const [receivables, payments, expenses] = await Promise.all([
    auth.db.$queryRaw<Array<{ issuedAt: Date; balance: string }>>`
      SELECT "issuedAt", GREATEST("grandTotal" - "amountPaid", 0)::text AS balance
      FROM "Invoice"
      WHERE "status" = 'INVOICE' AND "grandTotal" > "amountPaid"
    `,
    auth.db.$queryRaw<Array<{ issuedAt: Date; receivedAt: Date; amount: string }>>`
      SELECT i."issuedAt", p."receivedAt", p."amount"::text AS amount
      FROM "PaymentTransaction" p
      JOIN "Invoice" i ON i."id" = p."invoiceId"
      WHERE i."status" = 'INVOICE' AND p."receivedAt" >= ${historyStart} AND p."receivedAt" <= ${now}
    `,
    auth.db.$queryRaw<Array<{ total: string }>>`
      SELECT COALESCE(SUM("amount"), 0)::text AS total
      FROM "Expense"
      WHERE "occurredAt" >= ${expenseStart} AND "occurredAt" <= ${now}
    `,
  ]);

  return NextResponse.json(buildCashFlowForecast({
    now,
    days,
    openingBalance,
    receivables,
    payments,
    historicalExpenses: Number(expenses[0]?.total || 0),
  }));
}