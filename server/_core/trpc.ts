import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type { Role } from "../ef/auth";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const UNAUTHED_MSG = "請先登入";
export const FORBIDDEN_MSG = "你沒有使用此功能的權限";

function roleProcedure(roles: Role[]) {
  return t.procedure.use(
    t.middleware(async ({ ctx, next }) => {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_MSG });
      if (!roles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN", message: FORBIDDEN_MSG });
      return next({ ctx: { ...ctx, user: ctx.user } });
    })
  );
}

export const authedProcedure = roleProcedure(["owner", "admin", "staff", "merchant", "member"]);
/** 大會管理員（含系統擁有人） */
export const adminProcedure = roleProcedure(["owner", "admin"]);
/** 工作人員（含管理員及擁有人）：簽到、名單 */
export const staffProcedure = roleProcedure(["owner", "admin", "staff"]);
export const merchantProcedure = roleProcedure(["merchant"]);
export const memberProcedure = roleProcedure(["member"]);
