import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ amount: z.number().finite().positive() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("A valid milestone payment is required");
  const { id } = await context.params;
  try {
    const result = await auth.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ amount: string; paidAmount: string }>>`SELECT "amount"::text AS "amount", "paidAmount"::text AS "paidAmount" FROM "BillingMilestone" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const milestone = rows[0]; if (!milestone) throw new Error("Milestone not found");
    const nextPaid = Number(milestone.paidAmount) + parsed.data.amount;
    if (nextPaid > Number(milestone.amount)) throw new Error("Payment exceeds milestone amount");
    await tx.$executeRaw`UPDATE "BillingMilestone" SET "paidAmount" = ${nextPaid}, "status" = ${nextPaid >= Number(milestone.amount) ? "PAID" : "PARTIAL"}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
    await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "billing.milestone.paid", subject: id, details: { amount: parsed.data.amount, totalPaid: nextPaid } } });
    return { paidAmount: nextPaid, status: nextPaid >= Number(milestone.amount) ? "PAID" : "PARTIAL" };
    });
    return NextResponse.json({ milestone: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Milestone payment failed";
    if (/exceeds|not found/i.test(message)) return jsonError(message, 409);
    console.error("Milestone payment failed", error);
    return jsonError("Milestone payment failed", 500);
  }
}
