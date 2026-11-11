import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSubscription } from "@/server/subscription";
import { jsonError, readJson } from "@/server/http";
import { builtInTemplates, isGalleryKind, type GalleryTemplate } from "@/server/template-catalog";

const schema = z.object({ code: z.string().trim().min(2).max(80), name: z.string().trim().min(1).max(120), documentKind: z.enum(["GST_INVOICE", "RETAIL_BILL", "THERMAL_RECEIPT", "QUOTATION", "PURCHASE_ORDER"]), schema: z.object({ accent: z.string().regex(/^#[0-9a-f]{6}$/i), background: z.string().regex(/^#[0-9a-f]{6}$/i), logoPlacement: z.enum(["left", "center", "right"]), columns: z.array(z.string().max(32)).min(1).max(20), signature: z.boolean(), signatureData: z.string().max(700_000).regex(/^$|^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/).optional(), paper: z.enum(["A4", "58mm", "80mm"]) }) });

export async function GET(request: Request) {
  const auth = await requireSubscription("template.cloud", ["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const kind = new URL(request.url).searchParams.get("kind");
  const builtIns = builtInTemplates().filter((template) => !kind || (isGalleryKind(kind) && template.documentKind === kind));
  const stored = kind && isGalleryKind(kind)
    ? await auth.db.$queryRaw<Array<{ code: string; name: string; documentKind: GalleryTemplate["documentKind"]; version: number; schema: GalleryTemplate["schema"]; source: "CUSTOM" }>>`SELECT "code", "name", "documentKind", "version", "schema", "source" FROM "DocumentTemplate" WHERE "active" = TRUE AND "documentKind" = ${kind} ORDER BY "name" ASC`
    : await auth.db.$queryRaw<Array<{ code: string; name: string; documentKind: GalleryTemplate["documentKind"]; version: number; schema: GalleryTemplate["schema"]; source: "CUSTOM" }>>`SELECT "code", "name", "documentKind", "version", "schema", "source" FROM "DocumentTemplate" WHERE "active" = TRUE ORDER BY "name" ASC`;
  let cloud: GalleryTemplate[] = [];
  const repository = process.env.TEMPLATE_REPOSITORY_URL?.trim();
  if (repository) {
    try {
      const endpoint = new URL(repository); if (endpoint.protocol !== "https:") throw new Error("HTTPS required");
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      const payload: unknown = await response.json();
      if (response.ok && typeof payload === "object" && payload !== null && "templates" in payload && Array.isArray(payload.templates)) cloud = payload.templates.filter((template): template is GalleryTemplate => typeof template === "object" && template !== null && "code" in template && "documentKind" in template);
    } catch (error) { console.warn("Template repository unavailable; using built-in gallery", error); }
  }
  return NextResponse.json({ templates: [...stored, ...cloud, ...builtIns].slice(0, 200), subscription: auth.subscription });
}

export async function POST(request: Request) {
  const auth = await requireSubscription("template.cloud", ["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid document template");
  await auth.db.$executeRaw`INSERT INTO "DocumentTemplate" ("id", "code", "documentKind", "name", "version", "schema", "source") VALUES (${randomUUID()}::uuid, ${parsed.data.code}, ${parsed.data.documentKind}, ${parsed.data.name}, 1, ${JSON.stringify(parsed.data.schema)}::jsonb, 'CUSTOM') ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "version" = "DocumentTemplate"."version" + 1, "schema" = EXCLUDED."schema", "updatedAt" = CURRENT_TIMESTAMP`;
  return NextResponse.json({ ok: true, code: parsed.data.code }, { status: 201 });
}
