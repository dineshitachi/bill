import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { isGstinFormatValid } from "@/gst";
import { decryptCustomer, encryptField } from "@/server/field-encryption";

const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(32).default(""),
  email: z.string().trim().email().or(z.literal("")).default(""),
  gstin: z.string().trim().toUpperCase().max(15).default(""),
  state: z.string().trim().max(80).default(""),
  stateCode: z.string().regex(/^\d{2}$/).default("33"),
  address: z.string().trim().max(500).default(""),
});

function encryptedCustomer(data: z.infer<typeof customerSchema>) {
  return {
    name: encryptField(data.name), phone: encryptField(data.phone), email: encryptField(data.email),
    gstin: encryptField(data.gstin), state: encryptField(data.state), stateCode: encryptField(data.stateCode),
    address: encryptField(data.address),
  };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = customerSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid customer details");
  if (parsed.data.gstin && !isGstinFormatValid(parsed.data.gstin)) return jsonError("GSTIN format is invalid");
  try {
    const customer = await auth.db.customer.update({ where: { id }, data: encryptedCustomer(parsed.data) });
    await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "customer.updated", subject: id, details: {} } });
    return NextResponse.json({ customer: decryptCustomer(customer) });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return jsonError("Customer not found", 404);
    console.error("Customer update failed", error);
    return jsonError("Customer could not be updated", 500);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const customer = await auth.db.customer.findUnique({ where: { id } });
  if (!customer) return jsonError("Customer not found", 404);
  const referenced = await auth.db.invoice.count({ where: { customerId: id } });
  if (referenced) return jsonError("This customer has invoices and cannot be deleted", 409);
  await auth.db.$transaction([
    auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "customer.deleted", subject: id, details: {} } }),
    auth.db.customer.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
