import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnerFromCookie } from "@/lib/auth";
import { platformAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const admin = await platformAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.status === 401 ? "Unauthorized" : "Access denied" }, { status: admin.status });
  }
  const auth = { ownerId: admin.ownerId };

  return NextResponse.json({ isAdmin: true });
}
