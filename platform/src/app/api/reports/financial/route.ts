import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth";

export async function GET(request: Request) {
  const auth = await requirePermission("reports.read");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(new Date().getFullYear(), 0, 1);
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date();
  const [sales, expenses, inventory] = await Promise.all([
    auth.db.$queryRaw<Array<{ revenue: string; tax: string; received: string }>>`SELECT COALESCE(SUM("grandTotal"), 0)::text AS revenue, COALESCE(SUM("taxTotal"), 0)::text AS tax, COALESCE(SUM("amountPaid"), 0)::text AS received FROM "Invoice" WHERE "issuedAt" >= ${from} AND "issuedAt" <= ${to}`,
    auth.db.$queryRaw<Array<{ total: string }>>`SELECT COALESCE(SUM("amount"), 0)::text AS total FROM "Expense" WHERE "occurredAt" >= ${from} AND "occurredAt" <= ${to}`,
    auth.db.$queryRaw<Array<{ value: string }>>`SELECT COALESCE(SUM("price" * "stock"), 0)::text AS value FROM "Product"`,
  ]);
  const revenue = Number(sales[0]?.revenue || 0); const expenseTotal = Number(expenses[0]?.total || 0);
  return NextResponse.json({ period: { from, to }, profitAndLoss: { revenue, expenses: expenseTotal, grossProfit: revenue - expenseTotal, tax: Number(sales[0]?.tax || 0) }, cashFlow: { receipts: Number(sales[0]?.received || 0), expenses: expenseTotal, net: Number(sales[0]?.received || 0) - expenseTotal }, balanceSheet: { inventoryValue: Number(inventory[0]?.value || 0), receivables: Math.max(0, revenue - Number(sales[0]?.received || 0)) } });
}
