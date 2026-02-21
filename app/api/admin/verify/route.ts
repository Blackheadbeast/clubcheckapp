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

  return NextResponse.json({ isAdmin: true });
}
