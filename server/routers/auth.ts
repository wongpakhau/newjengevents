import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, authedProcedure, router } from "../_core/trpc";
import {
  clearSessionCookie,
  googleClientId,
  hashPassword,
  rateLimit,
  setSessionCookie,
  signSession,
  verifyGoogleIdToken,
  verifyPassword,
  type Role,
  type SessionUser,
} from "../ef/auth";
import { audit, exec, q, q1 } from "../ef/pool";
import { normalizePhone } from "../ef/members";

const portalSchema = z.enum(["staff", "merchant", "member"]);
type Portal = z.infer<typeof portalSchema>;

const PORTAL_ROLES: Record<Portal, Role[]> = {
  staff: ["owner", "admin", "staff"],
  merchant: ["merchant"],
  member: ["member"],
};
const PORTAL_NAME: Record<Portal, string> = { staff: "大會管理員／工作人員", merchant: "商家", member: "用戶／嘉賓" };

function toSessionUser(row: any): SessionUser {
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
}

async function startSession(ctx: { res: any }, row: any) {
  const token = await signSession(row.id, row.session_version);
  setSessionCookie(ctx.res, token);
  await exec("UPDATE ef_users SET last_login_at = NOW() WHERE id = ?", [row.id]);
  return { token, user: toSessionUser(row) };
}

function ipOf(ctx: { req: any }): string {
  return String(ctx.req.headers["x-forwarded-for"] ?? ctx.req.ip ?? "").split(",")[0].trim();
}

export const authRouter = router({
  me: publicProcedure.query(({ ctx }) => ctx.user),

  config: publicProcedure.query(async () => {
    const ev = await q1("SELECT name, event_date, start_time, venue, timezone FROM ef_events ORDER BY id LIMIT 1");
    return {
      googleClientId: googleClientId() || null,
      event: ev
        ? {
            name: ev.name as string,
            date: typeof ev.event_date === "string" ? ev.event_date : new Date(ev.event_date).toISOString().slice(0, 10),
            startTime: (ev.start_time as string | null) ?? null,
            venue: (ev.venue as string | null) ?? null,
          }
        : null,
    };
  }),

  passwordLogin: publicProcedure
    .input(z.object({ portal: portalSchema, identity: z.string().min(1).max(320), password: z.string().min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const id = input.identity.trim().toLowerCase();
      if (!rateLimit(`pw:${ipOf(ctx)}:${id}`, 8)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "嘗試次數過多，請 10 分鐘後再試" });
      }
      const row = await q1("SELECT * FROM ef_users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1", [id, id]);
      const ok = row && row.password_hash && (await verifyPassword(input.password, row.password_hash));
      if (!row || !ok) throw new TRPCError({ code: "UNAUTHORIZED", message: "帳號或密碼不正確" });
      if (!row.is_active) throw new TRPCError({ code: "FORBIDDEN", message: "此帳號已停用，請聯絡大會" });
      if (row.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "系統擁有人必須使用 Google 登入" });
      }
      if (!PORTAL_ROLES[input.portal].includes(row.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: `此帳號不屬於「${PORTAL_NAME[input.portal]}」，請返回選擇正確身份` });
      }
      return startSession(ctx, row);
    }),

  googleLogin: publicProcedure
    .input(z.object({ portal: portalSchema, credential: z.string().min(20).max(4000) }))
    .mutation(async ({ input, ctx }) => {
      let g;
      try {
        g = await verifyGoogleIdToken(input.credential);
      } catch (e: any) {
        if (e?.message === "GOOGLE_NOT_CONFIGURED") {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google 登入尚未設定，請暫用帳號密碼登入" });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Google 身份驗證失敗，請再試一次" });
      }
      const allow = await q1("SELECT id FROM ef_owner_allowlist WHERE email = ?", [g.email]);
      let row = await q1("SELECT * FROM ef_users WHERE google_sub = ? OR LOWER(email) = ? ORDER BY google_sub = ? DESC LIMIT 1", [g.sub, g.email, g.sub]);

      if (allow) {
        // 系統擁有人：只有經 Google 驗證的名單電郵才能取得
        if (input.portal !== "staff") {
          throw new TRPCError({ code: "FORBIDDEN", message: "系統擁有人請由「大會管理員／工作人員」入口登入" });
        }
        if (!row) {
          const r = await exec(
            "INSERT INTO ef_users (email, name, role, google_sub, google_email_verified) VALUES (?,?,?,?,1)",
            [g.email, g.name, "owner", g.sub]
          );
          row = await q1("SELECT * FROM ef_users WHERE id = ?", [r.insertId]);
        } else {
          await exec(
            "UPDATE ef_users SET role='owner', google_sub=?, google_email_verified=1, is_active=1, email=?, session_version=session_version WHERE id=?",
            [g.sub, g.email, row.id]
          );
          row = await q1("SELECT * FROM ef_users WHERE id = ?", [row.id]);
        }
        await exec("UPDATE ef_owner_allowlist SET user_id = ?, verified_at = COALESCE(verified_at, NOW()) WHERE id = ?", [row!.id, allow.id]);
        await audit(row!.id, "owner.google_verified", "user", row!.id, { email: g.email });
        return startSession(ctx, row);
      }

      if (!row) {
        throw new TRPCError({ code: "FORBIDDEN", message: "此 Google 帳戶未獲授權，請聯絡大會管理員建立帳號" });
      }
      if (!row.is_active) throw new TRPCError({ code: "FORBIDDEN", message: "此帳號已停用，請聯絡大會" });
      if (row.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "此帳號不在系統擁有人名單內" });
      }
      if (!PORTAL_ROLES[input.portal].includes(row.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: `此帳號不屬於「${PORTAL_NAME[input.portal]}」` });
      }
      await exec("UPDATE ef_users SET google_sub = ?, google_email_verified = 1 WHERE id = ?", [g.sub, row.id]);
      row = await q1("SELECT * FROM ef_users WHERE id = ?", [row.id]);
      return startSession(ctx, row);
    }),

  /** 嘉賓自助選名：不回傳任何電話；可按姓名或電話排序（電話只用作排序，不顯示）。 */
  guestDirectory: publicProcedure
    .input(
      z.object({
        sort: z.enum(["name", "phone"]).default("name"),
        dir: z.enum(["asc", "desc"]).default("asc"),
        q: z.string().max(40).optional(),
      })
    )
    .query(async ({ input }) => {
      const order = input.sort === "phone" ? "m.phone" : "m.name";
      const dir = input.dir === "desc" ? "DESC" : "ASC";
      const where = input.q?.trim() ? "AND m.name LIKE ?" : "";
      const params = input.q?.trim() ? [`%${input.q.trim()}%`] : [];
      const rows = await q(
        `SELECT g.public_id AS id, m.name FROM ef_guests g JOIN ef_members m ON m.id = g.member_id
         WHERE m.is_active = 1 ${where} ORDER BY ${order} ${dir}, g.id ASC LIMIT 800`,
        params
      );
      return rows.map((r) => ({ id: r.id as string, name: r.name as string }));
    }),

  guestLogin: publicProcedure
    .input(z.object({ guestId: z.string().min(4).max(40), phone: z.string().min(4).max(20) }))
    .mutation(async ({ input, ctx }) => {
      if (!rateLimit(`guest:${ipOf(ctx)}:${input.guestId}`, 6)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "嘗試次數過多，請 10 分鐘後再試" });
      }
      const g = await q1(
        "SELECT g.member_id, m.name, m.phone, m.email, m.is_active FROM ef_guests g JOIN ef_members m ON m.id = g.member_id WHERE g.public_id = ?",
        [input.guestId]
      );
      if (!g || !g.is_active || normalizePhone(input.phone) !== g.phone) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "電話號碼與所選姓名不符" });
      }
      let row = await q1("SELECT * FROM ef_users WHERE member_id = ? AND role = 'member' LIMIT 1", [g.member_id]);
      if (!row) {
        const r = await exec("INSERT INTO ef_users (name, phone, role, member_id) VALUES (?,?,?,?)", [g.name, g.phone, "member", g.member_id]);
        row = await q1("SELECT * FROM ef_users WHERE id = ?", [r.insertId]);
      }
      if (!row!.is_active) throw new TRPCError({ code: "FORBIDDEN", message: "此帳號已停用，請聯絡大會" });
      return startSession(ctx, row);
    }),

  changePassword: authedProcedure
    .input(z.object({ oldPassword: z.string().max(200), newPassword: z.string().min(8, "新密碼最少 8 個字元").max(200) }))
    .mutation(async ({ input, ctx }) => {
      const row = await q1("SELECT * FROM ef_users WHERE id = ?", [ctx.user.id]);
      if (row?.password_hash && !(await verifyPassword(input.oldPassword, row.password_hash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "舊密碼不正確" });
      }
      await exec("UPDATE ef_users SET password_hash = ?, must_change_password = 0 WHERE id = ?", [await hashPassword(input.newPassword), ctx.user.id]);
      await audit(ctx.user.id, "user.change_password", "user", ctx.user.id);
      return { ok: true };
    }),

  logout: publicProcedure.mutation(({ ctx }) => {
    clearSessionCookie(ctx.res);
    return { ok: true };
  }),
});
