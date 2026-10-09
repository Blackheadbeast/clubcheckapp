import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
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
  const rateLimit = rateLimitResponse(request, "sales-login", AUTH_RATE_LIMIT);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } }
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

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Wrong passwords are counted in the database, so the limit holds across server instances.
    if (await signInBlocked("sales", normalizedEmail)) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": "900" } }
      );
    }

    const salesRep = await prisma.salesRep.findUnique({
      where: { email: normalizedEmail },
    });

    // The password is checked before anything is said about the account.
    const passwordMatch = salesRep ? await bcrypt.compare(password, salesRep.password) : false;
    if (!salesRep || !passwordMatch) {
      await recordFailedSignIn("sales", normalizedEmail);
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    if (!salesRep.active) {
      return NextResponse.json(
        { error: "Your account has been deactivated. Contact admin." },
        { status: 403 }
      );
    }


    await prisma.salesRep.update({
      where: { id: salesRep.id },
      data: { lastLoginAt: new Date() },
    });

    const token = await createToken({
      ownerId: "",
      salesRepId: salesRep.id,
      role: "sales_rep",
    });

    const cookieStore = await cookies();
    cookieStore.set("sales-auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return NextResponse.json({
      success: true,
      salesRep: { id: salesRep.id, name: salesRep.name, email: salesRep.email },
    });
  } catch (error) {
    console.error("Sales rep login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again." },
      { status: 500 }
    );
  }
}
