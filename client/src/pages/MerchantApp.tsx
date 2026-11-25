import { useEffect, useRef, useState } from "react";
import { useRoute, Redirect } from "wouter";
import { toast } from "sonner";
import { CheckCircle2, Package, ReceiptText, ScanLine, UserRound, XCircle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Guard, ChangePassword, MustChangeBanner } from "@/lib/auth";
import { errMsg, hkd, hkTime, parseCents, downloadCsv } from "@/lib/format";
import type { Out } from "@/lib/types";
import { AppShell, Card, Empty, PageTitle, Stat, StatusBadge, Tab } from "@/components/ef/Shell";
import { Scanner } from "@/components/ef/Qr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TABS: Tab[] = [
  { key: "collect", label: "掃碼收款", icon: <ScanLine size={20} /> },
  { key: "preorders", label: "預購取貨", icon: <Package size={20} /> },
  { key: "records", label: "對帳", icon: <ReceiptText size={20} /> },
  { key: "me", label: "我的", icon: <UserRound size={20} /> },
];

export default function MerchantApp() {
  const [, p] = useRoute("/merchant/:tab");
  const tab = p?.tab;
  const me = trpc.merchant.me.useQuery();
  if (!tab) return <Redirect to="/merchant/collect" />;
  return (
    <Guard roles={["merchant"]}>
      <AppShell base="/merchant" tabs={TABS} active={tab} title={me.data?.name ?? "商家"}>
        <MustChangeBanner />
        {tab === "collect" && <CollectTab />}
        {tab === "preorders" && <PreordersTab />}
        {tab === "records" && <RecordsTab />}
        {tab === "me" && (
          <div className="space-y-4">
            <PageTitle>我的</PageTitle>
            <Card>
              <p className="text-sm text-muted-foreground">商家</p>
              <p className="font-bold">{me.data?.name}</p>
              {me.data?.booth && <p className="text-sm text-muted-foreground">攤位 {me.data.booth}</p>}
            </Card>
            <ChangePassword />
          </div>
        )}
      </AppShell>
    </Guard>
  );
}

type Found = Out["merchant"]["lookup"];
const newRequestId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function CollectTab() {
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [amount, setAmount] = useState("");
  const reqId = useRef(newRequestId());
  const [txId, setTxId] = useState<number | null>(null);

  const lookup = trpc.merchant.lookup.useMutation({
    onSuccess: (r) => {
      setFound(r);
      setAmount("");
      reqId.current = newRequestId();
      navigator.vibrate?.(40);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const create = trpc.merchant.createTx.useMutation({
    onSuccess: (r) => setTxId(r.id),
    onError: (e) => toast.error(errMsg(e)),
  });
  const collect = trpc.merchant.collectPreorder.useMutation({
    onSuccess: (r, v) => {
      if (r.collected) toast.success("已標記取貨");
      setFound((f) => (f ? { ...f, preorders: f.preorders.filter((p) => p.id !== v.id) } : f));
      utils.merchant.preorders.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const reset = () => {
    setFound(null);
    setCode("");
    setAmount("");
    setTxId(null);
    reqId.current = newRequestId();
  };

  if (txId != null) return <Waiting id={txId} onDone={reset} />;

  const cents = parseCents(amount);
  if (!found) {
    return (
      <div className="space-y-4">
        <PageTitle hint="掃描買家的 QR code，或輸入會員碼。">掃碼收款登記</PageTitle>
        <Card>
          <Scanner onResult={(t) => lookup.mutate({ code: t })} />
          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> 或手動輸入 <div className="h-px flex-1 bg-border" />
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) lookup.mutate({ code: code.trim() });
            }}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="會員碼，例如 ZX0001" autoCapitalize="characters" autoCorrect="off" className="h-12 text-lg tracking-wider" />
            <Button type="submit" className="h-12 px-5" disabled={!code.trim() || lookup.isPending}>
              查詢
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="pop-in">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground">買家</p>
            <p className="font-serif text-xl font-bold">{found.name}</p>
            <p className="text-sm tracking-widest text-primary font-bold">{found.memberCode}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            換人
          </Button>
        </div>
        <div className="gold-rule my-3" />
        <label className="mb-1 block text-sm font-medium">消費金額（港元）</label>
        <Input
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            reqId.current = newRequestId();
          }}
          placeholder="0"
          className="h-14 text-2xl font-bold"
          autoFocus
        />
        <Button
          className="mt-3 h-14 w-full text-lg"
          disabled={!cents || create.isPending}
          onClick={() => cents && create.mutate({ memberId: found.memberId, amountCents: cents, requestId: reqId.current })}
        >
          {create.isPending ? "提交中…" : cents ? `提交 ${hkd(cents)} 予買家確認` : "輸入金額"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">買家確認後才會計入營業額及抽獎機會。重複按鈕不會重複入帳。</p>
      </Card>

      <Card>
        <h2 className="font-bold">此買家在本店的未取貨預購單（{found.preorders.length}）</h2>
        {found.preorders.length === 0 ? (
          <Empty>沒有未取貨的預購單</Empty>
        ) : (
          <ul className="divide-y">
            {found.preorders.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.items}</p>
                    <p className="text-xs text-muted-foreground">訂單 {p.orderNo} · {hkd(p.amountCents)}</p>
                  </div>
                  <Button size="sm" className="h-10 shrink-0" disabled={collect.isPending} onClick={() => collect.mutate({ id: p.id })}>
                    標記已取貨
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Waiting({ id, onDone }: { id: number; onDone: () => void }) {
  const utils = trpc.useUtils();
  const cancel = trpc.merchant.cancelTx.useMutation({ onSuccess: () => utils.merchant.invalidate() });
  const st = trpc.merchant.txStatus.useQuery({ id }, { refetchInterval: (q) => (q.state.data?.status === "pending" ? 2000 : false) });
  const t = st.data;
  useEffect(() => {
    if (t && t.status !== "pending") {
      navigator.vibrate?.(t.status === "confirmed" ? [80, 40, 80] : 200);
      utils.merchant.invalidate();
    }
  }, [t?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!t?.expiresAt) return;
    const i = setInterval(() => setLeft(Math.max(0, Math.floor((new Date(t.expiresAt).getTime() - Date.now()) / 1000))), 1000);
    return () => clearInterval(i);
  }, [t?.expiresAt]);

  if (!t) return <Empty>載入中…</Empty>;
  const view = {
    pending: { icon: <Loader2 className="animate-spin text-gold" size={56} />, title: "等待買家確認", sub: `請買家在手機按「確認」（${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} 後逾時）` },
    confirmed: { icon: <CheckCircle2 className="text-emerald-600" size={56} />, title: "買家已確認", sub: "此筆消費已計入營業額及買家的抽獎機會" },
    rejected: { icon: <XCircle className="text-destructive" size={56} />, title: "買家已拒絕", sub: "此筆消費不會入帳，請與買家核對金額後重新提交" },
    expired: { icon: <XCircle className="text-muted-foreground" size={56} />, title: "已逾時／已取消", sub: "此筆消費不會入帳，如需要請重新提交" },
  }[t.status];
  return (
    <div className="space-y-4">
      <Card className="text-center pop-in">
        <div className="flex justify-center">{view.icon}</div>
        <h2 className="mt-3 text-xl font-bold">{view.title}</h2>
        <p className="mt-2 font-serif text-lg">{t.memberName}（{t.memberCode}）</p>
        <p className="text-4xl font-bold text-primary">{hkd(t.amountCents)}</p>
        <p className="mt-2 text-sm text-muted-foreground">{view.sub}</p>
        {t.status === "pending" ? (
          <Button variant="outline" className="mt-4 h-12 w-full" onClick={() => cancel.mutate({ id }, { onSuccess: onDone })}>
            取消此筆
          </Button>
        ) : (
          <Button className="mt-4 h-12 w-full" onClick={onDone}>
            繼續下一位
          </Button>
        )}
      </Card>
    </div>
  );
}

function PreordersTab() {
  const [st, setSt] = useState<"pending" | "collected">("pending");
  const q = trpc.merchant.preorders.useQuery({ status: st }, { refetchInterval: 10000 });
  const utils = trpc.useUtils();
  const collect = trpc.merchant.collectPreorder.useMutation({
    onSuccess: () => {
      toast.success("已標記取貨");
      utils.merchant.preorders.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-4">
      <PageTitle hint="本店所有預購單。取貨時建議先掃買家 QR code 核對。">預購取貨</PageTitle>
      <div className="grid grid-cols-2 rounded-xl bg-muted p-1 text-sm">
        {(["pending", "collected"] as const).map((m) => (
          <button key={m} onClick={() => setSt(m)} className={`rounded-lg py-2.5 font-medium ${st === m ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>
            {m === "pending" ? "未取貨" : "已取貨"}
          </button>
        ))}
      </div>
      <Card>
        {!q.data?.length ? (
          <Empty>沒有記錄</Empty>
        ) : (
          <ul className="divide-y">
            {q.data.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{p.memberName}</p>
                  <p className="text-sm">{p.items}</p>
                  <p className="text-xs text-muted-foreground">訂單 {p.orderNo} · {hkd(p.amountCents)}</p>
                </div>
                {p.status === "pending" ? (
                  <Button size="sm" className="h-10 shrink-0" onClick={() => collect.mutate({ id: p.id })}>
                    標記已取貨
                  </Button>
                ) : (
                  <StatusBadge s="collected" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RecordsTab() {
  const sum = trpc.merchant.summary.useQuery(undefined, { refetchInterval: 8000 });
  const [f, setF] = useState<"all" | "pending" | "confirmed" | "rejected" | "expired">("all");
  const tx = trpc.merchant.transactions.useQuery({ status: f }, { refetchInterval: 8000 });
  const s = sum.data;
  return (
    <div className="space-y-4">
      <PageTitle hint="只計算買家已確認的消費。系統記錄的消費不等於已透過平台收款。">對帳資料</PageTitle>
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="已確認營業額" value={hkd(s?.confirmedCents ?? 0)} />
          <Stat label="已確認交易" value={`${s?.confirmedCount ?? 0} 筆`} />
          <Stat label="待確認" value={`${s?.pendingCount ?? 0} 筆`} />
          <Stat label="已拒絕／逾時" value={`${(s?.rejectedCount ?? 0) + (s?.expiredCount ?? 0)} 筆`} />
        </div>
      </Card>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar text-sm">
        {(["all", "confirmed", "pending", "rejected", "expired"] as const).map((k) => (
          <button key={k} onClick={() => setF(k)} className={`shrink-0 rounded-full border px-3.5 py-1.5 ${f === k ? "border-primary bg-primary text-primary-foreground" : ""}`}>
            {{ all: "全部", confirmed: "已確認", pending: "待確認", rejected: "已拒絕", expired: "已逾時" }[k]}
          </button>
        ))}
      </div>
      <Card>
        {!tx.data?.length ? (
          <Empty>沒有記錄</Empty>
        ) : (
          <ul className="divide-y">
            {tx.data.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.memberName}</p>
                  <p className="text-xs text-muted-foreground">{t.memberCode} · {hkTime(t.createdAt)}</p>
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
      <Button
        variant="outline"
        className="h-11 w-full"
        disabled={!tx.data?.length}
        onClick={() =>
          downloadCsv("商家對帳.csv", [
            ["時間", "會員", "會員碼", "金額(HKD)", "狀態"],
            ...(tx.data ?? []).map((t) => [hkTime(t.createdAt), t.memberName ?? "", t.memberCode ?? "", (t.amountCents / 100).toFixed(2), t.status]),
          ])
        }
      >
        下載目前列表（CSV）
      </Button>
    </div>
  );
}
