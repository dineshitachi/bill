import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const rows = await auth.db.$queryRaw<Array<{ payload: string; checksum: string; createdAt: Date }>>`SELECT "payload", "checksum", "createdAt" FROM "BackupRecord" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!rows[0]) return jsonError("Backup not found", 404);
  if (createHash("sha256").update(rows[0].payload).digest("hex") !== rows[0].checksum) return jsonError("Backup integrity check failed", 409);
  return new NextResponse(rows[0].payload, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="bill-my-book-backup-${id}.json"` } });
}
