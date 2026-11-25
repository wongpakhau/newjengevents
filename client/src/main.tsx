import { trpc } from "@/lib/trpc";
import { getToken, setToken } from "@/lib/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

// 登入逾期時清除本機 token，畫面會自動回到登入頁
const onError = (error: unknown) => {
  if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED" && getToken()) {
    setToken(null);
    queryClient.invalidateQueries({ queryKey: [["auth", "me"]] });
  }
};
queryClient.getQueryCache().subscribe((e) => {
  if (e.type === "updated" && e.action.type === "error") onError(e.query.state.error);
});
queryClient.getMutationCache().subscribe((e) => {
  if (e.type === "updated" && e.action.type === "error") onError(e.mutation.state.error);
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        const t = getToken();
        return t ? { Authorization: `Bearer ${t}` } : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, { ...(init ?? {}), credentials: "include" });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
