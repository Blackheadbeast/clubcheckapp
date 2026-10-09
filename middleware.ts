import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { can, type Permission } from "@/lib/permissions";
import { legacyRequirement, REQUIREMENT_HEADER } from "@/lib/route-permissions";

const protectedPaths = [
  "/dashboard",
  "/members",
  "/memberships",
  "/attendance",
  "/leads",
  "/prospects",
  "/schedule",
  "/appointments",
  "/today",
  "/home",
  "/broadcast",
  "/communication",
  "/coaching",
  "/documents",
  "/payroll",
  "/checkin",
  "/pos",
  "/reports",
  "/locations",
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

// API routes that authenticate some other way (signatures, secrets, member tokens, their own cookies).
const publicApiPrefixes = [
  "/api/stripe/webhook",
  "/api/webhooks/",
  "/api/cron/",
  "/api/member-portal",
  "/api/portal/",
  "/api/member-auth/",
  "/api/waiver/",
  "/api/auth/",
  "/api/sales/",
  "/api/admin/",
  // The public API: authenticated by API key inside each route.
  "/api/v1/",
  // Online booking: open to the public, limited and scoped inside each route.
  "/api/public/",
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

/** Whether an Origin header names this site: the host the request arrived on, or the configured address. */
function sameSite(origin: string, request: NextRequest) {
  try {
    const host = new URL(origin).host;
    if (host === request.nextUrl.host || host === request.headers.get("host")) return true;
    const configured = process.env.NEXT_PUBLIC_APP_URL;
    return !!configured && host === new URL(configured).host;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("auth-token")?.value;
  const salesToken = request.cookies.get("sales-auth-token")?.value;
  const { pathname } = request.nextUrl;

  // --- API routes ---
  if (pathname.startsWith("/api/")) {
    // A zero byte in an address is never legitimate, and the database cannot hold one: refuse it as bad input.
    if (/%00|\u0000/i.test(request.nextUrl.pathname + request.nextUrl.search)) {
      return NextResponse.json({ error: "The request contains characters that cannot be stored.", code: "invalid_characters" }, { status: 400 });
    }
    // Never trust a client-supplied copy of our internal header.
    const headers = new Headers(request.headers);
    headers.delete(REQUIREMENT_HEADER);
    const isPublic = publicApiPrefixes.some((p) => pathname.startsWith(p));
    // A request that changes something and is signed in by cookie must come from this site. Browsers
    // already keep the cookie off cross-site posts (SameSite=Lax); this does not depend on that.
    // Requests with no Origin (servers, scripts, older same-site forms) are not browsers being tricked.
    if (!isPublic && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (origin && !sameSite(origin, request)) {
        return NextResponse.json({ error: "This request came from another site.", code: "cross_site" }, { status: 403 });
      }
    }
    const requirement = isPublic ? null : legacyRequirement(pathname, request.method);
    if (requirement && requirement !== "any") {
      headers.set(REQUIREMENT_HEADER, requirement);
      // Fast rejection from the token; lib/auth.ts repeats the check against the live staff record.
      if (token) {
        try {
          const { payload } = await jwtVerify(token, getSecret());
          const isStaff = !!payload.staffId;
          const allowed =
            requirement === "owner" ? !isStaff : !isStaff || can(payload.role as string, requirement as Permission);
          if (!allowed) {
            return NextResponse.json(
              { error: "You do not have permission to do that.", code: "forbidden" },
              { status: 403 }
            );
          }
        } catch {
          // Invalid token: the route will answer 401.
        }
      }
    }
    return NextResponse.next({ request: { headers } });
  }

  // --- Member account pages ---
  // The portal itself checks the session on every API call; this only saves a signed-out
  // member from loading an empty page.
  if (pathname === "/member/me" || pathname.startsWith("/member/me/")) {
    if (!request.cookies.get("member-session")?.value) {
      return NextResponse.redirect(new URL("/member/login", request.url));
    }
    return NextResponse.next();
  }

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
        return NextResponse.redirect(new URL("/home", request.url));
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
  // Every API route without exception (a path that merely ends like a file name is still an API
  // call and still needs its permission check), and every page except Next internals and static files.
  matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|mp4|webmanifest|txt|xml)$).*)"],
};
