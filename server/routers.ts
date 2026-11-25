import { router } from "./_core/trpc";
import { systemRouter } from "./_core/systemRouter";
import { authRouter } from "./routers/auth";
import { memberRouter, merchantRouter } from "./routers/memberMerchant";
import { staffRouter } from "./routers/staff";
import { adminRouter } from "./routers/admin";
import { drawsRouter } from "./routers/draws";
import { auctionsRouter } from "./routers/auctions";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  member: memberRouter,
  merchant: merchantRouter,
  staff: staffRouter,
  admin: adminRouter,
  draws: drawsRouter,
  auctions: auctionsRouter,
});

export type AppRouter = typeof appRouter;
