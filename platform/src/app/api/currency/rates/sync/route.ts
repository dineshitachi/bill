import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";
import { randomUUID } from "node:crypto";

export async function POST() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const configured = process.env.EXCHANGE_RATE_URL?.trim();
  if (!configured) return jsonError("Exchange-rate provider is not configured", 503);
  const regional = await prisma.$queryRaw<Array<{ baseCurrency: string }>>`SELECT "baseCurrency" FROM "Tenant" WHERE "id" = ${auth.session.tenantId}::uuid LIMIT 1`;
  const baseCurrency = regional[0]?.baseCurrency || "INR";
  let endpoint: URL;
  try { endpoint = new URL(configured.replace("{base}", baseCurrency)); } catch { return jsonError("Exchange-rate provider URL is invalid", 503); }
  if (endpoint.protocol !== "https:" || ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(endpoint.hostname)) return jsonError("Exchange-rate provider must use a public HTTPS endpoint", 503);
  try {
    const response = await fetch(endpoint, { headers: process.env.EXCHANGE_RATE_TOKEN ? { authorization: `Bearer ${process.env.EXCHANGE_RATE_TOKEN}` } : {}, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!response.ok) return jsonError("Exchange-rate provider is unavailable", 502);
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("rates" in payload) || typeof payload.rates !== "object" || payload.rates === null) return jsonError("Exchange-rate provider returned an unsupported response", 502);
    const rates = Object.entries(payload.rates as Record<string, unknown>).filter((entry): entry is [string, number] => /^[A-Z]{3}$/.test(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0).slice(0, 200);
    await auth.db.$transaction(async (tx) => {
      for (const [currency, rate] of rates) await tx.$executeRaw`INSERT INTO "CurrencyRate" ("id", "baseCurrency", "currency", "rate", "asOf", "source") VALUES (${randomUUID()}::uuid, ${baseCurrency}, ${currency}, ${rate}, CURRENT_TIMESTAMP, 'provider') ON CONFLICT ("baseCurrency", "currency") DO UPDATE SET "rate" = EXCLUDED."rate", "asOf" = CURRENT_TIMESTAMP, "source" = 'provider'`;
      await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "currency.rates.synced", subject: baseCurrency, details: { count: rates.length } } });
    });
    return NextResponse.json({ baseCurrency, updated: rates.length });
  } catch (error) {
    console.error("Exchange-rate sync failed", error); return jsonError("Exchange-rate provider could not be reached", 502);
  }
}
