import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LogOut } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { setToken } from "@/lib/session";

export type Tab = { key: string; label: string; icon: ReactNode };

export function Seal({ size = 36 }: { size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-md bg-primary text-primary-foreground font-serif font-bold shrink-0 shadow-sm"
      style={{ width: size, height: size, fontSize: size * 0.55, boxShadow: "inset 0 0 0 2px rgba(255,248,238,.35)" }}
      aria-hidden
    >
      正
    </div>
  );
}

export function AppShell({
  base,
  tabs,
  active,
  title,
  children,
}: {
  base: string;
  tabs: Tab[];
  active: string;
  title: string;
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const [, nav] = useLocation();
  const me = trpc.auth.me.useQuery();
  const cfg = trpc.auth.config.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSettled: () => {
      setToken(null);
      utils.auth.me.setData(undefined, null);
      nav("/");
    },
  });

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b">
        <div className="mx-auto max-w-xl flex items-center gap-3 px-4 py-2.5">
          <Seal />
          <div className="min-w-0 flex-1">
            <div className="font-serif font-bold leading-tight truncate">{cfg.data?.event?.name ?? "正向春茗活動"}</div>
            <div className="text-xs text-muted-foreground truncate">
              {title} · {me.data?.name}
            </div>
          </div>
          <button
            onClick={() => logout.mutate()}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm text-muted-foreground active:bg-muted"
            aria-label="登出"
          >
            <LogOut size={16} /> 登出
          </button>
        </div>
        <div className="gold-rule" />
      </header>

      <main className="mx-auto max-w-xl px-4 pt-4 pb-28">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-card border-t pb-safe">
        <div className="mx-auto max-w-xl flex overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const on = t.key === active;
            return (
              <Link
                key={t.key}
                href={`${base}/${t.key}`}
                className={`flex-1 min-w-[4.5rem] flex flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "text-primary font-bold" : "text-muted-foreground"}`}
              >
                <span className={`grid place-items-center h-7 w-12 rounded-full ${on ? "bg-accent" : ""}`}>{t.icon}</span>
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`ticket-card p-4 ${className}`}>{children}</section>;
}

export function PageTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h1 className="text-xl font-bold">{children}</h1>
      {hint && <p className="text-sm text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

const STATUS: Record<string, { t: string; c: string }> = {
  pending: { t: "待確認", c: "bg-amber-100 text-amber-800" },
  confirmed: { t: "已確認", c: "bg-emerald-100 text-emerald-800" },
  rejected: { t: "已拒絕", c: "bg-red-100 text-red-800" },
  expired: { t: "已逾時／取消", c: "bg-stone-200 text-stone-700" },
  collected: { t: "已取貨", c: "bg-emerald-100 text-emerald-800" },
  cancelled: { t: "已取消", c: "bg-stone-200 text-stone-700" },
};
export function StatusBadge({ s, labels }: { s: string; labels?: Record<string, string> }) {
  const v = STATUS[s] ?? { t: s, c: "bg-stone-200 text-stone-700" };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${v.c}`}>{labels?.[s] ?? v.t}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl bg-muted/70 px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold leading-snug">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}
