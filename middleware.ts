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
  "/billing",
  "/audit-logs",
  "/admin",
];

const authPaths = ["/login", "/signup", "/staff-login"];

// Paths that unverified users can access (requires auth but allows unverified)
const verificationPaths = ["/verify-email"];

// Paths that don't require auth at all (magic link verification)
const publicVerificationPaths = ["/verify-email/"];

// Sales rep protected paths (require sales-auth-token)
const salesProtectedPaths = ["/sales/dashboard", "/sales/demo", "/sales/settings"];

// Sales auth page (redirect to dashboard if already logged in)
const salesAuthPaths = ["/sales/login"];

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;
  const salesToken = request.cookies.get("sales-auth-token")?.value;
  const { pathname } = request.nextUrl;

  // --- Sales Auth Pages ---
  const isSalesAuthPage = salesAuthPaths.some((p) => pathname === p);
  if (isSalesAuthPage) {
    if (salesToken) {
      try {
        const { payload } = await jwtVerify(salesToken, getSecret());
        if (payload.salesRepId) {
          return NextResponse.redirect(new URL("/sales/dashboard", request.url));
        }
      } catch {
        // Invalid token — let them access login
      }
    }
    return NextResponse.next();
  }

  // --- Sales Protected Pages ---
  const isSalesProtected = salesProtectedPaths.some((p) => pathname.startsWith(p));
  if (isSalesProtected) {
    if (!salesToken) {
      return NextResponse.redirect(new URL("/sales/login", request.url));
    }
    try {
      const { payload } = await jwtVerify(salesToken, getSecret());
      if (!payload.salesRepId) {
        return NextResponse.redirect(new URL("/sales/login", request.url));
      }
    } catch {
      const response = NextResponse.redirect(new URL("/sales/login", request.url));
      response.cookies.delete("sales-auth-token");
      return response;
    }
    return NextResponse.next();
  }

  // --- Owner Auth Pages ---
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
  const isVerificationPath = verificationPaths.some((p) => pathname.startsWith(p));
  const isPublicVerificationPath = publicVerificationPaths.some((p) => pathname.startsWith(p) && pathname !== "/verify-email");

  // Magic link verification (e.g., /verify-email/abc123) - allow without auth
  // The token in the URL is the authentication
  if (isPublicVerificationPath) {
    return NextResponse.next();
  }

  // Verification pages (/verify-email only): require auth but allow unverified users
  if (isVerificationPath && !isPublicVerificationPath) {
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    try {
      const { payload } = await jwtVerify(token, getSecret());
      // If already verified, redirect to dashboard
      if (payload.emailVerified === true) {
        return NextResponse.redirect(new URL("/dashboard", request.url));
      }
    } catch {
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.delete("auth-token");
      return response;
    }
    return NextResponse.next();
  }

  // Protected routes: require valid JWT and verified email
  if (isProtected) {
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    try {
      const { payload } = await jwtVerify(token, getSecret());
      // Check if email is verified
      if (payload.emailVerified === false) {
        return NextResponse.redirect(new URL("/verify-email", request.url));
      }
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
    "/verify-email/:path*",
    "/login",
    "/signup",
    "/staff-login",
    "/sales/:path*",
    "/admin/:path*",
  ],
};
