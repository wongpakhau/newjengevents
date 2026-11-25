import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { audit, exec, q, q1, withTx, type Tx } from "../ef/pool";

const eligibilitySchema = z.enum(["all_registered", "checked_in", "consumers", "tickets", "top_spenders"]);

type Cand = { memberId: number; ticketId: number | null };

/** 依資格取得候選名單（已排除同一抽獎中已得獎者）。 */
async function candidates(tx: Pick<Tx, "q">, draw: any): Promise<Cand[]> {
  const won = `NOT EXISTS (SELECT 1 FROM ef_draw_winners w WHERE w.draw_id = ${Number(draw.id)} AND w.member_id = m.id)`;
  switch (draw.eligibility) {
    case "all_registered": {
      const r = await tx.q(`SELECT m.id FROM ef_guests g JOIN ef_members m ON m.id = g.member_id WHERE m.is_active = 1 AND g.registration_status = 'registered' AND ${won}`);
      return r.map((x) => ({ memberId: x.id, ticketId: null }));
    }
    case "checked_in": {
      // 已簽到者等權參加；不受消費或過往中獎影響
      const r = await tx.q(`SELECT m.id FROM ef_guests g JOIN ef_members m ON m.id = g.member_id WHERE m.is_active = 1 AND g.checked_in_at IS NOT NULL AND ${won}`);
      return r.map((x) => ({ memberId: x.id, ticketId: null }));
    }
    case "consumers": {
      const r = await tx.q(`SELECT DISTINCT m.id FROM ef_members m JOIN ef_transactions t ON t.member_id = m.id AND t.status = 'confirmed' WHERE m.is_active = 1 AND ${won}`);
      return r.map((x) => ({ memberId: x.id, ticketId: null }));
    }
    case "tickets": {
      const r = await tx.q(`SELECT t.id AS ticket_id, m.id FROM ef_draw_tickets t JOIN ef_members m ON m.id = t.member_id WHERE m.is_active = 1 AND t.status = 'available' AND ${won}`);
      return r.map((x) => ({ memberId: x.id, ticketId: x.ticket_id }));
    }
    case "top_spenders": {
      const n = Math.max(1, Number(draw.shortlist_size) || 20);
      const r = await tx.q(`SELECT m.id FROM ef_members m WHERE m.is_active = 1 AND m.total_spend_cents > 0 ORDER BY m.total_spend_cents DESC, m.id ASC LIMIT ${n}`);
      const ids = new Set(r.map((x) => x.id as number));
      const w = await tx.q("SELECT member_id FROM ef_draw_winners WHERE draw_id = ?", [draw.id]);
      return [...ids].filter((id) => !w.some((x) => x.member_id === id)).map((id) => ({ memberId: id, ticketId: null }));
    }
  }
  return [];
}

const drawOut = (d: any, eligibleCount: number, winners: any[]) => ({
  id: d.id as number,
  name: d.name as string,
  kind: d.kind as "gift" | "cash" | "consumer" | "grand",
  prizeDescription: d.prize_description as string,
  prizeCount: d.prize_count as number,
  awardedCount: d.awarded_count as number,
  scheduledAt: (d.scheduled_at as Date | null) ?? null,
  eligibility: d.eligibility as z.infer<typeof eligibilitySchema>,
  shortlistSize: d.shortlist_size as number,
  rulesConfirmed: !!d.rules_confirmed,
  rulesNote: (d.rules_note as string | null) ?? null,
  status: d.status as "draft" | "ready" | "completed" | "cancelled",
  eligibleCount,
  winners: winners.map((w) => ({ id: w.id as number, name: w.name as string, memberCode: w.member_code as string, at: w.created_at as Date })),
});

export const drawsRouter = router({
  list: adminProcedure.query(async () => {
    const draws = await q("SELECT * FROM ef_draws ORDER BY scheduled_at IS NULL, scheduled_at, id");
    const out = [];
    for (const d of draws) {
      const c = await candidates({ q }, d);
      const w = await q(
        "SELECT w.id, w.created_at, m.name, m.member_code FROM ef_draw_winners w JOIN ef_members m ON m.id = w.member_id WHERE w.draw_id = ? ORDER BY w.id",
        [d.id]
      );
      out.push(drawOut(d, c.length, w));
    }
    return out;
  }),

  save: adminProcedure
    .input(
      z.object({
        id: z.number().int().optional(),
        name: z.string().min(1).max(160),
        kind: z.enum(["gift", "cash", "consumer", "grand"]),
        prizeDescription: z.string().min(1).max(300),
        prizeCount: z.number().int().min(1).max(500),
        scheduledAt: z.string().datetime().nullable(),
        eligibility: eligibilitySchema,
        shortlistSize: z.number().int().min(1).max(500).default(20),
        rulesNote: z.string().max(2000).nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const at = input.scheduledAt ? new Date(input.scheduledAt) : null;
      if (input.id) {
        const cur = await q1("SELECT status FROM ef_draws WHERE id = ?", [input.id]);
        if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "找不到抽獎項目" });
        if (cur.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "已完成的抽獎不可修改" });
        // 修改規則後必須重新確認
        await exec(
          "UPDATE ef_draws SET name=?, kind=?, prize_description=?, prize_count=?, scheduled_at=?, eligibility=?, shortlist_size=?, rules_note=?, rules_confirmed=0, status='draft' WHERE id=?",
          [input.name, input.kind, input.prizeDescription, input.prizeCount, at, input.eligibility, input.shortlistSize, input.rulesNote, input.id]
        );
        await audit(ctx.user.id, "draw.update", "draw", input.id);
        return { id: input.id };
      }
      const r = await exec(
        "INSERT INTO ef_draws (name, kind, prize_description, prize_count, scheduled_at, eligibility, shortlist_size, rules_note) VALUES (?,?,?,?,?,?,?,?)",
        [input.name, input.kind, input.prizeDescription, input.prizeCount, at, input.eligibility, input.shortlistSize, input.rulesNote]
      );
      await audit(ctx.user.id, "draw.create", "draw", r.insertId);
      return { id: r.insertId };
    }),

  /** 只有大會明確確認規則後，才可執行抽獎。 */
  confirmRules: adminProcedure.input(z.object({ id: z.number().int(), confirmed: z.boolean() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_draws SET rules_confirmed = ?, status = IF(status IN ('draft','ready'), ?, status) WHERE id = ?", [input.confirmed ? 1 : 0, input.confirmed ? "ready" : "draft", input.id]);
    await audit(ctx.user.id, input.confirmed ? "draw.confirm_rules" : "draw.unconfirm_rules", "draw", input.id);
    return { ok: true };
  }),

  /** 抽出下一位得獎者（密碼學安全隨機，行鎖防重複）。 */
  run: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    const res = await withTx(async (tx) => {
      const d = await tx.q1("SELECT * FROM ef_draws WHERE id = ? FOR UPDATE", [input.id]);
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "找不到抽獎項目" });
      if (!d.rules_confirmed) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "此抽獎規則尚未確認，不可執行" });
      if (d.status === "completed" || d.status === "cancelled" || d.awarded_count >= d.prize_count) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "此抽獎已完成" });
      }
      const pool = await candidates(tx, d);
      if (!pool.length) throw new TRPCError({ code: "BAD_REQUEST", message: "目前沒有符合資格的參加者" });
      const pick = pool[randomInt(pool.length)];
      await tx.exec("INSERT INTO ef_draw_winners (draw_id, member_id, ticket_id, prize_label) VALUES (?,?,?,?)", [d.id, pick.memberId, pick.ticketId, d.prize_description]);
      if (pick.ticketId) await tx.exec("UPDATE ef_draw_tickets SET status='used', used_at=NOW() WHERE id = ?", [pick.ticketId]);
      const awarded = d.awarded_count + 1;
      await tx.exec("UPDATE ef_draws SET awarded_count = ?, status = ? WHERE id = ?", [awarded, awarded >= d.prize_count ? "completed" : "ready", d.id]);
      const m = await tx.q1("SELECT name, member_code FROM ef_members WHERE id = ?", [pick.memberId]);
      return { name: m!.name as string, memberCode: m!.member_code as string, poolSize: pool.length, awarded, total: d.prize_count as number };
    });
    await audit(ctx.user.id, "draw.run", "draw", input.id, { winner: res.memberCode, poolSize: res.poolSize });
    return res;
  }),

  cancel: adminProcedure.input(z.object({ id: z.number().int() })).mutation(async ({ input, ctx }) => {
    await exec("UPDATE ef_draws SET status='cancelled' WHERE id = ? AND status <> 'completed'", [input.id]);
    await audit(ctx.user.id, "draw.cancel", "draw", input.id);
    return { ok: true };
  }),
});
