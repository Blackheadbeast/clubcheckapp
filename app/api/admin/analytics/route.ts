import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerFromCookie } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await getOwnerFromCookie();
  if (!auth?.ownerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owner = await prisma.owner.findUnique({
    where: { id: auth.ownerId },
    select: { email: true },
  });

  if (!owner || !isAdminEmail(owner.email)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const [totalReps, activeReps, allReferrals, topPerformers] = await Promise.all([
      prisma.salesRep.count(),
      prisma.salesRep.count({ where: { active: true } }),
      prisma.salesReferral.groupBy({
        by: ["status"],
        _count: { id: true },
      }),
      prisma.salesRep.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          email: true,
          referralCode: true,
          _count: { select: { salesReferrals: true } },
          salesReferrals: {
            where: { status: "paid" },
            select: { id: true },
          },
        },
        orderBy: { salesReferrals: { _count: "desc" } },
        take: 10,
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const r of allReferrals) {
      statusCounts[r.status] = r._count.id;
    }

    return NextResponse.json({
      totalReps,
      activeReps,
      inactiveReps: totalReps - activeReps,
      referralsByStatus: statusCounts,
      totalReferrals: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      topPerformers: topPerformers.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        referralCode: p.referralCode,
        totalReferrals: p._count.salesReferrals,
        paidReferrals: p.salesReferrals.length,
      })),
    });
  } catch (error) {
    console.error("Admin analytics error:", error);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}
