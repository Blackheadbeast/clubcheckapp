import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { DEMO_OWNER_ID } from "@/lib/demo";
import { cookies } from "next/headers";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing demo token" }, { status: 400 });
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());

    // Verify this is actually a demo session token
    if (payload.ownerId !== DEMO_OWNER_ID || !payload.isDemoSession) {
      return NextResponse.json({ error: "Invalid demo token" }, { status: 400 });
    }

    // Set the auth-token cookie with the demo JWT (1-hour maxAge)
    const cookieStore = await cookies();
    cookieStore.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60, // 1 hour
      path: "/",
    });

    // Redirect to dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch {
    return NextResponse.json(
      { error: "Demo session has expired or is invalid. Please request a new demo link from your sales rep." },
      { status: 400 }
    );
  }
}
