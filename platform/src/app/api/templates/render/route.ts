import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSubscription } from "@/server/subscription";
import { jsonError, readJson } from "@/server/http";
import { builtInTemplates } from "@/server/template-catalog";
import { renderDocumentTemplate, type DocumentModel } from "@/server/document-templates";

const schema = z.object({ templateCode: z.string().trim().min(2).max(80), document: z.unknown() });

export async function POST(request: Request) {
  const auth = await requireSubscription("template.cloud", ["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("A template code and document model are required");
  const stored = await auth.db.$queryRaw<Array<{ code: string; schema: Record<string, unknown> }>>`SELECT "code", "schema" FROM "DocumentTemplate" WHERE "code" = ${parsed.data.templateCode} AND "active" = TRUE LIMIT 1`;
  const template = stored[0] || builtInTemplates().find((candidate) => candidate.code === parsed.data.templateCode);
  if (!template) return jsonError("Template not found", 404);
  const rendered = renderDocumentTemplate(parsed.data.document as DocumentModel);
  const accent = typeof template.schema.accent === "string" ? template.schema.accent : "#5543d1";
  return NextResponse.json({ ...rendered, template: { code: parsed.data.templateCode, schema: template.schema }, css: rendered.css.replaceAll("#2563eb", accent).replaceAll("#5543d1", accent) });
}
