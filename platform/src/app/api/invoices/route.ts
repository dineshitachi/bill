import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { allocateDiscountCents, calculateTax } from "@/gst";
import { requireSession } from "@/server/auth";
import { requireSubscription } from "@/server/subscription";
import { prisma } from "@/server/db";
import { jsonError, readJson } from "@/server/http";
import { decryptCustomer, decryptInvoiceWithPayments, decryptTenant, encryptField } from "@/server/field-encryption";
import { createLedgerCsv } from "@/server/ledger";

const invoiceSchema = z.object({
  customerId: z.string().uuid().optional(),
  placeOfSupplyStateCode: z.string().regex(/^\d{2}$/),
  discount: z.number().finite().min(0).max(1_000_000_000).default(0),
  discountTierCode: z.string().trim().toUpperCase().max(40).optional(),
  amountPaid: z.number().finite().min(0).max(1_000_000_000).default(0),
  paymentMethod: z.string().trim().max(40).default(""),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().finite().positive().max(1_000_000),
  })).min(1).max(100),
});

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const invoices = await auth.db.invoice.findMany({
    include: { items: true, payments: { orderBy: { receivedAt: "asc" } } },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ invoices: invoices.map((invoice) => decryptInvoiceWithPayments(invoice)) });
}

export async function POST(request: Request) {
  const auth = await requireSubscription("invoice.create", ["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid invoice details");
  const company = await prisma.tenant.findUnique({
    where: { id: auth.session.tenantId },
    select: { name: true, legalName: true, gstin: true, stateCode: true, upiId: true, logoData: true, theme: true },
  });
  if (!company) return jsonError("Business configuration was not found", 404);
  const issuer = decryptTenant(company);
  const selectedCustomer = parsed.data.customerId
    ? await auth.db.customer.findUnique({ where: { id: parsed.data.customerId } })
    : null;
  if (parsed.data.customerId && !selectedCustomer) return jsonError("Customer was not found", 404);

  try {
    const invoice = await auth.db.$transaction(async (tx) => {
      const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      if (products.length !== productIds.length) throw new Error("One or more products were not found");
      // Hold row locks for the full calculation and stock decrement. The
      // guarded update below remains the final invariant against overselling.
      for (const productId of productIds) {
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId}::uuid FOR UPDATE`;
      }
      const byId = new Map(products.map((product) => [product.id, product]));
      const grossLines = parsed.data.items.map((line) => {
        const product = byId.get(line.productId)!;
        if (Number(product.stock) < line.quantity) throw new Error(`Not enough stock for ${product.name}`);
        return { line, product, grossValue: Math.round(line.quantity * Number(product.price) * 100) / 100 };
      });
      const subtotal = grossLines.reduce((sum, line) => sum + line.grossValue, 0);
      let discount = parsed.data.discount;
      if (parsed.data.discountTierCode) {
        const tiers = await tx.$queryRaw<Array<{ minimumSubtotal: string; maximumSubtotal: string | null; percentage: string }>>`SELECT "minimumSubtotal"::text AS "minimumSubtotal", "maximumSubtotal"::text AS "maximumSubtotal", "percentage"::text AS "percentage" FROM "DiscountTier" WHERE "code" = ${parsed.data.discountTierCode} AND "active" = TRUE LIMIT 1`;
        const tier = tiers[0];
        if (!tier || subtotal < Number(tier.minimumSubtotal) || (tier.maximumSubtotal !== null && subtotal > Number(tier.maximumSubtotal))) throw new Error("Discount tier does not apply to this subtotal");
        discount = Math.max(discount, Math.round(subtotal * Number(tier.percentage)) / 100);
      }
      if (discount > subtotal) throw new Error("Discount cannot exceed the subtotal");

      const discountAllocations = allocateDiscountCents(discount, grossLines.map((item) => item.grossValue));
      const calculated = grossLines.map(({ line, product, grossValue }, index) => {
        const discountCents = discountAllocations[index];
        const taxableValue = Math.round((grossValue - discountCents / 100) * 100) / 100;
        const tax = calculateTax(
          1,
          taxableValue,
          Number(product.gstRate),
          company.stateCode,
          parsed.data.placeOfSupplyStateCode,
        );
        return {
          product,
          line,
          taxableValue,
          cgst: tax.cgst,
          sgst: tax.sgst,
          igst: tax.igst,
          total: tax.total,
        };
      });
      const taxable = calculated.reduce((sum, item) => sum + item.taxableValue, 0);
      const taxTotal = calculated.reduce((sum, item) => sum + item.cgst + item.sgst + item.igst, 0);
      const exactTotal = Math.round((taxable + taxTotal) * 100) / 100;
      const grandTotal = Math.round(exactTotal);
      const roundOff = Math.round((grandTotal - exactTotal) * 100) / 100;
      if (parsed.data.amountPaid > grandTotal) throw new Error("Payment cannot exceed the invoice total");
      const paymentStatus = grandTotal > 0 && parsed.data.amountPaid >= grandTotal
        ? "PAID"
        : parsed.data.amountPaid > 0 ? "PARTIAL" : "UNPAID";
      const year = new Date().getFullYear();
      await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("year", "nextNumber") VALUES (${year}, 1) ON CONFLICT ("year") DO NOTHING`;
      const sequence = await tx.$queryRaw<Array<{ nextNumber: number }>>`SELECT "nextNumber" FROM "InvoiceSequence" WHERE "year" = ${year} FOR UPDATE`;
      const nextNumber = Number(sequence[0]?.nextNumber || 1);
      await tx.$executeRaw`UPDATE "InvoiceSequence" SET "nextNumber" = "nextNumber" + 1 WHERE "year" = ${year}`;
      const number = `INV-${year}-${String(nextNumber).padStart(6, "0")}`;
      const customer = selectedCustomer ? decryptCustomer(selectedCustomer) : null;

      for (const item of calculated) {
        const stockUpdate = await tx.product.updateMany({
          where: { id: item.product.id, stock: { gte: item.line.quantity } },
          data: { stock: { decrement: item.line.quantity } },
        });
        if (stockUpdate.count !== 1) throw new Error(`Stock changed before checkout for ${item.product.name}`);
      }

      const created = await tx.invoice.create({
        data: {
          number,
          customerId: selectedCustomer?.id,
          customerName: encryptField(customer?.name || "Walk-in customer"),
          customerGstin: encryptField(customer?.gstin || ""),
          sellerBrandName: encryptField(issuer.name),
          sellerLogoData: encryptField(issuer.logoData),
          sellerLegalName: encryptField(issuer.legalName),
          sellerGstin: encryptField(issuer.gstin),
          sellerStateCode: issuer.stateCode,
          placeOfSupplyStateCode: parsed.data.placeOfSupplyStateCode,
          subtotal: Math.round(subtotal * 100) / 100,
          discount: Math.round(discount * 100) / 100,
          taxTotal: Math.round(taxTotal * 100) / 100,
          roundOff,
          grandTotal,
          amountPaid: parsed.data.amountPaid,
          paymentStatus,
          paymentMethod: encryptField(parsed.data.paymentMethod),
          upiId: encryptField(issuer.upiId),
          theme: issuer.theme,
          createdBy: auth.session.username,
          items: {
            create: calculated.map((item) => ({
              productId: item.product.id,
              name: item.product.name,
              hsnCode: item.product.hsnCode,
              quantity: item.line.quantity,
              unitPrice: item.product.price,
              gstRate: item.product.gstRate,
              taxableValue: item.taxableValue,
              cgst: item.cgst,
              sgst: item.sgst,
              igst: item.igst,
              total: item.total,
            })),
          },
          payments: parsed.data.amountPaid > 0 ? {
            create: {
              amount: parsed.data.amountPaid,
              paymentMethod: encryptField(parsed.data.paymentMethod),
              receivedBy: encryptField(auth.session.username),
            },
          } : undefined,
        },
        include: { items: true, payments: { orderBy: { receivedAt: "asc" } } },
      });
      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          invoiceId: created.id,
          invoiceNumber: created.number,
          issuedAt: created.issuedAt,
          customerDetails: encryptField(JSON.stringify(customer ? {
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
            gstin: customer.gstin,
            state: customer.state,
            address: customer.address,
          } : { name: "Walk-in customer" })),
          itemizedBreakdown: JSON.stringify(created.items.map((item) => ({
            sku: products.find((product) => product.id === item.productId)?.sku || "",
            name: item.name,
            quantity: item.quantity.toString(),
            unitPrice: item.unitPrice.toString(),
            taxableValue: item.taxableValue.toString(),
            cgst: item.cgst.toString(),
            sgst: item.sgst.toString(),
            igst: item.igst.toString(),
            total: item.total.toString(),
          }))),
          taxTotal: created.taxTotal,
          grandTotal: created.grandTotal,
        },
      });
      if (selectedCustomer?.id) {
        await tx.$executeRaw`INSERT INTO "PartyLedgerEntry" ("id", "partyType", "partyId", "referenceType", "referenceId", "referenceNumber", "debit", "credit", "dueDate", "description", "createdBy") VALUES (${randomUUID()}::uuid, 'CUSTOMER', ${selectedCustomer.id}::uuid, 'INVOICE', ${created.id}, ${created.number}, ${created.grandTotal}, 0, ${created.issuedAt}, 'Invoice issued', ${auth.session.username})`;
        if (parsed.data.amountPaid > 0) await tx.$executeRaw`INSERT INTO "PartyLedgerEntry" ("id", "partyType", "partyId", "referenceType", "referenceId", "referenceNumber", "debit", "credit", "description", "createdBy") VALUES (${randomUUID()}::uuid, 'CUSTOMER', ${selectedCustomer.id}::uuid, 'PAYMENT', ${created.id}, ${created.number}, 0, ${parsed.data.amountPaid}, 'Initial payment', ${auth.session.username})`;
      }
      await tx.auditLog.create({
        data: {
          actorId: auth.session.userId,
          action: "invoice.created",
          subject: created.id,
          details: { number, grandTotal, paymentStatus },
        },
      });
      return { invoice: created, ledgerEntry };
    });
    return NextResponse.json({
      invoice: decryptInvoiceWithPayments(invoice.invoice, true),
      ledgerCsv: createLedgerCsv([invoice.ledgerEntry]),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /stock|found|discount|payment/i.test(error.message)) return jsonError(error.message, 409);
    console.error("Invoice creation failed", error);
    return jsonError("Invoice could not be created", 500);
  }
}
