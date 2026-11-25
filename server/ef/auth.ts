import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import type { Request, Response } from "express";
import { q1 } from "./pool";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "ef_session";
const SESSION_DAYS = 7;

export type Role = "owner" | "admin" | "staff" | "merchant" | "member";
export type SessionUser = {
  id: number;
  role: Role;
  name: string;
  email: string | null;
  username: string | null;
  merchantId: number | null;
  memberId: number | null;
  mustChangePassword: boolean;
};

function secretKey(): Uint8Array {
  const base = process.env.MANUS_JWT_SECRET;
  if (!base) throw new Error("MANUS_JWT_SECRET 未設定");
  return createHmac("sha256", base).update("eventflow-session-v2").digest();
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `s1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [v, saltHex, keyHex] = stored.split("$");
  if (v !== "s1" || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export async function signSession(userId: number, sessionVersion: number): Promise<string> {
  return new SignJWT({ v: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuer("eventflow")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: true,
    maxAge: SESSION_DAYS * 86400 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, path: "/", sameSite: "none", secure: true });
}

function readToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim() || null;
  const cookie = req.headers.cookie;
  if (cookie) {
    for (const part of cookie.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export async function userFromRequest(req: Request): Promise<SessionUser | null> {
  const token = readToken(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "eventflow" });
    const id = Number(payload.sub);
    if (!id) return null;
    const row = await q1("SELECT * FROM ef_users WHERE id = ?", [id]);
    if (!row || !row.is_active || row.session_version !== payload.v) return null;
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      email: row.email,
      username: row.username,
      merchantId: row.merchant_id,
      memberId: row.member_id,
      mustChangePassword: !!row.must_change_password,
    };
  } catch {
    return null;
  }
}

/** 簡單的記憶體限流（每個鍵在視窗內最多嘗試次數）。 */
const attempts = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max = 8, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.reset < now) {
    attempts.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  e.n += 1;
  return e.n <= max;
}

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
  timeoutDuration: 10_000,
});

export function googleClientId(): string {
  return (process.env.GOOGLE_CLIENT_ID ?? "").trim();
}

/** 驗證 Google ID token，並要求電郵已由 Google 驗證。 */
export async function verifyGoogleIdToken(credential: string): Promise<{ sub: string; email: string; name: string }> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("GOOGLE_NOT_CONFIGURED");
  const { payload } = await jwtVerify(credential, googleKeys, {
    audience: clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (!payload.sub || typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new Error("GOOGLE_EMAIL_UNVERIFIED");
  }
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: String(payload.name ?? payload.email) };
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}

export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "••••" : `${"•".repeat(phone.length - 3)}${phone.slice(-3)}`;
}
