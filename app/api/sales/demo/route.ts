import { NextRequest, NextResponse } from "next/server";
import { getSalesRepFromCookie } from "@/lib/auth";
import { DEMO_OWNER_ID } from "@/lib/demo";
import { SignJWT } from "jose";
import { rateLimitResponse, SALES_DEMO_RATE_LIMIT } from "@/lib/rate-limit";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await getSalesRepFromCookie();
  if (!auth?.salesRepId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = rateLimitResponse(request, `sales-demo:${auth.salesRepId}`, SALES_DEMO_RATE_LIMIT);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many demo sessions. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
    );
  }

  try {
    // Create a 1-hour JWT for the demo session
    const demoToken = await new SignJWT({
      ownerId: DEMO_OWNER_ID,
      emailVerified: true,
      isDemoSession: true,
      salesRepId: auth.salesRepId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(getSecret());

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const demoUrl = `${appUrl}/api/sales/demo/launch?token=${encodeURIComponent(demoToken)}`;

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    return NextResponse.json({
      success: true,
      demoUrl,
      expiresAt,
    });
  } catch (error) {
    console.error("Demo generation error:", error);
    return NextResponse.json({ error: "Failed to create demo session" }, { status: 500 });
  }
}
