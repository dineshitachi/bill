import { NextResponse } from "next/server";
import { z } from "zod";
import { isGstinFormatValid } from "@/gst";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ gstin: z.string().trim().toUpperCase().max(15) });

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Enter a GSTIN");
  if (!isGstinFormatValid(parsed.data.gstin)) {
    return NextResponse.json({ formatValid: false, governmentVerified: false, message: "GSTIN format is invalid" });
  }
  const providerUrl = process.env.GSTIN_PROVIDER_URL;
  const providerToken = process.env.GSTIN_PROVIDER_TOKEN;
  if (!providerUrl || !providerToken) {
    return NextResponse.json({
      formatValid: true,
      governmentVerified: false,
      message: "Format is valid; live GSTIN verification is not configured.",
    });
  }
  let endpoint: URL;
  try {
    endpoint = new URL(providerUrl);
  } catch {
    return jsonError("GST verification provider configuration is invalid", 503);
  }
  if (endpoint.protocol !== "https:") return jsonError("GST verification provider must use HTTPS", 503);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ gstin: parsed.data.gstin }),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!response.ok) return jsonError("GST verification provider is unavailable", 502);
    const result: unknown = await response.json();
    if (typeof result !== "object" || result === null || !("valid" in result) || typeof result.valid !== "boolean") {
      return jsonError("GST verification provider returned an unsupported response", 502);
    }
    return NextResponse.json({
      formatValid: true,
      governmentVerified: true,
      valid: result.valid,
      message: result.valid ? "Provider reports this GSTIN as active." : "Provider reports this GSTIN as invalid or inactive.",
    });
  } catch (error) {
    console.error("GSTIN verification provider request failed", error);
    return jsonError("GST verification provider could not be reached", 502);
  }
}
