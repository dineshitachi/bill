import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { sanitizeDiagnosticText } from "@/diagnostics";

const errorSchema = z.object({
  fingerprint: z.string().min(8).max(80),
  name: z.string().trim().max(100).default("RuntimeError"),
  message: z.string().trim().min(1).max(500),
  route: z.string().trim().max(200),
});

export async function POST(request: Request) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = errorSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid error report");
  const safeReport = {
    ...parsed.data,
    name: sanitizeDiagnosticText(parsed.data.name).slice(0, 100) || "RuntimeError",
    message: sanitizeDiagnosticText(parsed.data.message),
    route: sanitizeDiagnosticText(parsed.data.route).slice(0, 200),
  };
  const existing = await auth.db.agentErrorReport.findFirst({
    where: { fingerprint: parsed.data.fingerprint },
    orderBy: { createdAt: "desc" },
  });
  if (existing && Date.now() - existing.createdAt.getTime() < 60_000) {
    await auth.db.agentErrorReport.update({
      where: { id: existing.id },
      data: { count: { increment: 1 } },
    });
  } else {
    await auth.db.agentErrorReport.create({
      data: { ...safeReport, userId: auth.session.userId },
    });
  }
  return NextResponse.json({ accepted: true }, { status: 202 });
}
