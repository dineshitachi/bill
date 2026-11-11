import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { agentTemplates } from "@/agent-templates";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { decryptField, encryptField } from "@/server/field-encryption";

const profileSchema = z.object({
  templateId: z.string().min(1).max(80),
  name: z.string().trim().min(2).max(80),
  instructions: z.string().trim().min(10).max(10_000),
});

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const agents = await auth.db.agentProfile.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, templateId: true, instructions: true, createdBy: true, createdAt: true },
  });
  return NextResponse.json({ agents: agents.map((agent) => ({ ...agent, instructions: decryptField(agent.instructions) })) });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return jsonError("Provide a valid agent name and instructions");
  if (parsed.data.templateId !== "custom" && !agentTemplates.some((template) => template.id === parsed.data.templateId)) {
    return jsonError("Choose a valid agent template");
  }

  const agent = await auth.db.$transaction(async (tx) => {
    const created = await tx.agentProfile.create({
      data: {
        id: randomUUID(),
        name: parsed.data.name,
        templateId: parsed.data.templateId,
        instructions: encryptField(parsed.data.instructions),
        createdBy: auth.session.username,
      },
      select: { id: true, name: true, templateId: true, instructions: true, createdBy: true, createdAt: true },
    });
    await tx.auditLog.create({
      data: { actorId: auth.session.userId, action: "agent.profile.created", subject: created.id, details: { templateId: created.templateId } },
    });
    return created;
  });
  return NextResponse.json({ agent: { ...agent, instructions: decryptField(agent.instructions) } }, { status: 201 });
}