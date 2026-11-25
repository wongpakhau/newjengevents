import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { errMsg } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ef/Shell";

export type Role = "owner" | "admin" | "staff" | "merchant" | "member";

export const homeFor = (role: Role) => (role === "merchant" ? "/merchant" : role === "member" ? "/member" : "/staff");

/** 只有符合身份的使用者才可看到內容；其他身份轉回自己的介面，未登入轉回登入頁。 */
export function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const [, nav] = useLocation();
  useEffect(() => {
    if (me.isLoading) return;
    if (!me.data) nav("/");
    else if (!roles.includes(me.data.role as Role)) nav(homeFor(me.data.role as Role));
  }, [me.isLoading, me.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (me.isLoading || !me.data || !roles.includes(me.data.role as Role)) {
    return <div className="min-h-dvh grid place-items-center text-muted-foreground">載入中…</div>;
  }
  return <>{children}</>;
}

export function ChangePassword() {
  const [o, setO] = useState("");
  const [n, setN] = useState("");
  const utils = trpc.useUtils();
  const m = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密碼已更新");
      setO("");
      setN("");
      utils.auth.me.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Card>
      <h2 className="font-bold mb-2">修改密碼</h2>
      <div className="space-y-2">
        <Input type="password" autoComplete="current-password" placeholder="舊密碼" value={o} onChange={(e) => setO(e.target.value)} />
        <Input type="password" autoComplete="new-password" placeholder="新密碼（最少 8 個字元）" value={n} onChange={(e) => setN(e.target.value)} />
        <Button className="w-full h-11" disabled={!n || m.isPending} onClick={() => m.mutate({ oldPassword: o, newPassword: n })}>
          更新密碼
        </Button>
      </div>
    </Card>
  );
}

export function MustChangeBanner() {
  const me = trpc.auth.me.useQuery();
  if (!me.data?.mustChangePassword) return null;
  return (
    <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      你的密碼由管理員重設，請盡快在「我的／更多」頁修改密碼。
    </div>
  );
}
