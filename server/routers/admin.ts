import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { audit, exec, q, q1, withTx } from "../ef/pool";
import { hashPassword } from "../ef/auth";
import { createMemberWithGuest, normalizePhone } from "../ef/members";
import { listGuests, guestRow } from "./staff";

const pw = z.string().min(8, "密碼最少 8 個字元").max(200);

const userRow = (r: any) => ({
  id: r.id as number,
  username: (r.username as string | null) ?? null,
  email: (r.email as string | null) ?? null,
  name: r.name as string,
  role: r.role as "owner" | "admin" | "staff" | "merchant" | "member",
  isActive: !!r.is_active,
  merchantName: (r.merchant_name as string | null) ?? null,
  googleVerified: !!r.google_email_verified,
  lastLoginAt: (r.last_login_at as Date | null) ?? null,
});

async function assertCanManage(actor: { role: string }, targetId: number) {
  const t = await q1("SELECT * FROM ef_users WHERE id = ?", [targetId]);
  if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "找不到帳號" });
  if (t.role === "owner" && actor.role !== "owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有系統擁有人可以管理擁有人帳號" });
  }
  return t;
}

export const adminRouter = router({
  /* ---------- 活動 ---------- */
  event: adminProcedure.query(async () => {
    const e = await q1("SELECT * FROM ef_events ORDER BY id LIMIT 1");
    return { id: e!.id as number, name: e!.name as string, date: String(e!.event_date instanceof Date ? e!.event_date.toISOString().slice(0, 10) : e!.event_date), startTime: (e!.start_time as string | null) ?? null, venue: (e!.venue as string | null) ?? null };
  }),
  updateEvent: adminProcedure
    .input(z.object({ startTime: z.string().max(20).nullable(), venue: z.string().max(300).nullable() }))
    .mutation(async ({ input, ctx }) => {
      await exec("UPDATE ef_events SET start_time = ?, venue = ? ORDER BY id LIMIT 1", [input.startTime?.trim() || null, input.venue?.trim() || null]);
      await audit(ctx.user.id, "event.update", "event", 1, input);
      return { ok: true };
    }),

  /* ---------- 帳號 ---------- */
  accounts: adminProcedure.query(async () => {
    const rows = await q(
      `SELECT u.*, mer.name AS merchant_name FROM ef_users u LEFT JOIN ef_merchants mer ON mer.id = u.merchant_id
       ORDER BY FIELD(u.role,'owner','admin','staff','merchant','member'), u.id LIMIT 500`
    );
    return rows.map(userRow);
  }),
  owners: adminProcedure.query(async () => {
    const rows = await q("SELECT a.email, a.label, a.verified_at, u.is_active FROM ef_owner_allowlist a LEFT JOIN ef_users u ON u.id = a.user_id ORDER BY a.id");
    return rows.map((r) => ({ email: r.email as string, verifiedAt: (r.verified_at as Date | null) ?? null, active: r.is_active == null ? null : !!r.is_active }));
  }),
  createAccount: adminProcedure
    .input(
      z.object({
        role: z.enum(["admin", "staff", "merchant", "member"]),
        username: z.string().min(3).max(40).regex(/^[A-Za-z0-9_.-]+$/, "帳號只可用英文字母、數字及 _ . -"),
        name: z.string().min(1).max(100),
        password: pw,
        email: z.string().email().max(320).optional().or(z.literal("")),
        merchantId: z.number().int().optional(),
        memberCode: z.string().max(32).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      let memberId: number | null = null;
      if (input.role === "merchant") {
        if (!input.merchantId) throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇商家" });
        if (!(await q1("SELECT id FROM ef_merchants WHERE id = ?", [input.merchantId]))) throw new TRPCError({ code: "NOT_FOUND", message: "找不到商家" });
      }
      if (input.role === "member") {
        const m = await q1("SELECT id FROM ef_members WHERE member_code = ?", [(input.memberCode ?? "").toUpperCase()]);
        if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "請輸入有效的會員碼以連結嘉賓" });
        memberId = m.id;
      }
      const email = input.email ? input.email.toLowerCase() : null;
      if (email && (await q1("SELECT id FROM ef_owner_allowlist WHERE email = ?", [email]))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此電郵屬於系統擁有人名單，只能以 Google 登入取得權限" });
      }
      try {
        const r = await exec(
          "INSERT INTO ef_users (username, email, name, role, password_hash, merchant_id, member_id) VALUES (?,?,?,?,?,?,?)",
          [input.username.toLowerCase(), email, input.name, input.role, await hashPassword(input.password), input.role === "merchant" ? input.merchantId : null, memberId]
        );
        await audit(ctx.user.id, "account.create", "user", r.insertId, { role: input.role, username: input.username });
        return { id: r.insertId };
      } catch (e: any) {
        if (e?.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "帳號或電郵已被使用" });
        throw e;
      }
    }),
  resetPassword: adminProcedure.input(z.object({ id: z.number().int(), password: pw })).mutation(async ({ input, ctx }) => {
    const t = await assertCanManage(ctx.user, input.id);
    if (t.role === "owner") throw new TRPCError({ code: "BAD_REQUEST", message: "系統擁有人使用 Google 登入，沒有密碼" });
    await exec("UPDATE ef_users SET password_hash = ?, session_version = session_version + 1, must_change_password = 1 WHERE id = ?", [await hashPassword(input.password), input.id]);
    await audit(ctx.user.id, "account.reset_password", "user", input.id);
    return { ok: true };
  }),
  setActive: adminProcedure.input(z.object({ id: z.number().int(), active: z.boolean() })).mutation(async ({ input, ctx }) => {
    if (input.id === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "不能停用自己的帳號" });
    await assertCanManage(ctx.user, input.id);
    await exec("UPDATE ef_users SET is_active = ?, session_version = session_version + 1 WHERE id = ?", [input.active ? 1 : 0, input.id]);
    await audit(ctx.user.id, input.active ? "account.enable" : "account.disable", "user", input.id);
    return { ok: true };
  }),

  /* ---------- 嘉賓 ---------- */
  guests: adminProcedure
    .input(
      z.object({
        q: z.string().max(60).optional(),
        sort: z.enum(["name", "phone", "code", "zone", "seat", "checkin"]).default("name"),
        dir: z.enum(["asc", "desc"]).default("asc"),
        filter: z.enum(["all", "checked", "unchecked"]).default("all"),
      })
    )
    .query(({ input }) => listGuests(input)),

  createGuest: adminProcedure
    .input(z.object({ name: z.string().min(1).max(60), phone: z.string().min(6).max(20), zone: z.string().max(80).optional(), seat: z.string().max(80).optional(), groupName: z.string().max(80).optional(), note: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      const r = await createMemberWithGuest({ ...input, zone: input.zone || null, seat: input.seat || null });
      await audit(ctx.user.id, "guest.create", "guest", r.guestId);
      return r;
    }),

  importGuests: adminProcedure
    .input(z.object({ rows: z.array(z.object({ name: z.string().min(1).max(60), phone: z.string().min(6).max(20), zone: z.string().max(80).optional(), seat: z.string().max(80).optional(), groupName: z.string().max(80).optional() })).min(1).max(1000) }))
    .mutation(async ({ input, ctx }) => {
      let created = 0;
      const skipped: string[] = [];
      for (const row of input.rows) {
        const phone = normalizePhone(row.phone);
        const dup = await q1("SELECT id FROM ef_members WHERE phone = ? AND name = ?", [phone, row.name.trim()]);
        if (dup) {
          skipped.push(`${row.name}（${phone}）已存在`);
          continue;
        }
        await createMemberWithGuest({ ...row, phone, zone: row.zone || null, seat: row.seat || null, groupName: row.groupName || null });
        created++;
      }
      await audit(ctx.user.id, "guest.import", "guest", undefined, { created, skipped: skipped.length });
      return { created, skipped };
    }),

  updateGuest: adminProcedure
    .input(
      z.object({
        guestId: z.number().int(),
        name: z.string().min(1).max(60),
        phone: z.string().min(6).max(20),
        memberCode: z.string().min(3).max(32).regex(/^[A-Za-z0-9-]+$/, "會員碼只可用英文字母、數字及 -"),
        zone: z.string().max(80).nullable(),
        seat: z.string().max(80).nullable(),
        groupName: z.string().max(80).nullable(),
        note: z.string().max(300).nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const g = await q1("SELECT member_id FROM ef_guests WHERE id = ?", [input.guestId]);
      if (!g) throw new TRPCError({ code: "NOT_FOUND", message: "找不到嘉賓" });
      try {
        await withTx(async (tx) => {
          await tx.exec("UPDATE ef_members SET name = ?, phone = ?, member_code = ? WHERE id = ?", [input.name.trim(), normalizePhone(input.phone), input.memberCode.toUpperCase(), g.member_id]);
          await tx.exec("UPDATE ef_guests SET zone = ?, seat = ?, group_name = ?, note = ? WHERE id = ?", [input.zone?.trim() || null, input.seat?.trim() || null, input.groupName?.trim() || null, input.note?.trim() || null, input.guestId]);
          await tx.exec("UPDATE ef_users SET name = ? WHERE member_id = ? AND role = 'member'", [input.name.trim(), g.member_id]);
        });
      } catch (e: any) {
        if (e?.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "此會員碼已被其他嘉賓使用" });
        throw e;
      }
      await audit(ctx.user.id, "guest.update", "guest", input.guestId);
      return { ok: true };
    }),

  undoCheckIn: adminProcedure.input(z.object({ guestId: z.number().int() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_guests SET checked_in_at = NULL, checked_in_by = NULL WHERE id = ?", [input.guestId]);
    await audit(ctx.user.id, "guest.undo_checkin", "guest", input.guestId);
    return { ok: true };
  }),

  /** 有消費或中獎紀錄者不可刪除，只能停用，以免影響對帳。 */
  removeGuest: adminProcedure.input(z.object({ guestId: z.number().int() })).mutation(async ({ input, ctx }) => {
    const g = await q1("SELECT member_id FROM ef_guests WHERE id = ?", [input.guestId]);
    if (!g) throw new TRPCError({ code: "NOT_FOUND", message: "找不到嘉賓" });
    const used = await q1(
      `SELECT (SELECT COUNT(*) FROM ef_transactions WHERE member_id = ?) + (SELECT COUNT(*) FROM ef_draw_winners WHERE member_id = ?) + (SELECT COUNT(*) FROM ef_bids WHERE member_id = ?) AS n`,
      [g.member_id, g.member_id, g.member_id]
    );
    if (Number(used?.n) > 0) {
      await exec("UPDATE ef_members SET is_active = 0 WHERE id = ?", [g.member_id]);
      await exec("UPDATE ef_users SET is_active = 0, session_version = session_version + 1 WHERE member_id = ?", [g.member_id]);
      await audit(ctx.user.id, "guest.deactivate", "guest", input.guestId);
      return { deleted: false, deactivated: true };
    }
    await withTx(async (tx) => {
      await tx.exec("DELETE FROM ef_preorders WHERE member_id = ?", [g.member_id]);
      await tx.exec("DELETE FROM ef_users WHERE member_id = ?", [g.member_id]);
      await tx.exec("DELETE FROM ef_guests WHERE id = ?", [input.guestId]);
      await tx.exec("DELETE FROM ef_members WHERE id = ?", [g.member_id]);
    });
    await audit(ctx.user.id, "guest.delete", "guest", input.guestId);
    return { deleted: true, deactivated: false };
  }),

  /* ---------- 商家 ---------- */
  merchants: adminProcedure.query(async () => {
    const rows = await q("SELECT * FROM ef_merchants ORDER BY id");
    return rows.map((r) => ({ id: r.id as number, name: r.name as string, booth: (r.booth as string | null) ?? null, contactName: (r.contact_name as string | null) ?? null, isActive: !!r.is_active }));
  }),
  createMerchant: adminProcedure
    .input(z.object({ name: z.string().min(1).max(160), booth: z.string().max(40).optional(), contactName: z.string().max(120).optional() }))
    .mutation(async ({ input, ctx }) => {
      const r = await exec("INSERT INTO ef_merchants (name, booth, contact_name) VALUES (?,?,?)", [input.name, input.booth || null, input.contactName || null]);
      await audit(ctx.user.id, "merchant.create", "merchant", r.insertId);
      return { id: r.insertId };
    }),
  setMerchantActive: adminProcedure.input(z.object({ id: z.number().int(), active: z.boolean() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_merchants SET is_active = ? WHERE id = ?", [input.active ? 1 : 0, input.id]);
    await exec("UPDATE ef_users SET is_active = ?, session_version = session_version + 1 WHERE merchant_id = ? AND role = 'merchant'", [input.active ? 1 : 0, input.id]);
    await audit(ctx.user.id, input.active ? "merchant.enable" : "merchant.disable", "merchant", input.id);
    return { ok: true };
  }),

  /* ---------- 預購單 ---------- */
  preorders: adminProcedure.query(async () => {
    const rows = await q(
      `SELECT p.*, mer.name AS merchant_name, m.name AS member_name, m.member_code FROM ef_preorders p
       JOIN ef_merchants mer ON mer.id = p.merchant_id JOIN ef_members m ON m.id = p.member_id ORDER BY p.id DESC LIMIT 500`
    );
    return rows.map((r) => ({ id: r.id as number, orderNo: r.order_no as string, merchantName: r.merchant_name as string, memberName: r.member_name as string, memberCode: r.member_code as string, items: r.items as string, amountCents: r.amount_cents as number, status: r.status as string }));
  }),
  createPreorder: adminProcedure
    .input(z.object({ merchantId: z.number().int(), memberCode: z.string().min(2).max(32), items: z.string().min(1).max(1000), amountCents: z.number().int().min(0).max(99_999_900), orderNo: z.string().max(64).optional() }))
    .mutation(async ({ input, ctx }) => {
      const m = await q1("SELECT id FROM ef_members WHERE member_code = ?", [input.memberCode.toUpperCase()]);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此會員碼" });
      const orderNo = input.orderNo?.trim() || `PO-${Date.now().toString(36).toUpperCase()}`;
      try {
        const r = await exec("INSERT INTO ef_preorders (order_no, merchant_id, member_id, items, amount_cents) VALUES (?,?,?,?,?)", [orderNo, input.merchantId, m.id, input.items, input.amountCents]);
        await audit(ctx.user.id, "preorder.create", "preorder", r.insertId);
        return { id: r.insertId, orderNo };
      } catch (e: any) {
        if (e?.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "此訂單編號已存在" });
        throw e;
      }
    }),
  cancelPreorder: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_preorders SET status='cancelled' WHERE id = ? AND status='pending'", [input.id]);
    await audit(ctx.user.id, "preorder.cancel", "preorder", input.id);
    return { ok: true };
  }),

  /**
   * 測試工具：只清除「測試資料」嘉賓（種子資料）的消費、抽獎券、得獎、出價及簽到紀錄，
   * 並將測試預購單還原為待取貨，方便重複驗收。不影響其他嘉賓、帳號或正式資料。
   */
  resetTestData: adminProcedure.input(z.object({ confirm: z.literal("RESET") })).mutation(async ({ ctx }) => {
    const out = await withTx(async (tx) => {
      const ids = (await tx.q("SELECT member_id FROM ef_guests WHERE note = '測試資料'")).map((r) => Number(r.member_id));
      if (!ids.length) return { members: 0 };
      const inIds = ids.join(",");
      await tx.exec(`DELETE FROM ef_bids WHERE member_id IN (${inIds})`);
      await tx.exec(`DELETE FROM ef_draw_winners WHERE member_id IN (${inIds})`);
      await tx.exec(`DELETE FROM ef_draw_tickets WHERE member_id IN (${inIds})`);
      await tx.exec(`DELETE FROM ef_transactions WHERE member_id IN (${inIds})`);
      await tx.exec(`UPDATE ef_members SET total_spend_cents = 0, draw_chances_earned = 0 WHERE id IN (${inIds})`);
      await tx.exec(`UPDATE ef_guests SET checked_in_at = NULL, checked_in_by = NULL WHERE member_id IN (${inIds})`);
      await tx.exec("UPDATE ef_preorders SET status = 'pending', collected_at = NULL, collected_by = NULL WHERE order_no LIKE 'TEST-PO-%'");
      await tx.exec("DELETE FROM ef_auctions WHERE title LIKE '測試%' AND NOT EXISTS (SELECT 1 FROM ef_bids b WHERE b.auction_id = ef_auctions.id)");
      await tx.exec(
        `UPDATE ef_draws d SET awarded_count = (SELECT COUNT(*) FROM ef_draw_winners w WHERE w.draw_id = d.id),
           status = CASE WHEN d.status = 'cancelled' THEN 'cancelled' WHEN d.rules_confirmed = 1 THEN 'ready' ELSE 'draft' END`
      );
      return { members: ids.length };
    });
    await audit(ctx.user.id, "test.reset", "system", undefined, out);
    return out;
  }),

  /* ---------- 對帳 ---------- */
  report: adminProcedure.query(async () => {
    await exec("UPDATE ef_transactions SET status='expired' WHERE status='pending' AND expires_at < NOW()");
    const all = await q1(
      `SELECT COALESCE(SUM(CASE WHEN status='confirmed' THEN amount_cents END),0) AS cents, SUM(status='confirmed') AS n,
              SUM(status='pending') AS pending_n, SUM(status='rejected') AS rejected_n, SUM(status='expired') AS expired_n FROM ef_transactions`
    );
    const per = await q(
      `SELECT mer.id, mer.name, mer.booth,
         COALESCE(SUM(CASE WHEN t.status='confirmed' THEN t.amount_cents END),0) AS cents,
         COALESCE(SUM(t.status='confirmed'),0) AS n, COALESCE(SUM(t.status='pending'),0) AS pending_n
       FROM ef_merchants mer LEFT JOIN ef_transactions t ON t.merchant_id = mer.id GROUP BY mer.id ORDER BY cents DESC, mer.id`
    );
    const tickets = await q1("SELECT COUNT(*) AS n FROM ef_draw_tickets");
    return {
      confirmedCents: Number(all?.cents ?? 0),
      confirmedCount: Number(all?.n ?? 0),
      pendingCount: Number(all?.pending_n ?? 0),
      rejectedCount: Number(all?.rejected_n ?? 0),
      expiredCount: Number(all?.expired_n ?? 0),
      ticketsIssued: Number(tickets?.n ?? 0),
      merchants: per.map((r) => ({ id: r.id as number, name: r.name as string, booth: (r.booth as string | null) ?? null, confirmedCents: Number(r.cents), confirmedCount: Number(r.n), pendingCount: Number(r.pending_n) })),
    };
  }),
  transactions: adminProcedure
    .input(z.object({ merchantId: z.number().int().optional(), status: z.enum(["all", "pending", "confirmed", "rejected", "expired"]).default("all") }))
    .query(async ({ input }) => {
      const where: string[] = [];
      const params: any[] = [];
      if (input.merchantId) {
        where.push("t.merchant_id = ?");
        params.push(input.merchantId);
      }
      if (input.status !== "all") {
        where.push("t.status = ?");
        params.push(input.status);
      }
      const rows = await q(
        `SELECT t.*, mer.name AS merchant_name, m.name AS member_name, m.member_code FROM ef_transactions t
         JOIN ef_merchants mer ON mer.id = t.merchant_id JOIN ef_members m ON m.id = t.member_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.id DESC LIMIT 500`,
        params
      );
      return rows.map((r) => ({ id: r.id as number, merchantName: r.merchant_name as string, memberName: r.member_name as string, memberCode: r.member_code as string, amountCents: r.amount_cents as number, status: r.status as string, createdAt: r.created_at as Date, confirmedAt: (r.confirmed_at as Date | null) ?? null }));
    }),

  audit: adminProcedure.query(async () => {
    const rows = await q("SELECT a.*, u.name AS actor FROM ef_audit_log a LEFT JOIN ef_users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT 100");
    return rows.map((r) => ({ id: r.id as number, actor: (r.actor as string | null) ?? "系統", action: r.action as string, detail: (r.detail as string | null) ?? null, createdAt: r.created_at as Date }));
  }),
});

export { guestRow };
