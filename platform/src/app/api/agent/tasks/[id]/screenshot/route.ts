import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";
import { decryptField } from "@/server/field-encryption";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const task = await auth.db.agentTask.findUnique({
    where: { id },
    select: { screenshotData: true, screenshotMime: true },
  });
  if (!task?.screenshotData || !task.screenshotMime) return jsonError("Screenshot was not found", 404);
  const bytes = Buffer.from(decryptField(task.screenshotData), "base64");
  return new Response(bytes, {
    headers: {
      "content-type": task.screenshotMime,
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
