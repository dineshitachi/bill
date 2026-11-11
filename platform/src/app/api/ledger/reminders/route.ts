import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { decryptCustomer } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ customerId: z.string().uuid(), channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).default("WHATSAPP"), invoiceId: z.string().uuid().optional() });

export async function POST(request: Request) {
  const auth = await requirePermission("payments.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid reminder request");
  const customer = await auth.db.customer.findUnique({ where: { id: parsed.data.customerId } });
  if (!customer) return jsonError("Customer not found", 404);
  const data = decryptCustomer(customer);
  const dueRows = await auth.db.$queryRaw<Array<{ due: string }>>`SELECT COALESCE(SUM("grandTotal" - "amountPaid"), 0)::text AS "due" FROM "Invoice" WHERE "customerId" = ${parsed.data.customerId}::uuid AND "paymentStatus" IN ('UNPAID', 'PARTIAL')`;
  const due = Number(dueRows[0]?.due || 0); const message = `Payment reminder for ${data.name}: balance due is ₹${due.toFixed(2)}. Please review your Bill My Book statement.`;
  const normalized = data.phone.replace(/\D/g, ""); const phone = normalized.length === 10 ? `91${normalized}` : normalized;
  const links = { whatsapp: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : "", sms: data.phone ? `sms:${data.phone}?body=${encodeURIComponent(message)}` : "", email: data.email ? `mailto:${data.email}?subject=${encodeURIComponent("Payment reminder")}&body=${encodeURIComponent(message)}` : "" };
  await auth.db.$executeRaw`INSERT INTO "PaymentReminder" ("id", "partyType", "partyId", "invoiceId", "channel", "status", "message", "createdBy") VALUES (${randomUUID()}::uuid, 'CUSTOMER', ${parsed.data.customerId}::uuid, ${parsed.data.invoiceId || null}::uuid, ${parsed.data.channel}, 'READY', ${message}, ${auth.session.username})`;
  return NextResponse.json({ reminder: { due, message, links } }, { status: 201 });
}
