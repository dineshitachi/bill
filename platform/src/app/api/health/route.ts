import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check database query failed", error);
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
