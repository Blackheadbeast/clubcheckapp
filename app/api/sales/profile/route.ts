import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSalesRepFromCookie } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await getSalesRepFromCookie();
  if (!auth?.salesRepId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salesRep = await prisma.salesRep.findUnique({
    where: { id: auth.salesRepId },
    select: {
      id: true,
      name: true,
      email: true,
      referralCode: true,
      commissionPercent: true,
      createdAt: true,
    },
  });

  if (!salesRep) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(salesRep);
}

const updateSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export async function PATCH(request: Request) {
  const auth = await getSalesRepFromCookie();
  if (!auth?.salesRepId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const salesRep = await prisma.salesRep.findUnique({
      where: { id: auth.salesRepId },
    });

    if (!salesRep) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const passwordMatch = await bcrypt.compare(parsed.data.currentPassword, salesRep.password);
    if (!passwordMatch) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }

    const hashedPassword = await bcrypt.hash(parsed.data.newPassword, 10);
    await prisma.salesRep.update({
      where: { id: auth.salesRepId },
      data: { password: hashedPassword },
    });

    return NextResponse.json({ success: true, message: "Password updated" });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
