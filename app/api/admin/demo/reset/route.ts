import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerFromCookie } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { DEMO_OWNER_ID, DEMO_EMAIL } from "@/lib/demo";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
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
    // Delete existing demo data (cascade will handle related records)
    await prisma.owner.deleteMany({ where: { id: DEMO_OWNER_ID } });

    const hashedPassword = await bcrypt.hash("demo123456", 10);

    // Recreate demo owner
    await prisma.owner.create({
      data: {
        id: DEMO_OWNER_ID,
        email: DEMO_EMAIL,
        password: hashedPassword,
        emailVerified: new Date(),
        trialEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        gymCode: "DEMO00",
        planType: "pro",
        subscriptionStatus: "active",
      },
    });

    // Create gym profile
    await prisma.gymProfile.create({
      data: {
        ownerId: DEMO_OWNER_ID,
        name: "Demo Fitness Club",
        address: "123 Demo Street, San Francisco, CA",
        theme: "dark",
      },
    });

    // Create sample members
    const memberNames = [
      "Alex Johnson", "Maria Garcia", "James Wilson", "Sarah Chen",
      "David Kim", "Emma Thompson", "Michael Brown", "Lisa Anderson",
      "Robert Martinez", "Jennifer Lee",
    ];

    for (let i = 0; i < memberNames.length; i++) {
      const name = memberNames[i];
      const firstName = name.split(" ")[0].toLowerCase();
      const member = await prisma.member.create({
        data: {
          name,
          email: `${firstName}@demo.com`,
          phone: `555-010${i.toString().padStart(2, "0")}`,
          status: i < 8 ? "active" : "inactive",
          qrCode: `DEMO-QR-${i.toString().padStart(4, "0")}`,
          ownerId: DEMO_OWNER_ID,
          currentStreak: Math.floor(Math.random() * 15),
          longestStreak: Math.floor(Math.random() * 30) + 5,
        },
      });

      // Create sample check-ins for the last 30 days
      const checkinsCount = Math.floor(Math.random() * 15) + 3;
      for (let j = 0; j < checkinsCount; j++) {
        const daysAgo = Math.floor(Math.random() * 30);
        const hour = Math.floor(Math.random() * 12) + 6; // 6am-6pm
        const date = new Date();
        date.setDate(date.getDate() - daysAgo);
        date.setHours(hour, Math.floor(Math.random() * 60), 0, 0);

        await prisma.checkin.create({
          data: {
            memberId: member.id,
            ownerId: DEMO_OWNER_ID,
            timestamp: date,
            source: ["qr", "manual", "kiosk"][Math.floor(Math.random() * 3)],
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Demo environment reset successfully",
    });
  } catch (error) {
    console.error("Demo reset error:", error);
    return NextResponse.json({ error: "Failed to reset demo environment" }, { status: 500 });
  }
}
