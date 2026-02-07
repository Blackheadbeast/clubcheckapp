import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const protectedPaths = [
  "/dashboard",
  "/members",
  "/prospects",
  "/broadcast",
  "/checkin",
  "/settings",
  "/kiosk",
  "/invoices",
  "/analytics",
  "/referrals",
  "/staff",
  "/setup-guide",
];

const authPaths = ["/login", "/signup", "/staff-login"];

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;
  const { pathname } = request.nextUrl;

  // Check auth pages first (before protected check) to avoid /staff-login matching /staff
  const isAuthPage = authPaths.some((p) => pathname === p);
  if (isAuthPage) {
    // Auth pages: redirect to dashboard if already logged in with valid token
    if (token) {
      try {
        await jwtVerify(token, getSecret());
        return NextResponse.redirect(new URL("/dashboard", request.url));
      } catch {
        // Invalid token — let them access login/signup/staff-login
      }
    }
    return NextResponse.next();
  }

  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  // Protected routes: require valid JWT
  if (isProtected) {
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    try {
      await jwtVerify(token, getSecret());
    } catch {
      // Invalid/expired token — clear it and redirect
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete("auth-token");
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/members/:path*",
    "/prospects/:path*",
    "/broadcast/:path*",
    "/checkin/:path*",
    "/settings/:path*",
    "/kiosk/:path*",
    "/invoices/:path*",
    "/analytics/:path*",
    "/referrals/:path*",
    "/staff/:path*",
    "/setup-guide/:path*",
    "/login",
    "/signup",
    "/staff-login",
  ],
};
