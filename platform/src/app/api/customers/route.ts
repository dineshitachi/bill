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

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const customers = (await auth.db.customer.findMany()).map(decryptCustomer)
    .sort((first, second) => first.name.localeCompare(second.name));
  return NextResponse.json({ customers });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid customer details");
  if (parsed.data.gstin && !isGstinFormatValid(parsed.data.gstin)) return jsonError("GSTIN format is invalid");
  const customer = await auth.db.customer.create({
    data: {
      ...parsed.data,
      name: encryptField(parsed.data.name),
      phone: encryptField(parsed.data.phone),
      email: encryptField(parsed.data.email),
      gstin: encryptField(parsed.data.gstin),
      state: encryptField(parsed.data.state),
      stateCode: encryptField(parsed.data.stateCode),
      address: encryptField(parsed.data.address),
    },
  });
  await auth.db.auditLog.create({
    data: { actorId: auth.session.userId, action: "customer.created", subject: customer.id, details: {} },
  });
  return NextResponse.json({ customer: decryptCustomer(customer) }, { status: 201 });
}
