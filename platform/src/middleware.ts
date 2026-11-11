import { jwtVerify, SignJWT } from "jose";
import { NextRequest, NextResponse } from "next/server";

const cookieName = "namma_bill_session";
const lifetimeSeconds = 8 * 60 * 60;
const slidingSeconds = 30 * 60;

function jwtKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || new TextEncoder().encode(secret).byteLength < 32) throw new Error("JWT_SECRET is not configured");
  return new TextEncoder().encode(secret);
}

function publicPath(pathname: string): boolean {
  return pathname === "/api/auth/login" || pathname === "/api/auth/logout" || pathname === "/api/health"
    || pathname === "/api/v1/provision" || pathname.startsWith("/api/telemetry/")
    || pathname.startsWith("/_next/") || pathname === "/favicon.ico";
}

function allowed(pathname: string, role: string): boolean {
  if (pathname === "/api/auth/me" || pathname.startsWith("/api/profile") || pathname.startsWith("/api/notifications") || pathname.startsWith("/api/businesses") || pathname.startsWith("/api/subscription")) return true;
  if (pathname.startsWith("/api/portal/")) return role === "CUSTOMER";
  if (pathname.startsWith("/api/admin/") || pathname.startsWith("/api/reports/") || pathname.startsWith("/api/backups/")) return role === "ADMIN";
  if (pathname.startsWith("/api/integrations/") || pathname.startsWith("/api/gateway/")) return role === "ADMIN" || role === "SALES";
  if (pathname.startsWith("/api/agent/")) return role === "ADMIN" || role === "SALES";
  return role === "ADMIN" || role === "SALES";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith("/api/") || publicPath(pathname)) return NextResponse.next();
  const token = request.cookies.get(cookieName)?.value;
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { payload } = await jwtVerify(token, jwtKey());
    const role = payload.role === "STAFF" ? "SALES" : payload.role;
    if (typeof role !== "string" || !["ADMIN", "SALES", "CUSTOMER"].includes(role)) return NextResponse.json({ error: "Invalid session role" }, { status: 401 });
    if (!allowed(pathname, role)) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    const issuedAt = typeof payload.iat === "number" ? payload.iat : 0;
    const response = NextResponse.next();
    if (issuedAt && Math.floor(Date.now() / 1000) - issuedAt >= slidingSeconds) {
      const refreshed = await new SignJWT({ ...payload, role })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${lifetimeSeconds}s`)
        .sign(jwtKey());
      response.cookies.set(cookieName, refreshed, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: lifetimeSeconds,
      });
    }
    return response;
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
}

export const config = { matcher: ["/api/:path*"] };
