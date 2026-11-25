import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { errMsg, hkTime, hkd, parseCents } from "@/lib/format";
import type { Out } from "@/lib/types";
import { Card, Empty, PageTitle } from "@/components/ef/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type A = Out["auctions"]["adminList"][number];
const ST: Record<A["status"], string> = { draft: "未開始", active: "進行中", ended: "已結束", cancelled: "已取消" };

export default function AuctionsTab() {
  const list = trpc.auctions.adminList.useQuery(undefined, { refetchInterval: 3000 });
  const [edit, setEdit] = useState<A | "new" | null>(null);
  return (
    <div className="space-y-4">
      <PageTitle hint="起標價、最少加價、時限及付款方式可配置；規則確認後才可開始。">拍賣管理</PageTitle>
      <Button variant="outline" className="h-11 w-full" onClick={() => setEdit("new")}>
        <Plus size={16} className="mr-1.5" /> 新增拍賣品
      </Button>
      {!list.data?.length ? <Card><Empty>暫無拍賣品</Empty></Card> : list.data.map((a) => <AuctionAdminCard key={a.id} a={a} onEdit={() => setEdit(a)} />)}
      {edit && <AuctionForm a={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AuctionAdminCard({ a, onEdit }: { a: A; onEdit: () => void }) {
  const utils = trpc.useUtils();
  const inv = () => utils.auctions.adminList.invalidate();
  const opt = { onSuccess: inv, onError: (e: any) => toast.error(errMsg(e)) };
  const confirmM = trpc.auctions.confirmRules.useMutation(opt);
  const start = trpc.auctions.start.useMutation(opt);
  const end = trpc.auctions.end.useMutation(opt);
  const cancel = trpc.auctions.cancel.useMutation(opt);
  const [showBids, setShowBids] = useState(false);
  const bids = trpc.auctions.bids.useQuery({ id: a.id }, { enabled: showBids, refetchInterval: showBids ? 3000 : false });
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-serif text-lg font-bold">{a.title}</h2>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold">{ST[a.status]}</span>
      </div>
      {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <span>起標價：{hkd(a.startingPriceCents)}</span>
        <span>最少加價：{hkd(a.minIncrementCents)}</span>
        <span>時限：{a.durationMinutes ? `${a.durationMinutes} 分鐘` : "手動結束"}</span>
        <span>付款：{a.paymentMethod ?? "待定"}</span>
      </div>
      <div className="mt-3 rounded-xl bg-muted p-3">
        <p className="text-xs text-muted-foreground">{a.bidCount ? "目前最高價" : "起標價"}（{a.bidCount} 次出價）</p>
        <p className="text-2xl font-bold text-primary">{hkd(a.currentCents)}</p>
        {a.leader && <p className="text-sm">最高出價者：{a.leader.name}</p>}
        {a.endsAt && <p className="text-xs text-muted-foreground">{a.status === "active" ? "預定結束" : "結束時間"}：{hkTime(a.endsAt)}</p>}
      </div>
      {a.rulesNote && <p className="mt-2 rounded-lg bg-muted p-2 text-xs text-muted-foreground whitespace-pre-line">{a.rulesNote}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {a.status === "draft" && (
          <>
            <Button className="col-span-2 h-12" disabled={!a.rulesConfirmed || start.isPending} onClick={() => confirm(`確定開始拍賣「${a.title}」？`) && start.mutate({ id: a.id })}>
              {a.rulesConfirmed ? "開始拍賣" : "規則未確認，不可開始"}
            </Button>
            <Button variant="outline" className="h-10" onClick={onEdit}>修改設定</Button>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => (a.rulesConfirmed ? confirmM.mutate({ id: a.id, confirmed: false }) : confirm("確定拍賣規則已由大會確認？") && confirmM.mutate({ id: a.id, confirmed: true }))}
            >
              {a.rulesConfirmed ? "撤回確認" : "確認規則"}
            </Button>
          </>
        )}
        {a.status === "active" && (
          <Button className="col-span-2 h-12" variant="destructive" onClick={() => confirm("確定立即結束拍賣？") && end.mutate({ id: a.id })}>
            結束拍賣
          </Button>
        )}
        <Button variant="outline" className="h-10" onClick={() => setShowBids(!showBids)}>
          {showBids ? "隱藏出價記錄" : "出價記錄"}
        </Button>
        {(a.status === "draft" || a.status === "active") && (
          <Button variant="outline" className="h-10 text-destructive" onClick={() => confirm("確定取消此拍賣？") && cancel.mutate({ id: a.id })}>
            取消拍賣
          </Button>
        )}
      </div>
      {showBids && (
        <ul className="mt-2 divide-y text-sm">
          {!bids.data?.length && <li className="py-2 text-muted-foreground">暫無出價</li>}
          {bids.data?.map((b) => (
            <li key={b.id} className="flex justify-between py-1.5">
              <span>{b.name}（{b.memberCode}）<span className="text-xs text-muted-foreground"> {hkTime(b.createdAt, false)}</span></span>
              <b>{hkd(b.amountCents)}</b>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AuctionForm({ a, onClose }: { a: A | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({
    title: a?.title ?? "",
    description: a?.description ?? "",
    start: a ? String(a.startingPriceCents / 100) : "",
    inc: a ? String(a.minIncrementCents / 100) : "100",
    duration: a?.durationMinutes ? String(a.durationMinutes) : "",
    paymentMethod: a?.paymentMethod ?? "",
    rulesNote: a?.rulesNote ?? "",
  });
  const save = trpc.auctions.save.useMutation({
    onSuccess: () => {
      toast.success("已儲存，規則需重新確認");
      utils.auctions.adminList.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const startC = f.start.trim() === "0" ? 0 : parseCents(f.start);
  const incC = parseCents(f.inc);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[92vw] sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{a ? "修改拍賣品" : "新增拍賣品"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5 text-sm">
          <label className="block">名稱<Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="block">介紹<textarea rows={2} className="w-full rounded-md border bg-background p-2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">起標價（HK$）<Input inputMode="decimal" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
            <label className="block">最少加價（HK$）<Input inputMode="decimal" value={f.inc} onChange={(e) => setF({ ...f, inc: e.target.value })} /></label>
          </div>
          <label className="block">時限（分鐘，留空即由管理員手動結束）<Input inputMode="numeric" value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value.replace(/\D/g, "") })} /></label>
          <label className="block">付款方式<Input value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} placeholder="例如：待確認" /></label>
          <label className="block">規則備註<textarea rows={3} className="w-full rounded-md border bg-background p-2" value={f.rulesNote} onChange={(e) => setF({ ...f, rulesNote: e.target.value })} /></label>
          <Button
            className="h-12 w-full"
            disabled={!f.title.trim() || startC == null || !incC || incC < 100 || save.isPending}
            onClick={() =>
              save.mutate({
                id: a?.id,
                title: f.title,
                description: f.description.trim() || null,
                startingPriceCents: startC!,
                minIncrementCents: incC!,
                durationMinutes: f.duration ? Number(f.duration) : null,
                paymentMethod: f.paymentMethod.trim() || null,
                rulesNote: f.rulesNote.trim() || null,
              })
            }
          >
            儲存
          </Button>
          <p className="text-xs text-muted-foreground">最少加價不可低於 HK$1。</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
