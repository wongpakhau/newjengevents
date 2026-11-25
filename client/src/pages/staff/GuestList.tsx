import { useState } from "react";
import { toast } from "sonner";
import { Search, UserPlus, Check, Pencil } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { errMsg, hkTime } from "@/lib/format";
import type { Out } from "@/lib/types";
import { Card, Empty } from "@/components/ef/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type GuestRow = Out["staff"]["guests"][number];
type Sort = "name" | "phone" | "code" | "zone" | "seat" | "checkin";
const SORTS: { k: Sort; t: string }[] = [
  { k: "name", t: "姓名" },
  { k: "phone", t: "電話" },
  { k: "code", t: "會員碼" },
  { k: "zone", t: "分區" },
  { k: "checkin", t: "簽到時間" },
];

/** 嘉賓名單：可按姓名、電話等排序、搜尋、篩選。mode=admin 時可編輯及撤銷簽到。 */
export function GuestList({ mode }: { mode: "checkin" | "admin" }) {
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState<"all" | "checked" | "unchecked">("all");
  const [edit, setEdit] = useState<GuestRow | null>(null);
  const list = trpc.staff.guests.useQuery({ q: q.trim() || undefined, sort, dir, filter }, { refetchInterval: 8000 });
  const checkIn = trpc.staff.checkIn.useMutation({
    onSuccess: (r) => {
      toast.success(r.alreadyCheckedIn ? `${r.guest.name} 早前已簽到` : `${r.guest.name} 簽到成功`);
      utils.staff.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const undo = trpc.admin.undoCheckIn.useMutation({
    onSuccess: () => {
      toast("已撤銷簽到");
      utils.staff.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={18} className="absolute left-3 top-3.5 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋姓名、電話或會員碼" className="h-12 pl-10" />
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar text-sm">
        {(["all", "unchecked", "checked"] as const).map((k) => (
          <button key={k} onClick={() => setFilter(k)} className={`shrink-0 rounded-full border px-3.5 py-1.5 ${filter === k ? "border-primary bg-primary text-primary-foreground" : ""}`}>
            {{ all: "全部", unchecked: "未簽到", checked: "已簽到" }[k]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar text-sm">
        <span className="shrink-0 text-muted-foreground">排序</span>
        {SORTS.map((s) => (
          <button key={s.k} onClick={() => setSort(s.k)} className={`shrink-0 rounded-full border px-3 py-1.5 ${sort === s.k ? "border-gold bg-accent font-bold" : ""}`}>
            {s.t}
          </button>
        ))}
        <button onClick={() => setDir(dir === "asc" ? "desc" : "asc")} className="shrink-0 rounded-full border px-3 py-1.5">
          {dir === "asc" ? "↑ 升序" : "↓ 降序"}
        </button>
      </div>

      <Card className="p-0">
        {list.isLoading ? (
          <Empty>載入中…</Empty>
        ) : !list.data?.length ? (
          <Empty>找不到嘉賓</Empty>
        ) : (
          <ul className="divide-y">
            {list.data.map((g) => (
              <li key={g.guestId} className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {g.name}
                    {g.walkIn && <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">現場</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {g.phone} · {g.memberCode}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {g.zone ? `分區 ${g.zone}` : "未分區"} · {g.seat ? `座位 ${g.seat}` : "未排座位"}
                    {g.groupName ? ` · ${g.groupName}` : ""}
                  </p>
                </div>
                {g.checkedInAt ? (
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-emerald-700">已簽到</p>
                    <p className="text-xs text-muted-foreground">{hkTime(g.checkedInAt, false)}</p>
                    {mode === "admin" && (
                      <button className="mt-0.5 text-xs text-destructive underline" onClick={() => undo.mutate({ guestId: g.guestId })}>
                        撤銷
                      </button>
                    )}
                  </div>
                ) : (
                  <Button size="sm" className="h-10 shrink-0" disabled={checkIn.isPending} onClick={() => checkIn.mutate({ guestId: g.guestId })}>
                    <Check size={16} className="mr-1" /> 簽到
                  </Button>
                )}
                {mode === "admin" && (
                  <button aria-label="編輯" className="shrink-0 rounded-lg border p-2.5" onClick={() => setEdit(g)}>
                    <Pencil size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-center text-xs text-muted-foreground">共 {list.data?.length ?? 0} 位</p>
      {edit && <EditGuest g={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditGuest({ g, onClose }: { g: GuestRow; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ name: g.name, phone: g.phone, memberCode: g.memberCode, zone: g.zone ?? "", seat: g.seat ?? "", groupName: g.groupName ?? "", note: g.note ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = trpc.admin.updateGuest.useMutation({
    onSuccess: () => {
      toast.success("已儲存");
      utils.staff.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = trpc.admin.removeGuest.useMutation({
    onSuccess: (r) => {
      toast(r.deleted ? "已刪除嘉賓" : "此嘉賓已有消費或得獎紀錄，已改為停用");
      utils.staff.invalidate();
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const L = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{t}</span>
      {children}
    </label>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[92vw] sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>編輯嘉賓</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <L t="姓名"><Input value={f.name} onChange={set("name")} /></L>
          <L t="電話"><Input inputMode="tel" value={f.phone} onChange={set("phone")} /></L>
          <L t="會員碼"><Input value={f.memberCode} onChange={(e) => setF({ ...f, memberCode: e.target.value.toUpperCase() })} /></L>
          <div className="grid grid-cols-2 gap-2">
            <L t="分區"><Input value={f.zone} onChange={set("zone")} /></L>
            <L t="座位"><Input value={f.seat} onChange={set("seat")} /></L>
          </div>
          <L t="組別／備註"><Input value={f.groupName} onChange={set("groupName")} /></L>
          <Button
            className="h-12 w-full"
            disabled={save.isPending}
            onClick={() => save.mutate({ guestId: g.guestId, name: f.name, phone: f.phone, memberCode: f.memberCode, zone: f.zone || null, seat: f.seat || null, groupName: f.groupName || null, note: f.note || null })}
          >
            儲存
          </Button>
          <Button variant="outline" className="h-11 w-full text-destructive" disabled={remove.isPending} onClick={() => confirm(`確定移除「${g.name}」？有消費或得獎紀錄者只會停用。`) && remove.mutate({ guestId: g.guestId })}>
            移除嘉賓
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WalkInForm() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [ci, setCi] = useState(true);
  const add = trpc.staff.addWalkIn.useMutation({
    onSuccess: (r) => {
      toast.success(`已新增，會員碼 ${r.memberCode}`);
      setName("");
      setPhone("");
      setOpen(false);
      utils.staff.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!open)
    return (
      <Button variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>
        <UserPlus size={16} className="mr-2" /> 新增現場嘉賓／消費者
      </Button>
    );
  return (
    <Card className="space-y-2 pop-in">
      <h3 className="font-bold">新增現場嘉賓（未預先報名）</h3>
      <Input placeholder="姓名" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
      <Input placeholder="電話" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-11" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ci} onChange={(e) => setCi(e.target.checked)} className="h-4 w-4" /> 同時簽到
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={() => setOpen(false)}>取消</Button>
        <Button className="h-11" disabled={!name.trim() || phone.replace(/\D/g, "").length < 6 || add.isPending} onClick={() => add.mutate({ name, phone, checkIn: ci })}>
          新增
        </Button>
      </div>
    </Card>
  );
}
