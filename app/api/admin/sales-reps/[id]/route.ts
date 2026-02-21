import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerFromCookie } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import bcrypt from "bcryptjs";
import { z } from "zod";

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

const updateSchema = z.object({
  active: z.boolean().optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  password: z.string().min(6).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.active !== undefined) updateData.active = parsed.data.active;
    if (parsed.data.commissionPercent !== undefined) updateData.commissionPercent = parsed.data.commissionPercent;
    if (parsed.data.password) updateData.password = await bcrypt.hash(parsed.data.password, 10);

    const salesRep = await prisma.salesRep.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, email: true, active: true, commissionPercent: true },
    });

    return NextResponse.json({ success: true, salesRep });
  } catch (error) {
    console.error("Update sales rep error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    await prisma.salesRep.update({
      where: { id },
      data: { active: false },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Deactivate sales rep error:", error);
    return NextResponse.json({ error: "Deactivation failed" }, { status: 500 });
  }
}
