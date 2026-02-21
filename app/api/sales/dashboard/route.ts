import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSalesRepFromCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await getSalesRepFromCookie();
  if (!auth?.salesRepId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const salesRep = await prisma.salesRep.findUnique({
      where: { id: auth.salesRepId },
      select: {
        id: true,
        name: true,
        email: true,
        referralCode: true,
        commissionPercent: true,
        active: true,
      },
    });

    if (!salesRep) {
      return NextResponse.json({ error: "Sales rep not found" }, { status: 404 });
    }

    const referrals = await prisma.salesReferral.findMany({
      where: { salesRepId: auth.salesRepId },
      include: {
        owner: {
          select: {
            email: true,
            createdAt: true,
            subscriptionStatus: true,
            planType: true,
            gymProfile: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const funnel = {
      total: referrals.length,
      signed_up: referrals.filter((r) => r.status === "signed_up").length,
      verified: referrals.filter((r) => r.status === "verified").length,
      trialing: referrals.filter((r) => r.status === "trialing").length,
      paid: referrals.filter((r) => r.status === "paid").length,
      churned: referrals.filter((r) => r.status === "churned").length,
    };

    return NextResponse.json({
      salesRep,
      funnel,
      referrals: referrals.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        verifiedAt: r.verifiedAt,
        trialStartedAt: r.trialStartedAt,
        paidAt: r.paidAt,
        ownerEmail: r.owner.email,
        gymName: r.owner.gymProfile?.name || null,
        planType: r.owner.planType,
        subscriptionStatus: r.owner.subscriptionStatus,
      })),
    });
  } catch (error) {
    console.error("Sales dashboard error:", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
