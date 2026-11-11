import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";
import { decryptField, encryptField } from "@/server/field-encryption";

const maxBodyBytes = 1_050_000;
const taskSchema = z.object({
  description: z.string().trim().min(3).max(10_000),
  source: z.enum(["TEXT", "VOICE"]),
  screenshot: z.string().max(960_000).nullable().optional(),
});

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBodyBytes) throw new Error("Agent request is too large");
  if (!request.body) throw new Error("Request body is empty");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBodyBytes) {
      await reader.cancel();
      throw new Error("Agent request is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function publicTask(task: {
  id: string;
  description: string;
  source: string;
  screenshotMime: string | null;
  createdBy: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}) {
  return task;
}

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const tasks = await auth.db.agentTask.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
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
  return NextResponse.json({ tasks: tasks.map((task) => ({ ...task, description: decryptField(task.description) })) });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid agent request");
  }
  const parsed = taskSchema.safeParse(body);
  if (!parsed.success) return jsonError("Add a short request before submitting");
  const match = parsed.data.screenshot?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (parsed.data.screenshot && !match) return jsonError("Use a PNG, JPEG, or WebP screenshot");
  const screenshotBytes = match ? Buffer.from(match[2], "base64") : null;
  if (match && (screenshotBytes?.toString("base64") !== match[2] || (screenshotBytes?.byteLength || 0) > 700_000)) {
    return jsonError("Screenshot is invalid or larger than 700 KB");
  }
  const recentRequestCount = await auth.db.agentTask.count({
    where: { createdBy: auth.session.username, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recentRequestCount >= 20) return jsonError("Request limit reached. Try again later.", 429);

  const task = await auth.db.$transaction(async (tx) => {
    const created = await tx.agentTask.create({
      data: {
        id: randomUUID(),
        description: encryptField(parsed.data.description),
        source: parsed.data.source,
        screenshotMime: match?.[1] || null,
        screenshotData: match ? encryptField(match[2]) : null,
        createdBy: auth.session.username,
      },
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
        action: "agent.task.created",
        subject: created.id,
        details: { source: created.source, hasScreenshot: Boolean(created.screenshotMime) },
      },
    });
    return created;
  });
  return NextResponse.json({ task: publicTask({ ...task, description: decryptField(task.description) }) }, { status: 201 });
}
