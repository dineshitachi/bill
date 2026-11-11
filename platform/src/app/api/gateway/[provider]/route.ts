import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { decryptField } from "@/server/field-encryption";
import { isRecord, jsonError, readJson } from "@/server/http";

const requestCounts = new Map<string, { startedAt: number; count: number }>();

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const { provider } = await context.params;
  if (!/^[a-z0-9][a-z0-9_-]{1,48}$/.test(provider)) return jsonError("Invalid integration provider");
  const key = `${auth.session.tenantId}:${auth.session.userId}:${provider}`;
  const now = Date.now(); const window = requestCounts.get(key);
  if (!window || now - window.startedAt > 60_000) requestCounts.set(key, { startedAt: now, count: 1 });
  else if (window.count >= 60) return jsonError("Integration rate limit exceeded", 429);
  else window.count += 1;
  const integration = await auth.db.$queryRaw<Array<{ baseUrl: string; secret: string; enabled: boolean }>>`SELECT "baseUrl", "secret", "enabled" FROM "IntegrationConnection" WHERE "provider" = ${provider} LIMIT 1`;
  if (!integration[0] || !integration[0].enabled) return jsonError("Integration is not configured", 404);
  const body = await readJson(request);
  if (!isRecord(body)) return jsonError("A JSON integration payload is required");
  const relativePath = new URL(request.url).searchParams.get("path") || "/";
  if (!relativePath.startsWith("/") || relativePath.startsWith("//")) return jsonError("Integration path must be relative");
  const endpoint = new URL(relativePath, integration[0].baseUrl);
  if (endpoint.protocol !== "https:") return jsonError("Integration endpoints must use HTTPS");
  try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { "content-type": "application/json", ...(integration[0].secret ? { authorization: `Bearer ${decryptField(integration[0].secret)}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json().catch(() => ({}));
    return NextResponse.json({ provider, status: response.status, data: payload }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    console.error("Integration request failed", error);
    return jsonError("Integration provider is unavailable", 502);
  }
}
