import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { userFromRequest, type SessionUser } from "../ef/auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: SessionUser | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: SessionUser | null = null;
  try {
    user = await userFromRequest(opts.req);
  } catch {
    user = null;
  }
  return { req: opts.req, res: opts.res, user };
}
