import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { provisionTenant } from "@/server/provision";
import { isRecord, jsonError, readJson } from "@/server/http";

export const runtime = "nodejs";

const inputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/),
  adminUsername: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  adminDisplayName: z.string().trim().min(2).max(80),
  adminPassword: z.string().min(12).max(128),
  legalName: z.string().trim().min(2).max(120).optional(),
  stateCode: z.string().regex(/^\d{2}$/).optional(),
});

export async function POST(request: Request) {
  const expected = process.env.PROVISIONING_SECRET;
  const provided = request.headers.get("x-provisioning-secret") || "";
  if (!expected || Buffer.byteLength(expected) < 32) return jsonError("Provisioning is not configured", 503);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return jsonError("Not authorized", 401);
  }
  const body = await readJson(request);
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid provisioning data", details: parsed.error.flatten() }, { status: 400 });

  try {
    const result = await provisionTenant(parsed.data);
    return NextResponse.json({
      tenant: result.tenant,
      installation: {
        apiKey: result.apiKey,
        apiKeyWarning: "Store this key securely; it is displayed only once.",
        signInUrl: "/",
      },
    }, { status: 201 });
  } catch (error) {
    if (isRecord(error) && error.code === "P2002") {
      return jsonError("That tenant slug or administrator username is already in use", 409);
    }
    console.error("Tenant provisioning failed", error);
    return jsonError("Tenant provisioning failed", 500);
  }
}
