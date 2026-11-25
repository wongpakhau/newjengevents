import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { memberProcedure, merchantProcedure, router } from "../_core/trpc";
import { audit, exec, q, q1, withTx } from "../ef/pool";
import { CHANCE_STEP_CENTS } from "../ef/members";

const MAX_TX_CENTS = 9_999_900; // 單筆上限 HK$99,999
const TX_TTL_MIN = 10;

async function expireStale() {
  await exec("UPDATE ef_transactions SET status='expired' WHERE status='pending' AND expires_at < NOW()");
}

function parseMemberRef(raw: string): { by: "code" | "token"; value: string } {
  const v = raw.trim();
  if (/^EFM:/i.test(v)) return { by: "token", value: v.slice(4).trim() };
  return { by: "code", value: v.toUpperCase() };
}

const txOut = (r: any) => ({
  id: r.id as number,
  merchantName: r.merchant_name as string | undefined,
  memberName: r.member_name as string | undefined,
  memberCode: r.member_code as string | undefined,
  amountCents: r.amount_cents as number,
  status: r.status as "pending" | "confirmed" | "rejected" | "expired",
  createdAt: r.created_at as Date,
  confirmedAt: (r.confirmed_at as Date | null) ?? null,
  expiresAt: r.expires_at as Date,
});

const preorderOut = (r: any) => ({
  id: r.id as number,
  orderNo: r.order_no as string,
  items: r.items as string,
  amountCents: r.amount_cents as number,
  status: r.status as "pending" | "collected" | "cancelled",
  collectedAt: (r.collected_at as Date | null) ?? null,
  merchantName: r.merchant_name as string | undefined,
  memberName: r.member_name as string | undefined,
});

/** 買家確認後入帳：行鎖保證只入帳一次、抽獎券只發一次。 */
export async function applyConfirmation(txId: number, memberId: number, accept: boolean) {
  return withTx(async (tx) => {
    const t = await tx.q1("SELECT * FROM ef_transactions WHERE id = ? AND member_id = ? FOR UPDATE", [txId, memberId]);
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此交易" });
    if (t.status !== "pending") return { status: t.status as string, newTickets: 0 }; // 重複提交：不再處理
    if (new Date(t.expires_at).getTime() < Date.now()) {
      await tx.exec("UPDATE ef_transactions SET status='expired' WHERE id = ?", [txId]);
      throw new TRPCError({ code: "BAD_REQUEST", message: "此消費確認已逾時，請商家重新提交" });
    }
    if (!accept) {
      await tx.exec("UPDATE ef_transactions SET status='rejected', rejected_at=NOW() WHERE id = ?", [txId]);
      return { status: "rejected", newTickets: 0 };
    }
    await tx.exec("UPDATE ef_transactions SET status='confirmed', confirmed_at=NOW() WHERE id = ?", [txId]);
    const m = await tx.q1("SELECT * FROM ef_members WHERE id = ? FOR UPDATE", [memberId]);
    const total = m!.total_spend_cents + t.amount_cents;
    const chances = Math.floor(total / CHANCE_STEP_CENTS);
    const fresh = chances - m!.draw_chances_earned;
    for (let i = 1; i <= fresh; i++) {
      const seq = m!.draw_chances_earned + i;
      await tx.exec("INSERT INTO ef_draw_tickets (member_id, transaction_id, sequence, code) VALUES (?,?,?,?)", [
        memberId,
        txId,
        seq,
        `${m!.member_code}-${String(seq).padStart(3, "0")}`,
      ]);
    }
    await tx.exec("UPDATE ef_members SET total_spend_cents = ?, draw_chances_earned = ? WHERE id = ?", [total, chances, memberId]);
    return { status: "confirmed", newTickets: Math.max(fresh, 0) };
  });
}

export const memberRouter = router({
  home: memberProcedure.query(async ({ ctx }) => {
    const m = await q1("SELECT * FROM ef_members WHERE id = ?", [ctx.user.memberId]);
    if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "找不到會員資料" });
    const tickets = await q("SELECT code, status FROM ef_draw_tickets WHERE member_id = ? ORDER BY sequence", [m.id]);
    const total = m.total_spend_cents as number;
    return {
      name: m.name as string,
      memberCode: m.member_code as string,
      qrPayload: `EFM:${m.qr_token}`,
      totalSpendCents: total,
      chancesEarned: m.draw_chances_earned as number,
      remainderCents: total % CHANCE_STEP_CENTS,
      stepCents: CHANCE_STEP_CENTS,
      tickets: tickets.map((t) => ({ code: t.code as string, used: t.status === "used" })),
    };
  }),

  pending: memberProcedure.query(async ({ ctx }) => {
    await expireStale();
    const rows = await q(
      `SELECT t.*, mer.name AS merchant_name FROM ef_transactions t JOIN ef_merchants mer ON mer.id = t.merchant_id
       WHERE t.member_id = ? AND t.status = 'pending' ORDER BY t.id DESC LIMIT 5`,
      [ctx.user.memberId]
    );
    return rows.map(txOut);
  }),

  respond: memberProcedure
    .input(z.object({ id: z.number().int(), accept: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const r = await applyConfirmation(input.id, ctx.user.memberId!, input.accept);
      await audit(ctx.user.id, input.accept ? "tx.confirm" : "tx.reject", "transaction", input.id, r);
      return r;
    }),

  transactions: memberProcedure.query(async ({ ctx }) => {
    const rows = await q(
      `SELECT t.*, mer.name AS merchant_name FROM ef_transactions t JOIN ef_merchants mer ON mer.id = t.merchant_id
       WHERE t.member_id = ? ORDER BY t.id DESC LIMIT 100`,
      [ctx.user.memberId]
    );
    return rows.map(txOut);
  }),

  preorders: memberProcedure.query(async ({ ctx }) => {
    const rows = await q(
      `SELECT p.*, mer.name AS merchant_name FROM ef_preorders p JOIN ef_merchants mer ON mer.id = p.merchant_id
       WHERE p.member_id = ? AND p.status <> 'cancelled' ORDER BY p.status = 'pending' DESC, p.id DESC`,
      [ctx.user.memberId]
    );
    return rows.map(preorderOut);
  }),

  checkin: memberProcedure.query(async ({ ctx }) => {
    const g = await q1("SELECT zone, seat, group_name, checked_in_at, registration_status FROM ef_guests WHERE member_id = ?", [ctx.user.memberId]);
    return {
      checkedInAt: (g?.checked_in_at as Date | null) ?? null,
      zone: (g?.zone as string | null) ?? null,
      seat: (g?.seat as string | null) ?? null,
      walkIn: g?.registration_status === "walk_in",
    };
  }),
});

export const merchantRouter = router({
  me: merchantProcedure.query(async ({ ctx }) => {
    const m = await q1("SELECT id, name, booth FROM ef_merchants WHERE id = ?", [ctx.user.merchantId]);
    if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "找不到商家資料" });
    return { id: m.id as number, name: m.name as string, booth: (m.booth as string | null) ?? null };
  }),

  /** 掃碼或輸入會員碼後查詢：只顯示姓名、會員碼及本商家的未取貨預購單。 */
  lookup: merchantProcedure.input(z.object({ code: z.string().min(2).max(80) })).mutation(async ({ input, ctx }) => {
    const ref = parseMemberRef(input.code);
    const m = await q1(
      `SELECT id, name, member_code, is_active FROM ef_members WHERE ${ref.by === "token" ? "qr_token" : "member_code"} = ?`,
      [ref.value]
    );
    if (!m || !m.is_active) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此會員碼，請核對後再試" });
    const pre = await q(
      `SELECT p.*, mer.name AS merchant_name FROM ef_preorders p JOIN ef_merchants mer ON mer.id = p.merchant_id
       WHERE p.member_id = ? AND p.merchant_id = ? AND p.status = 'pending' ORDER BY p.id`,
      [m.id, ctx.user.merchantId]
    );
    return { memberId: m.id as number, name: m.name as string, memberCode: m.member_code as string, preorders: pre.map(preorderOut) };
  }),

  createTx: merchantProcedure
    .input(
      z.object({
        memberId: z.number().int(),
        amountCents: z.number().int().min(1, "金額必須大於 0").max(MAX_TX_CENTS, "單筆金額過大，請核對"),
        requestId: z.string().min(8).max(64),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mid = ctx.user.merchantId!;
      const member = await q1("SELECT id FROM ef_members WHERE id = ? AND is_active = 1", [input.memberId]);
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "找不到會員" });
      const existing = await q1("SELECT * FROM ef_transactions WHERE merchant_id = ? AND request_id = ?", [mid, input.requestId]);
      if (existing) {
        if (existing.member_id !== input.memberId || existing.amount_cents !== input.amountCents) {
          throw new TRPCError({ code: "CONFLICT", message: "此提交編號已用於另一筆消費，請重新提交" });
        }
        return { id: existing.id as number, status: existing.status as string, duplicate: true };
      }
      try {
        const r = await exec(
          "INSERT INTO ef_transactions (merchant_id, member_id, amount_cents, request_id, expires_at) VALUES (?,?,?,?, DATE_ADD(NOW(), INTERVAL ? MINUTE))",
          [mid, input.memberId, input.amountCents, input.requestId, TX_TTL_MIN]
        );
        await audit(ctx.user.id, "tx.create", "transaction", r.insertId, { amountCents: input.amountCents });
        return { id: r.insertId, status: "pending", duplicate: false };
      } catch (e: any) {
        if (e?.code === "ER_DUP_ENTRY") {
          const again = await q1("SELECT id, status FROM ef_transactions WHERE merchant_id = ? AND request_id = ?", [mid, input.requestId]);
          return { id: again!.id as number, status: again!.status as string, duplicate: true };
        }
        throw e;
      }
    }),

  txStatus: merchantProcedure.input(z.object({ id: z.number().int() })).query(async ({ input, ctx }) => {
    await expireStale();
    const r = await q1(
      `SELECT t.*, m.name AS member_name, m.member_code FROM ef_transactions t JOIN ef_members m ON m.id = t.member_id
       WHERE t.id = ? AND t.merchant_id = ?`,
      [input.id, ctx.user.merchantId]
    );
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "找不到交易" });
    return txOut(r);
  }),

  cancelTx: merchantProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    const r = await exec("UPDATE ef_transactions SET status='expired' WHERE id = ? AND merchant_id = ? AND status='pending'", [input.id, ctx.user.merchantId]);
    return { cancelled: r.affectedRows > 0 };
  }),

  transactions: merchantProcedure
    .input(z.object({ status: z.enum(["all", "pending", "confirmed", "rejected", "expired"]).default("all") }).optional())
    .query(async ({ input, ctx }) => {
      await expireStale();
      const st = input?.status && input.status !== "all" ? "AND t.status = ?" : "";
      const params: any[] = [ctx.user.merchantId];
      if (st) params.push(input!.status);
      const rows = await q(
        `SELECT t.*, m.name AS member_name, m.member_code FROM ef_transactions t JOIN ef_members m ON m.id = t.member_id
         WHERE t.merchant_id = ? ${st} ORDER BY t.id DESC LIMIT 300`,
        params
      );
      return rows.map(txOut);
    }),

  summary: merchantProcedure.query(async ({ ctx }) => {
    await expireStale();
    const r = await q1(
      `SELECT
         COALESCE(SUM(CASE WHEN status='confirmed' THEN amount_cents END),0) AS confirmed_cents,
         SUM(status='confirmed') AS confirmed_n, SUM(status='pending') AS pending_n,
         SUM(status='rejected') AS rejected_n, SUM(status='expired') AS expired_n
       FROM ef_transactions WHERE merchant_id = ?`,
      [ctx.user.merchantId]
    );
    return {
      confirmedCents: Number(r?.confirmed_cents ?? 0),
      confirmedCount: Number(r?.confirmed_n ?? 0),
      pendingCount: Number(r?.pending_n ?? 0),
      rejectedCount: Number(r?.rejected_n ?? 0),
      expiredCount: Number(r?.expired_n ?? 0),
    };
  }),

  preorders: merchantProcedure
    .input(z.object({ status: z.enum(["pending", "collected", "all"]).default("pending") }).optional())
    .query(async ({ input, ctx }) => {
      const st = (input?.status ?? "pending") === "all" ? "p.status <> 'cancelled'" : "p.status = ?";
      const params: any[] = [ctx.user.merchantId];
      if ((input?.status ?? "pending") !== "all") params.push(input?.status ?? "pending");
      const rows = await q(
        `SELECT p.*, m.name AS member_name FROM ef_preorders p JOIN ef_members m ON m.id = p.member_id
         WHERE p.merchant_id = ? AND ${st} ORDER BY p.id DESC LIMIT 300`,
        params
      );
      return rows.map(preorderOut);
    }),

  collectPreorder: merchantProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    const r = await exec(
      "UPDATE ef_preorders SET status='collected', collected_at=NOW(), collected_by=? WHERE id = ? AND merchant_id = ? AND status='pending'",
      [ctx.user.id, input.id, ctx.user.merchantId]
    );
    if (r.affectedRows) await audit(ctx.user.id, "preorder.collect", "preorder", input.id);
    return { collected: r.affectedRows > 0 };
  }),
});
