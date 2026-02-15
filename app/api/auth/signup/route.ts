import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
import { cookies } from "next/headers";
import { z } from "zod";
import crypto from "crypto";
import { randomBytes } from "crypto";
import { rateLimitResponse, SIGNUP_RATE_LIMIT } from "@/lib/rate-limit";
import { sendVerificationEmail } from "@/lib/email";
import { generateUniqueGymCode } from "@/lib/gym-code";

const signupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().optional(),
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

    // Generate verification token (24 hour expiry)
    const verificationToken = randomBytes(32).toString("hex");
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const gymCode = await generateUniqueGymCode();

    // Create owner (trial starts after email verification)
    const owner = await prisma.owner.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        phone: parsed.data.phone || null,
        verificationToken,
        verificationTokenExpiry,
        gymCode,
        // emailVerified: null - default
        // trialEndsAt: null - trial starts after verification
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

    // Send verification email (non-blocking)
    sendVerificationEmail(owner.email, verificationToken).catch((err) => {
      console.error("Failed to send verification email:", err);
    });

    const token = await createToken({ ownerId: owner.id, emailVerified: false });

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
      requiresVerification: true,
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Signup failed. Please try again." },
      { status: 500 }
    );
  }
}
