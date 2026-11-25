import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

export type Out = inferRouterOutputs<AppRouter>;
export type AuctionRow = Out["auctions"]["list"][number];
