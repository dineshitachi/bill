import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { encryptField } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ provider: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/), baseUrl: z.string().url().refine((value) => value.startsWith("https://"), "HTTPS is required"), secret: z.string().max(500).default(""), enabled: z.boolean().default(true) });

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const integrations = await auth.db.$queryRaw`SELECT "id", "provider", "baseUrl", "enabled", "createdBy", "createdAt", "updatedAt" FROM "IntegrationConnection" ORDER BY "provider" ASC`;
  return NextResponse.json({ integrations });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid integration configuration");
  const hostname = new URL(parsed.data.baseUrl).hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) || hostname.endsWith(".local")) return jsonError("Private integration hosts are not allowed", 400);
  const id = randomUUID();
  await auth.db.$executeRaw`
    INSERT INTO "IntegrationConnection" ("id", "provider", "baseUrl", "secret", "enabled", "createdBy") VALUES (${id}::uuid, ${parsed.data.provider}, ${parsed.data.baseUrl.replace(/\/$/, "")}, ${encryptField(parsed.data.secret)}, ${parsed.data.enabled}, ${auth.session.username})
    ON CONFLICT ("provider") DO UPDATE SET "baseUrl" = EXCLUDED."baseUrl", "secret" = CASE WHEN EXCLUDED."secret" = '' THEN "IntegrationConnection"."secret" ELSE EXCLUDED."secret" END, "enabled" = EXCLUDED."enabled", "updatedAt" = CURRENT_TIMESTAMP
  `;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "integration.updated", subject: id, details: { provider: parsed.data.provider, enabled: parsed.data.enabled } } });
  return NextResponse.json({ integration: { id, provider: parsed.data.provider, baseUrl: parsed.data.baseUrl, enabled: parsed.data.enabled } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider) return jsonError("Provider is required");
  const result = await auth.db.$executeRaw`DELETE FROM "IntegrationConnection" WHERE "provider" = ${provider}`;
  if (!result) return jsonError("Integration not found", 404);
  return NextResponse.json({ ok: true });
}
