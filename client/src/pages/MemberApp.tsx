import { useEffect, useState } from "react";
import { useRoute, Redirect } from "wouter";
import { toast } from "sonner";
import { Gavel, Package, QrCode, Armchair, UserRound } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Guard, ChangePassword, MustChangeBanner } from "@/lib/auth";
import { errMsg, hkd, hkTime, parseCents } from "@/lib/format";
import type { AuctionRow } from "@/lib/types";
import { AppShell, Card, Empty, PageTitle, StatusBadge, Tab } from "@/components/ef/Shell";
import { QrImage } from "@/components/ef/Qr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TABS: Tab[] = [
  { key: "ticket", label: "消費領獎券", icon: <QrCode size={20} /> },
  { key: "preorders", label: "預購單", icon: <Package size={20} /> },
  { key: "seat", label: "簽到座位", icon: <Armchair size={20} /> },
  { key: "auction", label: "拍賣", icon: <Gavel size={20} /> },
  { key: "me", label: "我的", icon: <UserRound size={20} /> },
];

export default function MemberApp() {
  const [, p] = useRoute("/member/:tab");
  const tab = p?.tab;
  if (!tab) return <Redirect to="/member/ticket" />;
  return (
    <Guard roles={["member"]}>
      <AppShell base="/member" tabs={TABS} active={tab} title="用戶／嘉賓">
        <MustChangeBanner />
        {tab === "ticket" && <TicketTab />}
        {tab === "preorders" && <PreordersTab />}
        {tab === "seat" && <SeatTab />}
        {tab === "auction" && <AuctionTab />}
        {tab === "me" && <MeTab />}
      </AppShell>
      <PendingPopup />
    </Guard>
  );
}

/** 商家提交消費後，買家手機彈出確認窗；每 2.5 秒檢查一次。 */
function PendingPopup() {
  const utils = trpc.useUtils();
  const pending = trpc.member.pending.useQuery(undefined, { refetchInterval: 2500, refetchIntervalInBackground: false });
  const respond = trpc.member.respond.useMutation({
    onSuccess: (r, v) => {
      if (r.status === "confirmed") toast.success(r.newTickets > 0 ? `已確認，並獲得 ${r.newTickets} 張抽獎券` : "已確認消費");
      else if (r.status === "rejected") toast("已拒絕此消費");
      else toast("此消費已處理");
      utils.member.invalidate();
    },
    onError: (e) => {
      toast.error(errMsg(e));
      utils.member.pending.invalidate();
    },
  });
  const t = pending.data?.[0];
  useEffect(() => {
    if (t) navigator.vibrate?.([120, 60, 120]);
  }, [t?.id]);
  if (!t) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/55 p-3" role="dialog" aria-modal="true" aria-label="確認消費">
      <div className="ticket-card w-full max-w-md p-5 pop-in">
        <p className="text-sm text-muted-foreground">請確認以下消費</p>
        <p className="mt-1 font-serif text-lg font-bold">{t.merchantName}</p>
        <p className="mt-1 text-4xl font-bold text-primary">{hkd(t.amountCents)}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          只有你按「確認」後，這筆消費才會計入營業額及抽獎機會。請核對金額，如非你本人消費請按「拒絕」。
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-14 text-base" disabled={respond.isPending} onClick={() => respond.mutate({ id: t.id, accept: false })}>
            拒絕
          </Button>
          <Button className="h-14 text-base" disabled={respond.isPending} onClick={() => respond.mutate({ id: t.id, accept: true })}>
            {respond.isPending ? "處理中…" : "確認"}
          </Button>
        </div>
        {(pending.data?.length ?? 0) > 1 && <p className="mt-2 text-center text-xs text-muted-foreground">另有 {(pending.data?.length ?? 1) - 1} 筆待確認</p>}
      </div>
    </div>
  );
}

function TicketTab() {
  const home = trpc.member.home.useQuery(undefined, { refetchInterval: 6000 });
  const d = home.data;
  if (!d) return <Empty>載入中…</Empty>;
  const pct = Math.min(100, Math.round((d.remainderCents / d.stepCents) * 100));
  return (
    <div className="space-y-4">
      <PageTitle>消費領抽獎券</PageTitle>
      <Card className="text-center">
        <p className="text-sm text-muted-foreground">請向商家出示此 QR code</p>
        <div className="mt-3 flex justify-center">
          <QrImage value={d.qrPayload} size={224} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">會員碼 Membership code</p>
        <p className="font-serif text-3xl font-bold tracking-widest text-primary">{d.memberCode}</p>
        <p className="text-sm">{d.name}</p>
      </Card>

      <Card>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm text-muted-foreground">已確認累計消費</p>
            <p className="text-2xl font-bold">{hkd(d.totalSpendCents)}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">抽獎券</p>
            <p className="text-2xl font-bold text-primary">{d.chancesEarned} 張</p>
          </div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          每滿 {hkd(d.stepCents)} 可得一張抽獎券，再消費 {hkd(d.stepCents - d.remainderCents)} 可獲下一張（不足的餘額會保留，跨商戶累計）。
        </p>
        {d.tickets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {d.tickets.map((t) => (
              <span key={t.code} className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${t.used ? "bg-muted text-muted-foreground line-through" : "bg-accent"}`}>
                {t.code}
              </span>
            ))}
          </div>
        )}
      </Card>
      <HistoryList />
    </div>
  );
}

function HistoryList() {
  const tx = trpc.member.transactions.useQuery(undefined, { refetchInterval: 8000 });
  return (
    <Card>
      <h2 className="mb-1 font-bold">我的消費記錄</h2>
      {!tx.data?.length ? (
        <Empty>暫時沒有消費記錄</Empty>
      ) : (
        <ul className="divide-y">
          {tx.data.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.merchantName}</p>
                <p className="text-xs text-muted-foreground">{hkTime(t.createdAt)}</p>
              </div>
              <div className="text-right">
                <p className="font-bold">{hkd(t.amountCents)}</p>
                <StatusBadge s={t.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PreordersTab() {
  const q = trpc.member.preorders.useQuery(undefined, { refetchInterval: 8000 });
  const pending = q.data?.filter((p) => p.status === "pending") ?? [];
  const done = q.data?.filter((p) => p.status === "collected") ?? [];
  const Item = ({ p }: { p: NonNullable<typeof q.data>[number] }) => (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{p.merchantName}</p>
          <p className="text-sm">{p.items}</p>
          <p className="text-xs text-muted-foreground">訂單 {p.orderNo}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold">{hkd(p.amountCents)}</p>
          <StatusBadge s={p.status === "pending" ? "pending" : "collected"} labels={{ pending: "待取貨" }} />
        </div>
      </div>
    </li>
  );
  return (
    <div className="space-y-4">
      <PageTitle hint="到商家攤位取貨時，出示你的 QR code，商家會看到並標記已取貨。">我的預購單</PageTitle>
      <Card>
        <h2 className="font-bold">待取貨（{pending.length}）</h2>
        {pending.length ? <ul className="divide-y">{pending.map((p) => <Item key={p.id} p={p} />)}</ul> : <Empty>沒有待取貨的預購單</Empty>}
      </Card>
      {done.length > 0 && (
        <Card>
          <h2 className="font-bold">已取貨（{done.length}）</h2>
          <ul className="divide-y">{done.map((p) => <Item key={p.id} p={p} />)}</ul>
        </Card>
      )}
    </div>
  );
}

function SeatTab() {
  const c = trpc.member.checkin.useQuery(undefined, { refetchInterval: 8000 });
  const d = c.data;
  return (
    <div className="space-y-4">
      <PageTitle>簽到及座位</PageTitle>
      <Card className="text-center">
        {!d ? (
          <Empty>載入中…</Empty>
        ) : (
          <>
            <p className={`mx-auto inline-block rounded-full px-4 py-1.5 text-sm font-bold ${d.checkedInAt ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {d.checkedInAt ? `已簽到 ${hkTime(d.checkedInAt)}` : "尚未簽到"}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted p-4">
                <p className="text-xs text-muted-foreground">分區</p>
                <p className="mt-1 font-serif text-2xl font-bold">{d.zone ?? "待安排"}</p>
              </div>
              <div className="rounded-xl bg-muted p-4">
                <p className="text-xs text-muted-foreground">座位</p>
                <p className="mt-1 font-serif text-2xl font-bold">{d.seat ?? "待安排"}</p>
              </div>
            </div>
            {!d.checkedInAt && <p className="mt-4 text-sm text-muted-foreground">抵達會場後，請向工作人員出示 QR code 簽到。</p>}
          </>
        )}
      </Card>
    </div>
  );
}

function AuctionTab() {
  const q = trpc.auctions.list.useQuery(undefined, { refetchInterval: 3000 });
  return (
    <div className="space-y-4">
      <PageTitle hint="現價每數秒自動更新。">拍賣</PageTitle>
      {!q.data?.length ? <Card><Empty>目前沒有進行中的拍賣</Empty></Card> : q.data.map((a) => <AuctionCard key={a.id} a={a} />)}
    </div>
  );
}

function Countdown({ endsAt }: { endsAt: Date | string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!endsAt) return <span>由大會宣佈結束</span>;
  const s = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  return <span>剩餘 {Math.floor(s / 60)} 分 {String(s % 60).padStart(2, "0")} 秒</span>;
}

function AuctionCard({ a }: { a: AuctionRow }) {
  const utils = trpc.useUtils();
  const [v, setV] = useState("");
  const bid = trpc.auctions.bid.useMutation({
    onSuccess: () => {
      toast.success("出價成功");
      setV("");
      utils.auctions.list.invalidate();
    },
    onError: (e) => {
      toast.error(errMsg(e));
      utils.auctions.list.invalidate();
    },
  });
  const active = a.status === "active";
  const cents = parseCents(v);
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-serif text-lg font-bold">{a.title}</h2>
        <StatusBadge s={active ? "confirmed" : "expired"} labels={{ confirmed: "進行中", expired: "已結束" }} />
      </div>
      {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}
      <div className="mt-3 rounded-xl bg-muted p-3 text-center">
        <p className="text-xs text-muted-foreground">{a.bidCount ? "目前最高價" : "起標價"}</p>
        <p className="text-3xl font-bold text-primary">{hkd(a.currentCents)}</p>
        <p className="text-xs text-muted-foreground">
          {a.bidCount} 次出價 · {active ? <Countdown endsAt={a.endsAt} /> : "拍賣已完結"}
        </p>
        {a.youLead && <p className="mt-1 text-sm font-bold text-emerald-700">你目前是最高出價者</p>}
      </div>
      {active && (
        <div className="mt-3">
          <p className="mb-1 text-xs text-muted-foreground">
            最少出價 {hkd(a.nextMinCents)}（每次加價最少 {hkd(a.minIncrementCents)}）
          </p>
          <div className="flex gap-2">
            <Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={`${a.nextMinCents / 100}`} className="h-12 text-lg" />
            <Button className="h-12 px-6" disabled={!cents || bid.isPending} onClick={() => cents && bid.mutate({ auctionId: a.id, amountCents: cents })}>
              出價
            </Button>
          </div>
          <Button variant="outline" className="mt-2 h-10 w-full" onClick={() => setV(String(a.nextMinCents / 100))}>
            以最低價 {hkd(a.nextMinCents)} 出價
          </Button>
        </div>
      )}
      {a.paymentMethod && <p className="mt-3 text-xs text-muted-foreground">付款方式：{a.paymentMethod}</p>}
    </Card>
  );
}

function MeTab() {
  const me = trpc.auth.me.useQuery();
  return (
    <div className="space-y-4">
      <PageTitle>我的</PageTitle>
      <Card>
        <p className="text-sm text-muted-foreground">姓名</p>
        <p className="font-bold">{me.data?.name}</p>
      </Card>
      <ChangePassword />
    </div>
  );
}
