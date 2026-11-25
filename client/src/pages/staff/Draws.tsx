import { useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { errMsg, hkTime, hkLocalToIso, isoToHkLocal } from "@/lib/format";
import type { Out } from "@/lib/types";
import { Card, Empty, PageTitle } from "@/components/ef/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Draw = Out["draws"]["list"][number];
export const ELIG: Record<Draw["eligibility"], string> = {
  all_registered: "所有已報名嘉賓",
  checked_in: "抽獎當刻已簽到者（等權）",
  consumers: "任何已確認消費者（包括未報名）",
  tickets: "按抽獎券（每 HK$500 一張）",
  top_spenders: "消費最高的入圍者",
};
const KIND: Record<Draw["kind"], string> = { gift: "禮物", cash: "現金／利是", consumer: "市集消費", grand: "終極大獎" };

export default function DrawsTab() {
  const list = trpc.draws.list.useQuery(undefined, { refetchInterval: 10000 });
  const [edit, setEdit] = useState<Draw | "new" | null>(null);
  return (
    <div className="space-y-4">
      <PageTitle hint="只有「規則已確認」的抽獎才可執行。修改規則後需重新確認。">抽獎</PageTitle>
      <Button variant="outline" className="h-11 w-full" onClick={() => setEdit("new")}>
        <Plus size={16} className="mr-1.5" /> 新增抽獎項目
      </Button>
      {!list.data?.length ? <Card><Empty>暫無抽獎項目</Empty></Card> : list.data.map((d) => <DrawCard key={d.id} d={d} onEdit={() => setEdit(d)} />)}
      {edit && <DrawForm d={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function DrawCard({ d, onEdit }: { d: Draw; onEdit: () => void }) {
  const utils = trpc.useUtils();
  const [last, setLast] = useState<{ name: string; memberCode: string; poolSize: number } | null>(null);
  const inv = () => utils.draws.list.invalidate();
  const confirmM = trpc.draws.confirmRules.useMutation({ onSuccess: inv, onError: (e) => toast.error(errMsg(e)) });
  const run = trpc.draws.run.useMutation({
    onSuccess: (r) => {
      setLast(r);
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = trpc.draws.cancel.useMutation({ onSuccess: inv, onError: (e) => toast.error(errMsg(e)) });
  const closed = d.status === "completed" || d.status === "cancelled";
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {KIND[d.kind]} · {d.scheduledAt ? hkTime(d.scheduledAt) : "時間待定"}
          </p>
          <h2 className="font-serif text-lg font-bold">{d.name}</h2>
          <p className="text-sm">{d.prizeDescription} × {d.prizeCount}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${d.rulesConfirmed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
          {d.status === "completed" ? "已完成" : d.status === "cancelled" ? "已取消" : d.rulesConfirmed ? "規則已確認" : "規則待確認"}
        </span>
      </div>
      <p className="mt-2 text-sm">
        資格：{ELIG[d.eligibility]}
        {d.eligibility === "top_spenders" ? `（前 ${d.shortlistSize} 名）` : ""}
        <span className="text-muted-foreground"> · 目前合資格 {d.eligibleCount} 人</span>
      </p>
      {d.rulesNote && <p className="mt-1 rounded-lg bg-muted p-2 text-xs text-muted-foreground whitespace-pre-line">{d.rulesNote}</p>}

      {last && (
        <div className="mt-3 rounded-xl border-2 border-gold bg-accent p-4 text-center pop-in">
          <Sparkles className="mx-auto text-primary" />
          <p className="text-xs text-muted-foreground">得獎者（從 {last.poolSize} 人中抽出）</p>
          <p className="font-serif text-2xl font-bold text-primary">{last.name}</p>
          <p className="tracking-widest">{last.memberCode}</p>
        </div>
      )}
      {d.winners.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold text-muted-foreground">得獎名單（{d.awardedCount}/{d.prizeCount}）</p>
          <ol className="mt-1 space-y-0.5 text-sm">
            {d.winners.map((w, i) => (
              <li key={w.id}>
                {i + 1}. {w.name}（{w.memberCode}）<span className="text-xs text-muted-foreground"> {hkTime(w.at, false)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {!closed && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            className="h-12 col-span-2 text-base"
            disabled={!d.rulesConfirmed || run.isPending}
            onClick={() => confirm(`確定現在抽出「${d.name}」第 ${d.awardedCount + 1} 位得獎者？`) && run.mutate({ id: d.id })}
          >
            {d.rulesConfirmed ? (run.isPending ? "抽獎中…" : "抽出得獎者") : "規則未確認，不可抽獎"}
          </Button>
          <Button variant="outline" className="h-10" onClick={onEdit}>
            修改規則
          </Button>
          <Button
            variant="outline"
            className="h-10"
            onClick={() =>
              d.rulesConfirmed
                ? confirmM.mutate({ id: d.id, confirmed: false })
                : confirm("確定此抽獎的資格及規則已由大會確認？") && confirmM.mutate({ id: d.id, confirmed: true })
            }
          >
            {d.rulesConfirmed ? "撤回確認" : "確認規則"}
          </Button>
          <button className="col-span-2 text-xs text-destructive underline" onClick={() => confirm("確定取消此抽獎項目？") && cancel.mutate({ id: d.id })}>
            取消此抽獎
          </button>
        </div>
      )}
    </Card>
  );
}

function DrawForm({ d, onClose }: { d: Draw | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({
    name: d?.name ?? "",
    kind: d?.kind ?? ("gift" as Draw["kind"]),
    prizeDescription: d?.prizeDescription ?? "",
    prizeCount: d?.prizeCount ?? 1,
    scheduledAt: isoToHkLocal(d?.scheduledAt),
    eligibility: d?.eligibility ?? ("all_registered" as Draw["eligibility"]),
    shortlistSize: d?.shortlistSize ?? 20,
    rulesNote: d?.rulesNote ?? "",
  });
  const save = trpc.draws.save.useMutation({
    onSuccess: () => {
      toast.success("已儲存，規則需重新確認");
      utils.draws.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const sel = "h-11 w-full rounded-md border bg-background px-3";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[92vw] sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{d ? "修改抽獎" : "新增抽獎"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5 text-sm">
          <label className="block">名稱<Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="block">類別
            <select className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Draw["kind"] })}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block">獎品<Input value={f.prizeDescription} onChange={(e) => setF({ ...f, prizeDescription: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">名額<Input type="number" min={1} value={f.prizeCount} onChange={(e) => setF({ ...f, prizeCount: Number(e.target.value) || 1 })} /></label>
            <label className="block">時間（香港）<Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></label>
          </div>
          <label className="block">參加資格
            <select className={sel} value={f.eligibility} onChange={(e) => setF({ ...f, eligibility: e.target.value as Draw["eligibility"] })}>
              {Object.entries(ELIG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {f.eligibility === "top_spenders" && (
            <label className="block">入圍人數<Input type="number" min={1} value={f.shortlistSize} onChange={(e) => setF({ ...f, shortlistSize: Number(e.target.value) || 20 })} /></label>
          )}
          <label className="block">規則備註
            <textarea rows={3} className="w-full rounded-md border bg-background p-2" value={f.rulesNote} onChange={(e) => setF({ ...f, rulesNote: e.target.value })} />
          </label>
          <Button
            className="h-12 w-full"
            disabled={!f.name.trim() || !f.prizeDescription.trim() || save.isPending}
            onClick={() => save.mutate({ id: d?.id, ...f, scheduledAt: hkLocalToIso(f.scheduledAt), rulesNote: f.rulesNote.trim() || null })}
          >
            儲存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
