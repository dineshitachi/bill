import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { sanitizeDiagnosticText } from "@/diagnostics";

const resolutionSchema = z.object({ reportId: z.string().uuid(), resolutionNote: z.string().trim().min(8).max(1000) });

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const reports = await auth.db.$queryRaw<Array<{
    id: string; userId: string | null; fingerprint: string; name: string; message: string;
    route: string; count: number; createdAt: Date; resolvedBy: string | null;
    resolvedAt: Date | null; resolutionNote: string | null;
  }>>`
    SELECT report."id", report."userId", report."fingerprint", report."name", report."message", report."route", report."count", report."createdAt",
      resolution."resolvedBy", resolution."resolvedAt", resolution."resolutionNote"
    FROM "AgentErrorReport" report
    LEFT JOIN "AdminDiagnosticResolution" resolution ON resolution."reportId" = report."id"
    ORDER BY report."createdAt" DESC LIMIT 100
  `;
  return NextResponse.json({ reports: reports.map((report) => ({
    ...report,
    name: sanitizeDiagnosticText(report.name).slice(0, 100),
    message: sanitizeDiagnosticText(report.message),
    route: sanitizeDiagnosticText(report.route).slice(0, 200),
    resolutionNote: report.resolutionNote ? sanitizeDiagnosticText(report.resolutionNote) : null,
  })) });
}

export async function PATCH(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = resolutionSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("A valid report ID and resolution note are required");
  const resolutionNote = sanitizeDiagnosticText(parsed.data.resolutionNote);
  const reports = await auth.db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "AgentErrorReport" WHERE "id" = ${parsed.data.reportId}::uuid LIMIT 1`;
  if (!reports.length) return jsonError("Diagnostic report was not found", 404);
  const now = new Date();
  await auth.db.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "AdminDiagnosticResolution" ("id", "reportId", "resolvedBy", "resolutionNote", "resolvedAt")
      VALUES (${randomUUID()}::uuid, ${parsed.data.reportId}::uuid, ${auth.session.userId}::uuid, ${resolutionNote}, ${now})
      ON CONFLICT ("reportId") DO UPDATE SET "resolvedBy" = EXCLUDED."resolvedBy", "resolutionNote" = EXCLUDED."resolutionNote", "resolvedAt" = EXCLUDED."resolvedAt"
    `;
    await tx.auditLog.create({
      data: { actorId: auth.session.userId, action: "diagnostic.resolved", subject: parsed.data.reportId, details: { resolutionNote } },
    });
  });
  return NextResponse.json({ ok: true, resolvedAt: now });
}
