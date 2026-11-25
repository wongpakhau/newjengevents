import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffProcedure } from "../_core/trpc";
import { audit, exec, q, q1 } from "../ef/pool";
import { createMemberWithGuest } from "../ef/members";

const SORTS: Record<string, string> = {
  name: "m.name",
  phone: "m.phone",
  code: "m.member_code",
  zone: "g.zone",
  seat: "g.seat",
  checkin: "g.checked_in_at",
};

export const guestRow = (r: any) => ({
  guestId: r.guest_id as number,
  memberId: r.member_id as number,
  name: r.name as string,
  phone: r.phone as string,
  memberCode: r.member_code as string,
  zone: (r.zone as string | null) ?? null,
  seat: (r.seat as string | null) ?? null,
  groupName: (r.group_name as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  walkIn: r.registration_status === "walk_in",
  checkedInAt: (r.checked_in_at as Date | null) ?? null,
});

const GUEST_SELECT = `SELECT g.id AS guest_id, g.member_id, m.name, m.phone, m.member_code, g.zone, g.seat, g.group_name, g.note,
  g.registration_status, g.checked_in_at FROM ef_guests g JOIN ef_members m ON m.id = g.member_id`;

export async function listGuests(opts: {
  q?: string;
  sort: string;
  dir: "asc" | "desc";
  filter: "all" | "checked" | "unchecked";
  zone?: string;
}) {
  const where: string[] = ["m.is_active = 1"];
  const params: any[] = [];
  const s = opts.q?.trim();
  if (s) {
    where.push("(m.name LIKE ? OR m.phone LIKE ? OR m.member_code LIKE ?)");
    params.push(`%${s}%`, `%${s.replace(/[^0-9]/g, "") || s}%`, `%${s}%`);
  }
  if (opts.filter === "checked") where.push("g.checked_in_at IS NOT NULL");
  if (opts.filter === "unchecked") where.push("g.checked_in_at IS NULL");
  if (opts.zone) {
    where.push("g.zone = ?");
    params.push(opts.zone);
  }
  const col = SORTS[opts.sort] ?? SORTS.name;
  const dir = opts.dir === "desc" ? "DESC" : "ASC";
  const rows = await q(`${GUEST_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${col} ${dir}, g.id ASC LIMIT 1000`, params);
  return rows.map(guestRow);
}

export const staffRouter = router({
  guests: staffProcedure
    .input(
      z.object({
        q: z.string().max(60).optional(),
        sort: z.enum(["name", "phone", "code", "zone", "seat", "checkin"]).default("name"),
        dir: z.enum(["asc", "desc"]).default("asc"),
        filter: z.enum(["all", "checked", "unchecked"]).default("all"),
        zone: z.string().max(80).optional(),
      })
    )
    .query(({ input }) => listGuests(input)),

  stats: staffProcedure.query(async () => {
    const r = await q1("SELECT COUNT(*) AS total, SUM(g.checked_in_at IS NOT NULL) AS checked FROM ef_guests g JOIN ef_members m ON m.id = g.member_id WHERE m.is_active = 1");
    const zones = await q("SELECT DISTINCT zone FROM ef_guests WHERE zone IS NOT NULL AND zone <> '' ORDER BY zone");
    return { total: Number(r?.total ?? 0), checked: Number(r?.checked ?? 0), zones: zones.map((z) => z.zone as string) };
  }),

  /** 掃碼：EFM:token 或會員碼 */
  find: staffProcedure.input(z.object({ code: z.string().min(2).max(80) })).mutation(async ({ input }) => {
    const v = input.code.trim();
    const byToken = /^EFM:/i.test(v);
    const r = await q1(`${GUEST_SELECT} WHERE ${byToken ? "m.qr_token" : "m.member_code"} = ? AND m.is_active = 1`, [byToken ? v.slice(4).trim() : v.toUpperCase()]);
    if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此嘉賓" });
    return guestRow(r);
  }),

  checkIn: staffProcedure.input(z.object({ guestId: z.number().int() })).mutation(async ({ input, ctx }) => {
    const before = await q1("SELECT checked_in_at FROM ef_guests WHERE id = ?", [input.guestId]);
    if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "找不到嘉賓" });
    // 已簽到的保留第一次簽到時間，不重複記錄
    const r = await exec("UPDATE ef_guests SET checked_in_at = NOW(), checked_in_by = ? WHERE id = ? AND checked_in_at IS NULL", [ctx.user.id, input.guestId]);
    if (r.affectedRows) await audit(ctx.user.id, "guest.checkin", "guest", input.guestId);
    const row = await q1(`${GUEST_SELECT} WHERE g.id = ?`, [input.guestId]);
    return { guest: guestRow(row), alreadyCheckedIn: r.affectedRows === 0 };
  }),

  /** 現場新增未預先報名的嘉賓／消費者（會員碼即時產生） */
  addWalkIn: staffProcedure
    .input(z.object({ name: z.string().min(1).max(60), phone: z.string().min(6).max(20), checkIn: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      const m = await createMemberWithGuest({ name: input.name, phone: input.phone, walkIn: true });
      if (input.checkIn) await exec("UPDATE ef_guests SET checked_in_at = NOW(), checked_in_by = ? WHERE id = ?", [ctx.user.id, m.guestId]);
      await audit(ctx.user.id, "guest.walkin", "guest", m.guestId);
      return m;
    }),
});
