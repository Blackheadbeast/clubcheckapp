import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken, passwordVersion } from "@/lib/auth";
import { cookies } from "next/headers";
import { z } from "zod";
import { rateLimitResponse, AUTH_RATE_LIMIT } from "@/lib/rate-limit";
import { recordFailedSignIn, signInBlocked } from "@/lib/login-attempts";

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Rate limit check
  const rateLimit = rateLimitResponse(request, "auth-login", AUTH_RATE_LIMIT);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter) },
      }
    );
  }

  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const normalizedEmail = parsed.data.email.toLowerCase().trim();
    const { password } = parsed.data;

    // Too many wrong passwords for this address, counted across every server instance.
    if (await signInBlocked("owner", normalizedEmail)) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": "900" } }
      );
    }

    const owner = await prisma.owner.findUnique({
      where: { email: normalizedEmail },
    });

    if (!owner) {
      // Counted the same as a wrong password, so the answer does not reveal which addresses exist.
      await recordFailedSignIn("owner", normalizedEmail);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, owner.password);
    if (!valid) {
      await recordFailedSignIn("owner", normalizedEmail);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const isVerified = !!owner.emailVerified;
    const token = await createToken({ ownerId: owner.id, emailVerified: isVerified, pv: passwordVersion(owner.password) });

    // ✅ Next.js 15: cookies() is async and MUST be awaited
    const cookieStore = await cookies();
    cookieStore.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return NextResponse.json({
      success: true,
      owner: { id: owner.id, email: owner.email },
      requiresVerification: !isVerified,
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again." },
      { status: 500 }
    );
  }
}