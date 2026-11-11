import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { jsonError, readJson } from "@/server/http";
import { isGstinFormatValid } from "@/gst";
import { isCompanyLogoDataUrl, MAX_LOGO_DATA_URL_LENGTH } from "@/logo";
import { decryptTenant, encryptField } from "@/server/field-encryption";

const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2).max(120),
  gstin: z.string().trim().toUpperCase().max(15).default(""),
  stateCode: z.string().regex(/^\d{2}$/),
  upiId: z.string().trim().max(100).default(""),
  logoData: z.string().max(MAX_LOGO_DATA_URL_LENGTH).refine(
    (value) => value === "" || isCompanyLogoDataUrl(value),
    "Upload a resized PNG, JPEG, or WebP logo",
  ).default(""),
  theme: z.enum(["luxe", "corporate", "industrial", "thermal", "thermal58", "thermal80", "gst"]),
  lowStockNotifications: z.boolean().default(true),
  paymentNotifications: z.boolean().default(true),
});

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const company = await prisma.tenant.findUnique({
    where: { id: auth.session.tenantId },
    select: { name: true, legalName: true, gstin: true, stateCode: true, upiId: true, logoData: true, theme: true, lowStockNotifications: true, paymentNotifications: true },
  });
  return NextResponse.json({ company: company ? decryptTenant(company) : null });
}

export async function PUT(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = companySchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid business settings");
  if (parsed.data.gstin && !isGstinFormatValid(parsed.data.gstin)) return jsonError("GSTIN format is invalid");
  const company = await prisma.tenant.update({
    where: { id: auth.session.tenantId },
    data: {
      ...parsed.data,
      name: encryptField(parsed.data.name),
      legalName: encryptField(parsed.data.legalName),
      gstin: encryptField(parsed.data.gstin),
      upiId: encryptField(parsed.data.upiId),
      logoData: encryptField(parsed.data.logoData),
    },
    select: { name: true, legalName: true, gstin: true, stateCode: true, upiId: true, logoData: true, theme: true, lowStockNotifications: true, paymentNotifications: true },
  });
  await auth.db.auditLog.create({
    data: { actorId: auth.session.userId, action: "company.updated", subject: auth.session.tenantId, details: {} },
  });
  return NextResponse.json({ company: decryptTenant(company) });
}
