import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, memberProcedure, router } from "../_core/trpc";
import { audit, exec, q, q1, withTx } from "../ef/pool";

const MAX_BID = 99_999_900;

/** 逾時的進行中拍賣自動轉為已結束。 */
async function closeExpired() {
  await exec("UPDATE ef_auctions SET status='ended' WHERE status='active' AND ends_at IS NOT NULL AND ends_at < NOW()");
}

async function auctionState(a: any, viewerMemberId?: number, showBidders = false) {
  const top = await q("SELECT b.member_id, b.amount_cents, m.name FROM ef_bids b JOIN ef_members m ON m.id = b.member_id WHERE b.auction_id = ? ORDER BY b.amount_cents DESC, b.id ASC LIMIT 5", [a.id]);
  const count = await q1("SELECT COUNT(*) AS n FROM ef_bids WHERE auction_id = ?", [a.id]);
  const hasBids = top.length > 0;
  const current = hasBids ? (top[0].amount_cents as number) : (a.starting_price_cents as number);
  return {
    id: a.id as number,
    title: a.title as string,
    description: (a.description as string | null) ?? null,
    startingPriceCents: a.starting_price_cents as number,
    minIncrementCents: a.min_increment_cents as number,
    durationMinutes: (a.duration_minutes as number | null) ?? null,
    paymentMethod: (a.payment_method as string | null) ?? null,
    rulesConfirmed: !!a.rules_confirmed,
    rulesNote: (a.rules_note as string | null) ?? null,
    status: a.status as "draft" | "active" | "ended" | "cancelled",
    startsAt: (a.starts_at as Date | null) ?? null,
    endsAt: (a.ends_at as Date | null) ?? null,
    currentCents: current,
    nextMinCents: hasBids ? current + (a.min_increment_cents as number) : (a.starting_price_cents as number),
    bidCount: Number(count?.n ?? 0),
    youLead: viewerMemberId != null && hasBids && top[0].member_id === viewerMemberId,
    leader: showBidders && hasBids ? { name: top[0].name as string, amountCents: top[0].amount_cents as number } : null,
    serverNow: new Date(),
  };
}

export const auctionsRouter = router({
  /* ---------- 管理員 ---------- */
  adminList: adminProcedure.query(async () => {
    await closeExpired();
    const rows = await q("SELECT * FROM ef_auctions ORDER BY id DESC");
    return Promise.all(rows.map((a) => auctionState(a, undefined, true)));
  }),

  save: adminProcedure
    .input(
      z.object({
        id: z.number().int().optional(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).nullable(),
        startingPriceCents: z.number().int().min(0).max(MAX_BID),
        minIncrementCents: z.number().int().min(100).max(MAX_BID),
        durationMinutes: z.number().int().min(1).max(10080).nullable(),
        paymentMethod: z.string().max(300).nullable(),
        rulesNote: z.string().max(2000).nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.id) {
        const cur = await q1("SELECT status FROM ef_auctions WHERE id = ?", [input.id]);
        if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "找不到拍賣品" });
        if (cur.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "拍賣開始後不可修改設定" });
        await exec(
          "UPDATE ef_auctions SET title=?, description=?, starting_price_cents=?, min_increment_cents=?, duration_minutes=?, payment_method=?, rules_note=?, rules_confirmed=0 WHERE id=?",
          [input.title, input.description, input.startingPriceCents, input.minIncrementCents, input.durationMinutes, input.paymentMethod, input.rulesNote, input.id]
        );
        await audit(ctx.user.id, "auction.update", "auction", input.id);
        return { id: input.id };
      }
      const r = await exec(
        "INSERT INTO ef_auctions (title, description, starting_price_cents, min_increment_cents, duration_minutes, payment_method, rules_note) VALUES (?,?,?,?,?,?,?)",
        [input.title, input.description, input.startingPriceCents, input.minIncrementCents, input.durationMinutes, input.paymentMethod, input.rulesNote]
      );
      await audit(ctx.user.id, "auction.create", "auction", r.insertId);
      return { id: r.insertId };
    }),

  confirmRules: adminProcedure.input(z.object({ id: z.number().int(), confirmed: z.boolean() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_auctions SET rules_confirmed = ? WHERE id = ? AND status = 'draft'", [input.confirmed ? 1 : 0, input.id]);
    await audit(ctx.user.id, "auction.confirm_rules", "auction", input.id, input);
    return { ok: true };
  }),

  start: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    const a = await q1("SELECT * FROM ef_auctions WHERE id = ?", [input.id]);
    if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "找不到拍賣品" });
    if (a.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "此拍賣已開始或已結束" });
    if (!a.rules_confirmed) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "拍賣規則尚未確認，不可開始" });
    await exec("UPDATE ef_auctions SET status='active', starts_at=NOW(), ends_at = IF(duration_minutes IS NULL, NULL, DATE_ADD(NOW(), INTERVAL duration_minutes MINUTE)) WHERE id = ?", [input.id]);
    await audit(ctx.user.id, "auction.start", "auction", input.id);
    return { ok: true };
  }),

  end: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_auctions SET status='ended', ends_at = NOW() WHERE id = ? AND status='active'", [input.id]);
    await audit(ctx.user.id, "auction.end", "auction", input.id);
    return { ok: true };
  }),

  cancel: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_auctions SET status='cancelled' WHERE id = ? AND status IN ('draft','active')", [input.id]);
    await audit(ctx.user.id, "auction.cancel", "auction", input.id);
    return { ok: true };
  }),

  bids: adminProcedure.input(z.object({ id: z.number().int() })).query(async ({ input }) => {
    const rows = await q("SELECT b.id, b.amount_cents, b.created_at, m.name, m.member_code FROM ef_bids b JOIN ef_members m ON m.id = b.member_id WHERE b.auction_id = ? ORDER BY b.id DESC LIMIT 50", [input.id]);
    return rows.map((r) => ({ id: r.id as number, name: r.name as string, memberCode: r.member_code as string, amountCents: r.amount_cents as number, createdAt: r.created_at as Date }));
  }),

  /* ---------- 用戶 ---------- */
  list: memberProcedure.query(async ({ ctx }) => {
    await closeExpired();
    const rows = await q("SELECT * FROM ef_auctions WHERE status IN ('active','ended') ORDER BY status = 'active' DESC, id DESC LIMIT 30");
    return Promise.all(rows.map((a) => auctionState(a, ctx.user.memberId!)));
  }),

  bid: memberProcedure
    .input(z.object({ auctionId: z.number().int(), amountCents: z.number().int().min(1).max(MAX_BID) }))
    .mutation(async ({ input, ctx }) => {
      const res = await withTx(async (tx) => {
        const a = await tx.q1("SELECT * FROM ef_auctions WHERE id = ? FOR UPDATE", [input.auctionId]);
        if (!a || a.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "此拍賣未開始或已結束" });
        const now = await tx.q1("SELECT NOW() AS n");
        if (a.ends_at && new Date(a.ends_at).getTime() <= new Date(now!.n).getTime()) {
          await tx.exec("UPDATE ef_auctions SET status='ended' WHERE id = ?", [a.id]);
          throw new TRPCError({ code: "BAD_REQUEST", message: "拍賣時間已完結" });
        }
        const top = await tx.q1("SELECT amount_cents FROM ef_bids WHERE auction_id = ? ORDER BY amount_cents DESC, id ASC LIMIT 1", [a.id]);
        const need = top ? top.amount_cents + a.min_increment_cents : a.starting_price_cents;
        if (input.amountCents < need) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `出價最少須為 HK$${(need / 100).toLocaleString("en-HK")}，請重新輸入` });
        }
        await tx.exec("INSERT INTO ef_bids (auction_id, member_id, amount_cents) VALUES (?,?,?)", [a.id, ctx.user.memberId, input.amountCents]);
        return { amountCents: input.amountCents };
      });
      await audit(ctx.user.id, "auction.bid", "auction", input.auctionId, res);
      return res;
    }),
});
