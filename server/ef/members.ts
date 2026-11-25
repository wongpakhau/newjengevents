import { randomBytes } from "node:crypto";
import { exec, q1 } from "./pool";
import type { Tx } from "./pool";
import { randomToken } from "./auth";

export const CHANCE_STEP_CENTS = 50000; // 每滿 HK$500 一次抽獎機會

type Runner = { exec: Tx["exec"]; q1: Tx["q1"] };
const base: Runner = { exec, q1 };

export function normalizePhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
}

/** 建立會員及對應嘉賓記錄；會員碼格式 ZX0001。 */
export async function createMemberWithGuest(
  input: { name: string; phone: string; email?: string | null; zone?: string | null; seat?: string | null; groupName?: string | null; note?: string | null; walkIn?: boolean },
  r: Runner = base
): Promise<{ memberId: number; guestId: number; memberCode: string }> {
  const phone = normalizePhone(input.phone);
  const tmp = `TMP${randomBytes(6).toString("hex")}`;
  const res = await r.exec(
    "INSERT INTO ef_members (member_code, name, phone, email, qr_token) VALUES (?,?,?,?,?)",
    [tmp, input.name.trim(), phone, input.email ?? null, randomToken(16)]
  );
  const memberId = res.insertId;
  const memberCode = `ZX${String(memberId).padStart(4, "0")}`;
  await r.exec("UPDATE ef_members SET member_code = ? WHERE id = ?", [memberCode, memberId]);
  const g = await r.exec(
    "INSERT INTO ef_guests (public_id, member_id, zone, seat, group_name, registration_status, note) VALUES (?,?,?,?,?,?,?)",
    [randomToken(10), memberId, input.zone ?? null, input.seat ?? null, input.groupName ?? null, input.walkIn ? "walk_in" : "registered", input.note ?? null]
  );
  return { memberId, guestId: g.insertId, memberCode };
}

export function hkd(cents: number): string {
  return `HK$${(cents / 100).toLocaleString("en-HK", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}
