import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { decryptField, encryptField } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().max(32).default(""), email: z.string().trim().email().or(z.literal("")).default(""), taxId: z.string().trim().max(32).default(""), address: z.string().trim().max(500).default(""), currency: z.string().trim().toUpperCase().length(3).default("INR"), paymentTermsDays: z.number().int().min(0).max(365).default(30) });
const expose = <T extends { name: string; phone: string; email: string; taxId: string; address: string }>(vendor: T) => ({ ...vendor, name: decryptField(vendor.name), phone: decryptField(vendor.phone), email: decryptField(vendor.email), taxId: decryptField(vendor.taxId), address: decryptField(vendor.address) });

export async function GET() {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const vendors = await auth.db.$queryRaw<Array<{ name: string; phone: string; email: string; taxId: string; address: string; [key: string]: unknown }>>`SELECT * FROM "Vendor" ORDER BY "name" ASC`;
  return NextResponse.json({ vendors: vendors.map(expose) });
}

export async function POST(request: Request) {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid vendor details");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "Vendor" ("id", "name", "phone", "email", "taxId", "address", "currency", "paymentTermsDays") VALUES (${id}::uuid, ${encryptField(parsed.data.name)}, ${encryptField(parsed.data.phone)}, ${encryptField(parsed.data.email)}, ${encryptField(parsed.data.taxId)}, ${encryptField(parsed.data.address)}, ${parsed.data.currency}, ${parsed.data.paymentTermsDays})`;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "vendor.created", subject: id, details: {} } });
  return NextResponse.json({ vendor: { id, ...parsed.data } }, { status: 201 });
}
