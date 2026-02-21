import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerFromCookie } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireAdmin() {
  const auth = await getOwnerFromCookie();
  if (!auth?.ownerId) return null;

  const owner = await prisma.owner.findUnique({
    where: { id: auth.ownerId },
    select: { email: true },
  });

  if (!owner || !isAdminEmail(owner.email)) return null;
  return auth;
}

function generateSalesCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return `SALES-${code}`;
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const salesReps = await prisma.salesRep.findMany({
    include: {
      _count: { select: { salesReferrals: true } },
      salesReferrals: {
        select: { status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    salesReps.map((rep) => ({
      id: rep.id,
      name: rep.name,
      email: rep.email,
      referralCode: rep.referralCode,
      commissionPercent: rep.commissionPercent,
      active: rep.active,
      createdAt: rep.createdAt,
      lastLoginAt: rep.lastLoginAt,
      totalReferrals: rep._count.salesReferrals,
      paidReferrals: rep.salesReferrals.filter((r) => r.status === "paid").length,
    }))
  );
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  commissionPercent: z.number().min(0).max(100).default(10),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const normalizedEmail = parsed.data.email.toLowerCase().trim();

    const existing = await prisma.salesRep.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 10);

    // Generate unique referral code
    let referralCode = generateSalesCode();
    let attempts = 0;
    while (attempts < 10) {
      const existingCode = await prisma.salesRep.findUnique({
        where: { referralCode },
      });
      if (!existingCode) break;
      referralCode = generateSalesCode();
      attempts++;
    }

    const salesRep = await prisma.salesRep.create({
      data: {
        name: parsed.data.name,
        email: normalizedEmail,
        password: hashedPassword,
        referralCode,
        commissionPercent: parsed.data.commissionPercent,
      },
    });

    return NextResponse.json({
      success: true,
      salesRep: {
        id: salesRep.id,
        name: salesRep.name,
        email: salesRep.email,
        referralCode: salesRep.referralCode,
        commissionPercent: salesRep.commissionPercent,
      },
    });
  } catch (error) {
    console.error("Create sales rep error:", error);
    return NextResponse.json({ error: "Failed to create sales rep" }, { status: 500 });
  }
}
