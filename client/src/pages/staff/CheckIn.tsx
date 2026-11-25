import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { errMsg, hkTime } from "@/lib/format";
import { Card, PageTitle, Stat } from "@/components/ef/Shell";
import { Scanner } from "@/components/ef/Qr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GuestList, WalkInForm, type GuestRow } from "./GuestList";

export default function CheckInTab() {
  const utils = trpc.useUtils();
  const stats = trpc.staff.stats.useQuery(undefined, { refetchInterval: 8000 });
  const [code, setCode] = useState("");
  const [hit, setHit] = useState<GuestRow | null>(null);
  const find = trpc.staff.find.useMutation({
    onSuccess: (g) => {
      setHit(g);
      navigator.vibrate?.(40);
    },
    onError: (e) => {
      setHit(null);
      toast.error(errMsg(e));
    },
  });
  const checkIn = trpc.staff.checkIn.useMutation({
    onSuccess: (r) => {
      setHit(r.guest);
      toast.success(r.alreadyCheckedIn ? `${r.guest.name} 早前已簽到` : `${r.guest.name} 簽到成功`);
      utils.staff.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-4">
      <PageTitle>簽到台</PageTitle>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="已簽到" value={stats.data?.checked ?? "—"} />
        <Stat label="未簽到" value={stats.data ? stats.data.total - stats.data.checked : "—"} />
        <Stat label="總人數" value={stats.data?.total ?? "—"} />
      </div>
      <Card>
        <Scanner onResult={(t) => find.mutate({ code: t })} />
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) find.mutate({ code: code.trim() });
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="輸入會員碼" className="h-12 tracking-wider" />
          <Button type="submit" className="h-12 px-5" disabled={!code.trim() || find.isPending}>
            查找
          </Button>
        </form>
        {hit && (
          <div className="mt-3 rounded-xl border-2 border-gold bg-accent/50 p-3 pop-in">
            <p className="font-serif text-xl font-bold">{hit.name}</p>
            <p className="text-sm text-muted-foreground">
              {hit.memberCode} · 分區 {hit.zone ?? "—"} · 座位 {hit.seat ?? "—"}
            </p>
            {hit.checkedInAt ? (
              <p className="mt-2 font-bold text-emerald-700">已於 {hkTime(hit.checkedInAt)} 簽到</p>
            ) : (
              <Button className="mt-2 h-12 w-full text-base" disabled={checkIn.isPending} onClick={() => checkIn.mutate({ guestId: hit.guestId })}>
                確認簽到
              </Button>
            )}
          </div>
        )}
      </Card>
      <WalkInForm />
      <h2 className="pt-2 font-serif text-lg font-bold">嘉賓名單</h2>
      <GuestList mode="checkin" />
    </div>
  );
}
