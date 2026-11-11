import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ userId: z.string().uuid().optional(), channel: z.enum(["IN_APP", "EMAIL", "SMS", "PUSH"]).default("IN_APP"), kind: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(2000) });

export async function GET(request: Request) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const unreadOnly = new URL(request.url).searchParams.get("unread") === "true";
  const notifications = unreadOnly
    ? await auth.db.$queryRaw`SELECT * FROM "Notification" WHERE ("userId" = ${auth.session.userId}::uuid OR "userId" IS NULL) AND "readAt" IS NULL ORDER BY "createdAt" DESC LIMIT 100`
    : await auth.db.$queryRaw`SELECT * FROM "Notification" WHERE "userId" = ${auth.session.userId}::uuid OR "userId" IS NULL ORDER BY "createdAt" DESC LIMIT 100`;
  return NextResponse.json({ notifications });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid notification");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "Notification" ("id", "userId", "channel", "kind", "title", "body") VALUES (${id}::uuid, ${parsed.data.userId || null}::uuid, ${parsed.data.channel}, ${parsed.data.kind}, ${parsed.data.title}, ${parsed.data.body})`;
  return NextResponse.json({ notification: { id, ...parsed.data } }, { status: 201 });
}
