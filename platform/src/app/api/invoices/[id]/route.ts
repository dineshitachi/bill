import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { decryptInvoiceWithPayments, encryptField } from "@/server/field-encryption";

const paymentSchema = z.object({
  amount: z.number().finite().positive().max(1_000_000_000)
    .refine((amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7),
  paymentMethod: z.string().trim().max(40).default(""),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const invoice = await auth.db.invoice.findUnique({ where: { id } });
  if (!invoice) return jsonError("Invoice not found", 404);
  const body = await readJson(request);
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid payment details");
  const paidCents = Math.round(Number(invoice.amountPaid) * 100);
  const totalCents = Math.round(Number(invoice.grandTotal) * 100);
  const amountCents = Math.round(parsed.data.amount * 100);
  if (amountCents > totalCents - paidCents) {
    return jsonError("Payment cannot exceed the invoice balance");
  }
  const amountPaid = (paidCents + amountCents) / 100;
  const paymentStatus = amountPaid >= Number(invoice.grandTotal) ? "PAID" : "PARTIAL";
  try {
    const updated = await auth.db.$transaction(async (tx) => {
      const changed = await tx.invoice.updateMany({
        where: { id: invoice.id, amountPaid: invoice.amountPaid },
        data: {
          amountPaid: { increment: amountCents / 100 },
          paymentMethod: encryptField(parsed.data.paymentMethod),
          paymentStatus,
        },
      });
      if (changed.count !== 1) throw new Error("Invoice payment was updated by another request");
      await tx.paymentTransaction.create({
        data: {
          invoiceId: invoice.id,
          amount: amountCents / 100,
          paymentMethod: encryptField(parsed.data.paymentMethod),
          receivedBy: encryptField(auth.session.username),
        },
      });
      if (invoice.customerId) await tx.$executeRaw`INSERT INTO "PartyLedgerEntry" ("id", "partyType", "partyId", "referenceType", "referenceId", "referenceNumber", "debit", "credit", "description", "createdBy") VALUES (${randomUUID()}::uuid, 'CUSTOMER', ${invoice.customerId}::uuid, 'PAYMENT', ${invoice.id}, ${invoice.number}, 0, ${amountCents / 100}, 'Payment received', ${auth.session.username})`;
      const saved = await tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: { items: true, payments: { orderBy: { receivedAt: "asc" } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.session.userId,
          action: "invoice.payment.updated",
          subject: invoice.id,
          details: {
            amount: amountCents / 100,
            amountPaid: Number(saved.amountPaid),
            paymentStatus,
          },
        },
      });
      return saved;
    });
    return NextResponse.json({
      invoice: decryptInvoiceWithPayments(updated),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Invoice payment was updated by another request") {
      return jsonError("The invoice balance changed while recording payment. Refresh and try again.", 409);
    }
    console.error("Invoice payment update failed", error);
    return jsonError("Payment could not be recorded", 500);
  }
}
