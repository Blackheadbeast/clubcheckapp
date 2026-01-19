///Users/mahadghazipura/clubcheck/lib/auth.ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// Build secret lazily so deploy doesn't crash if env is missing at import time
function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createToken(payload: { ownerId: string }) {
  const secret = getSecret();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string) {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload as { ownerId: string };
  } catch {
    return null;
  }
}

export async function getOwnerFromCookie() {
  // cookies() is synchronous — DO NOT await
  const cookieStore = cookies();
  const token = cookieStore.get("auth-token")?.value;

  if (!token) return null;

  return await verifyToken(token);
}
