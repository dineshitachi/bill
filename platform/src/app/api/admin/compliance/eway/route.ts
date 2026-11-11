import { NextResponse } from "next/server";
import { requireSubscription } from "@/server/subscription";
import { decryptField, decryptInvoiceWithPayments } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";
import { canPrepareLocalEWayPayload, canStartEWayOperation, ewayProviderSuccessStatus } from "@/server/eway-workflow";
import { randomUUID } from "node:crypto";

const transportSchema = z.object({
  mode: z.enum(["ROAD", "RAIL", "AIR", "SHIP"]),
  approximateDistance: z.number().int().min(1).max(4000),
  vehicleNumber: z.string().trim().toUpperCase().max(20).default(""),
  transporterId: z.string().trim().toUpperCase().max(20).default(""),
}).refine((transport) => transport.mode !== "ROAD" || transport.vehicleNumber !== "" || transport.transporterId !== "", "Road transport requires a vehicle number or transporter ID");

const actionSchema = z.object({
  action: z.enum(["CREATE", "UPDATE", "CANCEL"]),
  invoiceId: z.string().uuid(),
  transport: transportSchema.optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

export async function GET(request: Request) {
  const auth = await requireSubscription("compliance.einvoice", ["ADMIN"]);
  if ("response" in auth) return auth.response;
  const invoiceId = new URL(request.url).searchParams.get("invoiceId") || "";
  if (!z.string().uuid().safeParse(invoiceId).success) return jsonError("A valid invoice id is required");
  const [records, integrations] = await Promise.all([
    auth.db.$queryRaw<EWayRecord[]>`
      SELECT "id", "ewayBillNumber", "status", "transportMode", "approximateDistance", "vehicleNumber", "transporterId", "provider", "payload", "response", "updatedAt"
      FROM "EWayBillRecord" WHERE "invoiceId" = ${invoiceId}::uuid LIMIT 1
    `,
    auth.db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "IntegrationConnection" WHERE "provider" = 'eway' AND "enabled" = TRUE LIMIT 1`,
  ]);
  return NextResponse.json({ record: records[0] || null, providerConfigured: Boolean(process.env.EWAY_PROVIDER_URL?.trim() || integrations.length) });
}

export async function POST(request: Request) {
  const auth = await requireSubscription("compliance.einvoice", ["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = actionSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid E-Way bill action or transport details");
  const { action, invoiceId, transport, reason } = parsed.data;
  if (action !== "CANCEL" && !transport) return jsonError("Transport mode and journey details are required");
  if (action === "CANCEL" && !reason) return jsonError("A cancellation reason is required");

  const invoiceRecord = await auth.db.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true, payments: { orderBy: { receivedAt: "asc" } } },
  });
  if (!invoiceRecord) return jsonError("Invoice not found", 404);
  if (invoiceRecord.status !== "INVOICE") return jsonError("E-Way bills require an issued tax invoice", 409);
  const invoice = decryptInvoiceWithPayments(invoiceRecord);
  const threshold = Number(process.env.EWAY_MIN_VALUE || 50_000);
  if (!Number.isFinite(threshold) || threshold < 0) return jsonError("E-Way threshold configuration is invalid", 503);
  if (action === "CREATE" && Number(invoice.grandTotal) < threshold) {
    return NextResponse.json({ status: "NOT_REQUIRED", reason: `Invoice value is below the configured threshold of ${threshold}`, invoiceId });
  }

  const integrations = await auth.db.$queryRaw<Array<{ baseUrl: string; secret: string }>>`
    SELECT "baseUrl", "secret" FROM "IntegrationConnection" WHERE "provider" = 'eway' AND "enabled" = TRUE LIMIT 1
  `;
  const providerUrl = process.env.EWAY_PROVIDER_URL?.trim() || integrations[0]?.baseUrl || "";
  const providerToken = process.env.EWAY_PROVIDER_TOKEN?.trim() || decryptField(integrations[0]?.secret || "");
  const payload = {
    supplyType: "OUTWARD",
    documentType: "INV",
    documentNumber: invoice.number,
    documentDate: invoice.issuedAt.toISOString().slice(0, 10),
    sellerGstin: invoice.sellerGstin,
    buyerGstin: invoice.customerGstin,
    fromStateCode: invoice.sellerStateCode,
    toStateCode: invoice.placeOfSupplyStateCode,
    taxableValue: Number(invoice.subtotal) - Number(invoice.discount),
    taxValue: Number(invoice.taxTotal),
    totalValue: Number(invoice.grandTotal),
    items: invoice.items.map((item) => ({ hsnCode: item.hsnCode, quantity: Number(item.quantity), taxableValue: Number(item.taxableValue), taxRate: Number(item.gstRate) })),
    transport: action === "CANCEL" ? undefined : transport,
    cancellationReason: action === "CANCEL" ? reason : undefined,
  };

  if (!providerUrl) {
    if (action !== "CREATE") return jsonError("A configured authorized E-Way provider is required for update or cancellation", 503);
    try {
      await auth.db.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "EWayBillRecord" ("id", "invoiceId", "status")
          VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, 'READY')
          ON CONFLICT ("invoiceId") DO NOTHING
        `;
        const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "EWayBillRecord" WHERE "invoiceId" = ${invoiceId}::uuid FOR UPDATE`;
        if (!canPrepareLocalEWayPayload(rows[0]?.status)) throw new Error("An existing E-Way bill cannot be replaced by a local payload");
        await tx.$executeRaw`
          UPDATE "EWayBillRecord" SET "status" = 'READY', "transportMode" = ${transport!.mode}, "approximateDistance" = ${transport!.approximateDistance},
            "vehicleNumber" = ${transport!.vehicleNumber}, "transporterId" = ${transport!.transporterId}, "provider" = 'local-payload',
            "payload" = ${JSON.stringify(payload)}::jsonb, "response" = '{}'::jsonb, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "invoiceId" = ${invoiceId}::uuid
        `;
        await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "eway.payload.prepared", subject: invoiceId, details: { invoiceNumber: invoice.number } } });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "E-Way payload could not be prepared";
      return jsonError(message, /existing E-Way/i.test(message) ? 409 : 500);
    }
    return NextResponse.json({ status: "READY", providerConfigured: false, payload });
  }

  let endpoint: URL;
  try { endpoint = new URL(providerUrl); } catch { return jsonError("E-Way provider URL is invalid", 503); }
  if (endpoint.protocol !== "https:") return jsonError("E-Way provider must use HTTPS", 503);

  const operationId = randomUUID();
  let previousStatus = "";
  let existingBillNumber = "";
  try {
    await auth.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "EWayBillRecord" ("id", "invoiceId", "status")
        VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, 'READY')
        ON CONFLICT ("invoiceId") DO NOTHING
      `;
      const rows = await tx.$queryRaw<Array<{ status: string; ewayBillNumber: string; transportMode: string; approximateDistance: number; vehicleNumber: string; transporterId: string }>>`
        SELECT "status", "ewayBillNumber", "transportMode", "approximateDistance", "vehicleNumber", "transporterId"
        FROM "EWayBillRecord" WHERE "invoiceId" = ${invoiceId}::uuid FOR UPDATE
      `;
      const current = rows[0];
      if (!canStartEWayOperation(action, current?.status, current?.ewayBillNumber)) {
        if (action === "CREATE") throw new Error("An E-Way bill already exists or has an unresolved provider result");
        throw new Error("Only a provider-confirmed E-Way bill can be updated or cancelled");
      }
      if (action === "CREATE") {
        previousStatus = current?.status || "READY";
      } else {
        if (!current) throw new Error("Only a provider-confirmed E-Way bill can be updated or cancelled");
        previousStatus = current.status;
        existingBillNumber = current.ewayBillNumber;
      }
      const pendingStatus = action === "CREATE" ? "SUBMITTING" : action === "UPDATE" ? "UPDATING" : "CANCELLING";
      await tx.$executeRaw`
        INSERT INTO "EWayBillRecord" ("id", "invoiceId", "status", "transportMode", "approximateDistance", "vehicleNumber", "transporterId", "provider", "payload", "operationId")
        VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, ${pendingStatus}, ${transport?.mode || current?.transportMode || ""}, ${transport?.approximateDistance || current?.approximateDistance || 0}, ${transport?.vehicleNumber || current?.vehicleNumber || ""}, ${transport?.transporterId || current?.transporterId || ""}, ${endpoint.hostname}, ${JSON.stringify(payload)}::jsonb, ${operationId}::uuid)
        ON CONFLICT ("invoiceId") DO UPDATE SET "status" = EXCLUDED."status", "transportMode" = EXCLUDED."transportMode", "approximateDistance" = EXCLUDED."approximateDistance", "vehicleNumber" = EXCLUDED."vehicleNumber", "transporterId" = EXCLUDED."transporterId", "provider" = EXCLUDED."provider", "payload" = EXCLUDED."payload", "operationId" = EXCLUDED."operationId", "updatedAt" = CURRENT_TIMESTAMP
      `;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "E-Way operation could not be started";
    return jsonError(message, /already exists|unresolved|confirmed|updated or cancelled/i.test(message) ? 409 : 500);
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(providerToken ? { authorization: `Bearer ${providerToken}` } : {}) },
      body: JSON.stringify({ action, requestId: operationId, ewayBillNumber: existingBillNumber || undefined, payload }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (error) {
    await auth.db.$executeRaw`
      UPDATE "EWayBillRecord" SET "status" = 'UNKNOWN', "response" = ${JSON.stringify({ error: error instanceof Error ? error.message : "Provider unavailable" })}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "invoiceId" = ${invoiceId}::uuid AND "operationId" = ${operationId}::uuid
    `;
    return jsonError("Provider result is unknown; reconcile with the provider before retrying", 502);
  }

  const providerResponse: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = action === "CREATE" ? "FAILED" : previousStatus;
    await auth.db.$executeRaw`
      UPDATE "EWayBillRecord" SET "status" = ${status}, "response" = ${JSON.stringify(providerResponse)}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "invoiceId" = ${invoiceId}::uuid AND "operationId" = ${operationId}::uuid
    `;
    return jsonError("E-Way provider rejected the request", 502);
  }
  const result = typeof providerResponse === "object" && providerResponse !== null ? providerResponse as Record<string, unknown> : {};
  const billNumber = typeof result.ewayBillNumber === "string" ? result.ewayBillNumber : typeof result.ewbNo === "string" ? result.ewbNo : existingBillNumber;
  const status = ewayProviderSuccessStatus(action, billNumber);
  await auth.db.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "EWayBillRecord" SET "status" = ${status}, "ewayBillNumber" = ${billNumber}, "response" = ${JSON.stringify(providerResponse)}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "invoiceId" = ${invoiceId}::uuid AND "operationId" = ${operationId}::uuid
    `;
    await tx.auditLog.create({ data: { actorId: auth.session.userId, action: `eway.${action.toLowerCase()}`, subject: invoiceId, details: { invoiceNumber: invoice.number, status, ewayBillNumber: billNumber } } });
  });
  return NextResponse.json({ status, providerConfigured: true, ewayBillNumber: billNumber, payload, response: providerResponse });
}

export async function POST(request: Request) {
  const auth = await requireSubscription("compliance.einvoice", ["ADMIN"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request); const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId : ""; const transport = typeof body?.transport === "object" && body.transport !== null ? body.transport : {};
  if (!invoiceId) return jsonError("Invoice id is required");
  const record = await auth.db.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: { orderBy: { receivedAt: "asc" } } } });
  if (!record) return jsonError("Invoice not found", 404);
  const invoice = decryptInvoiceWithPayments(record); const value = Number(invoice.grandTotal);
  if (value < 50_000) return NextResponse.json({ status: "NOT_REQUIRED", reason: "Configured threshold is ₹50,000", invoiceId });
  const payload = { supplyType: "OUTWARD", documentNumber: invoice.number, documentDate: invoice.issuedAt.slice(0, 10), taxableValue: Number(invoice.subtotal) - Number(invoice.discount), taxValue: Number(invoice.taxTotal), totalValue: value, transport };
  const providerUrl = process.env.EWAY_PROVIDER_URL?.trim();
  if (!providerUrl) return NextResponse.json({ status: "READY", providerConfigured: false, payload });
  try {
    const endpoint = new URL(providerUrl); if (endpoint.protocol !== "https:") return jsonError("E-way bill provider must use HTTPS", 503);
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(process.env.EWAY_PROVIDER_TOKEN ? { authorization: `Bearer ${process.env.EWAY_PROVIDER_TOKEN}` } : {}) }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const result: unknown = await response.json().catch(() => ({})); if (!response.ok) return jsonError("E-way bill provider rejected the payload", 502);
    return NextResponse.json({ status: "SUBMITTED", providerConfigured: true, payload, response: result });
  } catch (error) { console.error("E-way bill provider failed", error); return jsonError("E-way bill provider could not be reached", 502); }
}
