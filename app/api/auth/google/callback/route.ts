import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/auth";
import { randomBytes } from "crypto";
import crypto from "crypto";
import { getTrialEndDate } from "@/lib/billing";
import { rateLimitResponse, AUTH_RATE_LIMIT } from "@/lib/rate-limit";
import { generateUniqueGymCode } from "@/lib/gym-code";

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

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  // Rate limit
  const rateLimit = rateLimitResponse(request, "auth-google", AUTH_RATE_LIMIT);
  if (rateLimit.limited) {
    return NextResponse.redirect(
      `${appUrl}/login?error=${encodeURIComponent("Too many attempts. Please try again later.")}`
    );
  }

  try {
    // 1. Verify CSRF state
    const state = request.nextUrl.searchParams.get("state");
    const storedState = request.cookies.get("oauth-state")?.value;

    if (!state || !storedState || state !== storedState) {
      return NextResponse.redirect(
        `${appUrl}/login?error=${encodeURIComponent("Authentication failed. Please try again.")}`
      );
    }

    // 2. Check for error from Google
    const googleError = request.nextUrl.searchParams.get("error");
    if (googleError) {
      return NextResponse.redirect(
        `${appUrl}/login?error=${encodeURIComponent("Google sign-in was cancelled.")}`
      );
    }

    // 3. Exchange authorization code for tokens
    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return NextResponse.redirect(
        `${appUrl}/login?error=${encodeURIComponent("Authentication failed. No code received.")}`
      );
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${appUrl}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Google token exchange failed:", tokenData);
      return NextResponse.redirect(
        `${appUrl}/login?error=${encodeURIComponent("Authentication failed. Please try again.")}`
      );
    }

    // 4. Fetch user info from Google
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    const userInfo = await userInfoResponse.json();

    if (!userInfoResponse.ok || !userInfo.email) {
      console.error("Failed to fetch Google user info:", userInfo);
      return NextResponse.redirect(
        `${appUrl}/login?error=${encodeURIComponent("Could not retrieve your Google account info.")}`
      );
    }

    const normalizedEmail = userInfo.email.toLowerCase().trim();
    const googleId = userInfo.id as string;

    // 5. Find or create owner
    let owner = await prisma.owner.findUnique({
      where: { email: normalizedEmail },
    });

    let isNewUser = false;

    if (!owner) {
      // Create new owner via Google
      isNewUser = true;
      const randomPassword = await bcrypt.hash(
        randomBytes(32).toString("hex"),
        10
      );

      const gymCode = await generateUniqueGymCode();

      owner = await prisma.owner.create({
        data: {
          email: normalizedEmail,
          password: randomPassword,
          emailVerified: new Date(),
          trialEndsAt: getTrialEndDate(),
          provider: "google",
          providerAccountId: googleId,
          gymCode,
        },
      });

      // Create referral record
      let referralCode = generateReferralCode();
      let attempts = 0;
      while (attempts < 10) {
        const existing = await prisma.referral.findUnique({
          where: { referralCode },
        });
        if (!existing) break;
        referralCode = generateReferralCode();
        attempts++;
      }

      // Check for referral from cookie
      const referralCookie = request.cookies.get("oauth-referral")?.value;
      let referredByOwnerId: string | null = null;
      if (referralCookie) {
        const referrer = await prisma.referral.findUnique({
          where: { referralCode: referralCookie.trim().toUpperCase() },
        });
        if (referrer) {
          referredByOwnerId = referrer.ownerId;
        }
      }

      await prisma.referral.create({
        data: {
          ownerId: owner.id,
          referralCode,
          referredByOwnerId,
          referredAt: new Date(),
        },
      });
    } else {
      // Existing user — link Google if not already linked
      if (!owner.provider) {
        await prisma.owner.update({
          where: { id: owner.id },
          data: {
            provider: "google",
            providerAccountId: googleId,
            // Verify email if not already verified
            emailVerified: owner.emailVerified || new Date(),
            // Start trial if it wasn't started yet
            trialEndsAt: owner.trialEndsAt || getTrialEndDate(),
          },
        });
        // Refresh owner data
        owner = await prisma.owner.findUnique({
          where: { id: owner.id },
        });
      }
    }

    if (!owner) {
      return NextResponse.redirect(
        `${appUrl}/login?error=${encodeURIComponent("Account creation failed.")}`
      );
    }

    // 6. Create JWT and set cookie via redirect response
    const token = await createToken({
      ownerId: owner.id,
      emailVerified: true,
    });

    const response = NextResponse.redirect(`${appUrl}/dashboard`);
    response.cookies.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });
    response.cookies.delete("oauth-state");
    response.cookies.delete("oauth-referral");

    return response;
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    return NextResponse.redirect(
      `${appUrl}/login?error=${encodeURIComponent("Authentication failed. Please try again.")}`
    );
  }
}
