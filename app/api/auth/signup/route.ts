import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
import { getTrialEndDate } from "@/lib/billing";
import { cookies } from "next/headers";
import { z } from "zod";
import crypto from "crypto";
import { rateLimitResponse, SIGNUP_RATE_LIMIT } from "@/lib/rate-limit";

const signupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  referralCode: z.string().optional(),
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return `GYM-${code}`;
}

export async function POST(request: NextRequest) {
  // Rate limit check
  const rateLimit = rateLimitResponse(request, "auth-signup", SIGNUP_RATE_LIMIT);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter) },
      }
    );
  }

  try {
    const body = await request.json();
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const normalizedEmail = parsed.data.email.toLowerCase().trim();
    const { password, referralCode } = parsed.data;

    const existing = await prisma.owner.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 400 }
      );
    }

    // Validate referral code if provided
    let referredByOwnerId: string | null = null;
    if (referralCode) {
      const referrerReferral = await prisma.referral.findUnique({
        where: { referralCode: referralCode.trim().toUpperCase() },
      });
      if (referrerReferral) {
        referredByOwnerId = referrerReferral.ownerId;
      }
      // If code doesn't exist, we silently ignore it (don't block signup)
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create owner with 14-day trial
    const owner = await prisma.owner.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        trialEndsAt: getTrialEndDate(),
      },
    });

    // Create referral record for the new owner (with their own unique code)
    let newOwnerCode = generateReferralCode();
    let attempts = 0;
    while (attempts < 10) {
      const existingCode = await prisma.referral.findUnique({
        where: { referralCode: newOwnerCode },
      });
      if (!existingCode) break;
      newOwnerCode = generateReferralCode();
      attempts++;
    }

    await prisma.referral.create({
      data: {
        ownerId: owner.id,
        referralCode: newOwnerCode,
        referredByOwnerId: referredByOwnerId,
        referredAt: new Date(),
      },
    });

    // Send welcome email (non-blocking)
    try {
      const { sendOwnerWelcomeEmail } = await import("@/lib/email");
      sendOwnerWelcomeEmail(owner.email).catch((err) => {
        console.error("Failed to send owner welcome email:", err);
      });
    } catch (emailErr) {
      console.error("Email import error:", emailErr);
    }

    const token = await createToken({ ownerId: owner.id });

    // Next.js 15: cookies() is async and MUST be awaited
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
      referred: !!referredByOwnerId,
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Signup failed. Please try again." },
      { status: 500 }
    );
  }
}
