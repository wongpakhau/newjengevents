import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { downloadCsv, hkTime, hkd } from "@/lib/format";
import { Card, Empty, PageTitle, Stat, StatusBadge } from "@/components/ef/Shell";
import { Button } from "@/components/ui/button";

export default function ReportTab() {
  const r = trpc.admin.report.useQuery(undefined, { refetchInterval: 8000 });
  const [mid, setMid] = useState<number | undefined>();
  const [st, setSt] = useState<"all" | "confirmed" | "pending" | "rejected" | "expired">("confirmed");
  const tx = trpc.admin.transactions.useQuery({ merchantId: mid, status: st }, { refetchInterval: 8000 });
  const d = r.data;
  return (
    <div className="space-y-4">
      <PageTitle hint="只計算買家已確認的消費。系統記錄的消費不等於已透過平台收款。">對帳總覽</PageTitle>
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="已確認營業額" value={hkd(d?.confirmedCents ?? 0)} />
          <Stat label="已確認交易" value={`${d?.confirmedCount ?? 0} 筆`} />
          <Stat label="已發抽獎券" value={`${d?.ticketsIssued ?? 0} 張`} />
          <Stat label="待確認／拒絕／逾時" value={`${d?.pendingCount ?? 0} / ${d?.rejectedCount ?? 0} / ${d?.expiredCount ?? 0}`} />
        </div>
      </Card>
      <Card>
        <h2 className="mb-1 font-bold">各商家已確認營業額</h2>
        {!d?.merchants.length ? (
          <Empty>暫無商家</Empty>
        ) : (
          <ul className="divide-y">
            {d.merchants.map((m) => (
              <li key={m.id}>
                <button className={`flex w-full items-center justify-between py-3 text-left ${mid === m.id ? "text-primary" : ""}`} onClick={() => setMid(mid === m.id ? undefined : m.id)}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.confirmedCount} 筆{m.pendingCount ? ` · ${m.pendingCount} 筆待確認` : ""}
                    </span>
                  </span>
                  <span className="font-bold">{hkd(m.confirmedCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted-foreground">點選商家可篩選下方交易明細。</p>
      </Card>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar text-sm">
        {(["confirmed", "pending", "rejected", "expired", "all"] as const).map((k) => (
          <button key={k} onClick={() => setSt(k)} className={`shrink-0 rounded-full border px-3.5 py-1.5 ${st === k ? "border-primary bg-primary text-primary-foreground" : ""}`}>
            {{ all: "全部", confirmed: "已確認", pending: "待確認", rejected: "已拒絕", expired: "已逾時" }[k]}
          </button>
        ))}
      </div>
      <Card>
        {!tx.data?.length ? (
          <Empty>沒有交易</Empty>
        ) : (
          <ul className="divide-y">
            {tx.data.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.merchantName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.memberName}（{t.memberCode}）· {hkTime(t.createdAt)}
                  </p>
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
          downloadCsv("大會對帳明細.csv", [
            ["時間", "商家", "會員", "會員碼", "金額(HKD)", "狀態"],
            ...(tx.data ?? []).map((t) => [hkTime(t.createdAt), t.merchantName, t.memberName, t.memberCode, (t.amountCents / 100).toFixed(2), t.status]),
          ])
        }
      >
        下載目前明細（CSV）
      </Button>
    </div>
  );
}
