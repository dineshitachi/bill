import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const themeSchema = z.object({ theme: z.enum(["dark", "slate", "corporate"]) });

export async function PUT(request: Request) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const parsed = themeSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Select a valid workspace theme");
  const user = await auth.db.user.update({
    where: { id: auth.session.userId },
    data: { theme: parsed.data.theme },
    select: { theme: true },
  });
  return NextResponse.json({ theme: user.theme });
}