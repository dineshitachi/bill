import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { decryptField } from "@/server/field-encryption";

const statusSchema = z.object({ status: z.enum(["REVIEWED", "DISMISSED"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const body = await readJson(request);
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) return jsonError("Choose a valid review status");

  const task = await auth.db.$transaction(async (tx) => {
    const updated = await tx.agentTask.update({
      where: { id },
      data: { status: parsed.data.status, reviewedBy: auth.session.username, reviewedAt: new Date() },
      select: {
        id: true,
        description: true,
        source: true,
        screenshotMime: true,
        createdBy: true,
        status: true,
        reviewedBy: true,
        reviewedAt: true,
        createdAt: true,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: auth.session.userId,
        action: "agent.task.reviewed",
        subject: id,
        details: { status: parsed.data.status },
      },
    });
    return updated;
  }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return null;
    throw error;
  });
  if (!task) return jsonError("Agent request was not found", 404);
  return NextResponse.json({ task: { ...task, description: decryptField(task.description) } });
}
