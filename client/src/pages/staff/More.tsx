import { useState } from "react";
import { toast } from "sonner";
import { ChevronRight, ArrowLeft, ShieldCheck, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { errMsg, hkTime, hkd, parseCents } from "@/lib/format";
import { ChangePassword } from "@/lib/auth";
import { Card, Empty, PageTitle, StatusBadge } from "@/components/ef/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ELIG } from "./Draws";

type Sub = "accounts" | "merchants" | "preorders" | "event" | "rules" | "owners" | "audit" | "password" | "test";
const ITEMS: { k: Sub; t: string; d: string; admin?: boolean }[] = [
  { k: "rules", t: "待確認規則", d: "抽獎及拍賣中尚未由你確認的規則", admin: true },
  { k: "accounts", t: "帳號管理", d: "建立、重設密碼、停用帳號", admin: true },
  { k: "merchants", t: "商家管理", d: "新增商家及停用", admin: true },
  { k: "preorders", t: "預購單", d: "查看及新增預購單", admin: true },
  { k: "event", t: "活動資料", d: "時間及地點（未確定可留空）", admin: true },
  { k: "owners", t: "系統擁有人", d: "Google 身份驗證狀態", admin: true },
  { k: "audit", t: "操作記錄", d: "最近 100 項重要操作", admin: true },
  { k: "test", t: "測試工具", d: "一鍵清除測試嘉賓的消費、簽到及抽獎紀錄", admin: true },
  { k: "password", t: "修改密碼", d: "更新自己的登入密碼" },
];

export default function MoreTab({ isAdmin }: { isAdmin: boolean }) {
  const [sub, setSub] = useState<Sub | null>(null);
  const items = ITEMS.filter((i) => isAdmin || !i.admin);
  if (!sub) {
    return (
      <div className="space-y-3">
        <PageTitle>更多功能</PageTitle>
        {items.map((i) => (
          <button key={i.k} onClick={() => setSub(i.k)} className="ticket-card flex w-full items-center justify-between p-4 text-left active:bg-muted">
            <span>
              <span className="block font-bold">{i.t}</span>
              <span className="block text-sm text-muted-foreground">{i.d}</span>
            </span>
            <ChevronRight className="text-muted-foreground" />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <button onClick={() => setSub(null)} className="flex items-center gap-1 py-1 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> 返回
      </button>
      {sub === "password" && <ChangePassword />}
      {sub === "rules" && <PendingRules />}
      {sub === "accounts" && <Accounts />}
      {sub === "merchants" && <Merchants />}
      {sub === "preorders" && <Preorders />}
      {sub === "event" && <EventInfo />}
      {sub === "owners" && <Owners />}
      {sub === "audit" && <Audit />}
      {sub === "test" && <TestTools />}
    </div>
  );
}

/* ------------------------------ 待確認規則 ------------------------------ */
const OPEN_ITEMS = [
  ["下午 6 時 HK$500 利是", "詳細參加資格（如：全部已簽到者、只限未中獎者、需有消費等）"],
  ["市集消費者現金／禮物抽獎", "現金或禮物的名額、內容；是否需最低消費；是否每人只可中一次"],
  ["終極大獎", "入圍人數（暫定約 20 人）、消費計算的截止時間、同分如何處理"],
  ["所有報名者禮物抽獎", "禮物內容、名額、抽獎時間"],
  ["拍賣", "各拍賣品的起標價、最少加價、時限、付款方式、得標後的付款及交收安排、延時規則"],
  ["利是及獎品領取", "得獎者如何核實及領取、逾時未領取如何處理"],
];
function PendingRules() {
  const draws = trpc.draws.list.useQuery();
  const auctions = trpc.auctions.adminList.useQuery();
  const dOpen = draws.data?.filter((d) => !d.rulesConfirmed && d.status !== "cancelled") ?? [];
  const aOpen = auctions.data?.filter((a) => !a.rulesConfirmed && (a.status === "draft")) ?? [];
  return (
    <div className="space-y-4">
      <PageTitle hint="以下規則尚未定案，系統不會自行當作定案；未確認的抽獎及拍賣無法執行。">待確認規則</PageTitle>
      <Card>
        <h2 className="mb-2 font-bold">需要你決定的事項</h2>
        <ul className="space-y-2.5">
          {OPEN_ITEMS.map(([t, d]) => (
            <li key={t} className="flex gap-2">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                <b>{t}</b>
                <span className="block text-sm text-muted-foreground">{d}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">系統內抽獎項目狀態</h2>
        {draws.data?.map((d) => (
          <div key={d.id} className="flex items-start gap-2 py-1.5 text-sm">
            {d.rulesConfirmed ? <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" />}
            <span>
              <b>{d.name}</b>：{d.rulesConfirmed ? "規則已確認" : "規則待確認"}
              <span className="block text-xs text-muted-foreground">目前草稿資格：{ELIG[d.eligibility]}（{d.prizeDescription} × {d.prizeCount}）</span>
            </span>
          </div>
        ))}
        {dOpen.length === 0 && <p className="text-sm text-emerald-700">所有抽獎項目規則均已確認。</p>}
        {aOpen.length > 0 && <p className="mt-2 text-sm text-muted-foreground">另有 {aOpen.length} 項拍賣的規則待確認。</p>}
      </Card>
    </div>
  );
}

/* ------------------------------ 帳號 ------------------------------ */
const ROLE: Record<string, string> = { owner: "系統擁有人", admin: "管理員", staff: "工作人員", merchant: "商家", member: "用戶／嘉賓" };
function Accounts() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const list = trpc.admin.accounts.useQuery();
  const merchants = trpc.admin.merchants.useQuery();
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ role: "staff" as "admin" | "staff" | "merchant" | "member", username: "", name: "", password: "", merchantId: "", memberCode: "" });
  const inv = () => utils.admin.accounts.invalidate();
  const create = trpc.admin.createAccount.useMutation({
    onSuccess: () => {
      toast.success("帳號已建立");
      setF({ ...f, username: "", name: "", password: "", memberCode: "" });
      setShow(false);
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const reset = trpc.admin.resetPassword.useMutation({ onSuccess: () => toast.success("密碼已重設，對方須重新登入"), onError: (e) => toast.error(errMsg(e)) });
  const active = trpc.admin.setActive.useMutation({ onSuccess: inv, onError: (e) => toast.error(errMsg(e)) });
  const sel = "h-11 w-full rounded-md border bg-background px-3";
  return (
    <div className="space-y-4">
      <PageTitle>帳號管理</PageTitle>
      {!show ? (
        <Button className="h-11 w-full" onClick={() => setShow(true)}>建立帳號</Button>
      ) : (
        <Card className="space-y-2 pop-in">
          <select className={sel} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as any })}>
            <option value="staff">工作人員</option>
            <option value="admin">管理員</option>
            <option value="merchant">商家</option>
            <option value="member">用戶／嘉賓（連結會員碼）</option>
          </select>
          <Input placeholder="帳號（英文／數字）" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" className="h-11" />
          <Input placeholder="顯示名稱" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11" />
          <Input placeholder="初始密碼（最少 8 個字元）" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="h-11" />
          {f.role === "merchant" && (
            <select className={sel} value={f.merchantId} onChange={(e) => setF({ ...f, merchantId: e.target.value })}>
              <option value="">選擇商家…</option>
              {merchants.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {f.role === "member" && <Input placeholder="會員碼，例如 ZX0001" value={f.memberCode} onChange={(e) => setF({ ...f, memberCode: e.target.value.toUpperCase() })} className="h-11" />}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" onClick={() => setShow(false)}>取消</Button>
            <Button
              className="h-11"
              disabled={create.isPending || !f.username || !f.name || f.password.length < 8}
              onClick={() => create.mutate({ role: f.role, username: f.username, name: f.name, password: f.password, merchantId: f.merchantId ? Number(f.merchantId) : undefined, memberCode: f.memberCode || undefined })}
            >
              建立
            </Button>
          </div>
        </Card>
      )}
      <Card className="p-0">
        <ul className="divide-y">
          {list.data?.map((u) => (
            <li key={u.id} className="px-3 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.name}{!u.isActive && <span className="ml-1.5 rounded bg-red-100 px-1.5 text-xs text-red-800">已停用</span>}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ROLE[u.role]} · {u.username ?? u.email}
                    {u.merchantName ? ` · ${u.merchantName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">最後登入：{u.lastLoginAt ? hkTime(u.lastLoginAt) : "—"}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {u.role !== "owner" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const p = prompt(`為「${u.name}」設定新密碼（最少 8 個字元）`);
                        if (p) reset.mutate({ id: u.id, password: p });
                      }}
                    >
                      重設密碼
                    </Button>
                  )}
                  {u.id !== me.data?.id && (
                    <Button size="sm" variant="outline" className={u.isActive ? "text-destructive" : ""} onClick={() => active.mutate({ id: u.id, active: !u.isActive })}>
                      {u.isActive ? "停用" : "啟用"}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ 商家 ------------------------------ */
function Merchants() {
  const utils = trpc.useUtils();
  const list = trpc.admin.merchants.useQuery();
  const [name, setName] = useState("");
  const [booth, setBooth] = useState("");
  const inv = () => utils.admin.merchants.invalidate();
  const create = trpc.admin.createMerchant.useMutation({
    onSuccess: () => {
      toast.success("商家已新增，請到「帳號管理」為商家建立登入帳號");
      setName("");
      setBooth("");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const set = trpc.admin.setMerchantActive.useMutation({ onSuccess: inv, onError: (e) => toast.error(errMsg(e)) });
  return (
    <div className="space-y-4">
      <PageTitle>商家管理</PageTitle>
      <Card className="space-y-2">
        <Input placeholder="商家名稱" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
        <Input placeholder="攤位（可留空）" value={booth} onChange={(e) => setBooth(e.target.value)} className="h-11" />
        <Button className="h-11 w-full" disabled={!name.trim() || create.isPending} onClick={() => create.mutate({ name, booth: booth || undefined })}>新增商家</Button>
      </Card>
      <Card className="p-0">
        <ul className="divide-y">
          {list.data?.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-3 py-3">
              <span>
                {m.name}
                {m.booth && <span className="text-xs text-muted-foreground"> · 攤位 {m.booth}</span>}
                {!m.isActive && <span className="ml-1.5 rounded bg-red-100 px-1.5 text-xs text-red-800">已停用</span>}
              </span>
              <Button size="sm" variant="outline" onClick={() => set.mutate({ id: m.id, active: !m.isActive })}>{m.isActive ? "停用" : "啟用"}</Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ 預購單 ------------------------------ */
function Preorders() {
  const utils = trpc.useUtils();
  const list = trpc.admin.preorders.useQuery();
  const merchants = trpc.admin.merchants.useQuery();
  const [f, setF] = useState({ merchantId: "", memberCode: "", items: "", amount: "", orderNo: "" });
  const inv = () => utils.admin.preorders.invalidate();
  const create = trpc.admin.createPreorder.useMutation({
    onSuccess: () => {
      toast.success("預購單已新增");
      setF({ ...f, memberCode: "", items: "", amount: "", orderNo: "" });
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const cancel = trpc.admin.cancelPreorder.useMutation({ onSuccess: inv });
  const amt = f.amount.trim() === "" || f.amount.trim() === "0" ? 0 : parseCents(f.amount);
  return (
    <div className="space-y-4">
      <PageTitle hint="日後商城（www.yeeahk.com）可經 API 寫入；現階段由管理員手動輸入。">預購單</PageTitle>
      <Card className="space-y-2">
        <select className="h-11 w-full rounded-md border bg-background px-3" value={f.merchantId} onChange={(e) => setF({ ...f, merchantId: e.target.value })}>
          <option value="">選擇商家…</option>
          {merchants.data?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <Input placeholder="會員碼" value={f.memberCode} onChange={(e) => setF({ ...f, memberCode: e.target.value.toUpperCase() })} className="h-11" />
        <Input placeholder="貨品內容" value={f.items} onChange={(e) => setF({ ...f, items: e.target.value })} className="h-11" />
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="金額（HK$）" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="h-11" />
          <Input placeholder="訂單編號（可留空）" value={f.orderNo} onChange={(e) => setF({ ...f, orderNo: e.target.value })} className="h-11" />
        </div>
        <Button
          className="h-11 w-full"
          disabled={!f.merchantId || !f.memberCode || !f.items.trim() || amt == null || create.isPending}
          onClick={() => create.mutate({ merchantId: Number(f.merchantId), memberCode: f.memberCode, items: f.items, amountCents: amt ?? 0, orderNo: f.orderNo || undefined })}
        >
          新增預購單
        </Button>
      </Card>
      <Card className="p-0">
        {!list.data?.length ? <Empty>暫無預購單</Empty> : (
          <ul className="divide-y">
            {list.data.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2 px-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{p.merchantName} → {p.memberName}（{p.memberCode}）</p>
                  <p className="text-sm">{p.items}</p>
                  <p className="text-xs text-muted-foreground">{p.orderNo} · {hkd(p.amountCents)}</p>
                </div>
                <div className="text-right shrink-0">
                  <StatusBadge s={p.status === "pending" ? "pending" : p.status} labels={{ pending: "待取貨" }} />
                  {p.status === "pending" && <button className="mt-1 block text-xs text-destructive underline" onClick={() => confirm("確定取消此預購單？") && cancel.mutate({ id: p.id })}>取消單</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------ 活動資料 ------------------------------ */
function EventInfo() {
  const ev = trpc.admin.event.useQuery();
  const utils = trpc.useUtils();
  const [t, setT] = useState<string | null>(null);
  const [v, setV] = useState<string | null>(null);
  const save = trpc.admin.updateEvent.useMutation({
    onSuccess: () => {
      toast.success("已儲存");
      utils.admin.event.invalidate();
      utils.auth.config.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  if (!ev.data) return <Empty>載入中…</Empty>;
  const time = t ?? ev.data.startTime ?? "";
  const venue = v ?? ev.data.venue ?? "";
  return (
    <div className="space-y-4">
      <PageTitle hint="尚未確定的時間及地點請保持留空。">活動資料</PageTitle>
      <Card className="space-y-2">
        <p className="font-serif text-lg font-bold">{ev.data.name}</p>
        <p className="text-sm text-muted-foreground">日期：{ev.data.date}（香港時間）</p>
        <label className="block text-sm">開始時間（可留空）<Input value={time} onChange={(e) => setT(e.target.value)} placeholder="例如 12:00" className="mt-1 h-11" /></label>
        <label className="block text-sm">地點（可留空）<Input value={venue} onChange={(e) => setV(e.target.value)} className="mt-1 h-11" /></label>
        <Button className="h-11 w-full" disabled={save.isPending} onClick={() => save.mutate({ startTime: time || null, venue: venue || null })}>儲存</Button>
      </Card>
    </div>
  );
}

/* ------------------------------ 擁有人 ------------------------------ */
function Owners() {
  const q = trpc.admin.owners.useQuery();
  return (
    <div className="space-y-4">
      <PageTitle hint="擁有人必須以該 Google 帳戶登入並通過 Google 驗證，才會取得權限；不能使用密碼。">系統擁有人</PageTitle>
      <Card className="p-0">
        <ul className="divide-y">
          {q.data?.map((o) => (
            <li key={o.email} className="flex items-center justify-between px-3 py-3 text-sm">
              <span className="min-w-0 truncate">{o.email}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${o.verifiedAt ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {o.verifiedAt ? "已驗證" : "待 Google 驗證"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function TestTools() {
  const utils = trpc.useUtils();
  const reset = trpc.admin.resetTestData.useMutation({
    onSuccess: (r) => {
      toast.success(`已重設 ${r.members} 位測試嘉賓的紀錄`);
      utils.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="space-y-4">
      <PageTitle hint="只影響備註為「測試資料」的 5 位測試嘉賓，不會動到其他嘉賓、帳號或抽獎規則。">測試工具</PageTitle>
      <Card className="space-y-2">
        <p className="text-sm">會清除：測試嘉賓的消費交易、抽獎券、得獎紀錄、出價及簽到時間；並把測試預購單（TEST-PO-…）還原為「待取貨」。</p>
        <Button variant="destructive" className="h-12 w-full" disabled={reset.isPending} onClick={() => confirm("確定重設測試資料？此動作無法還原。") && reset.mutate({ confirm: "RESET" })}>
          重設測試資料
        </Button>
        <p className="text-xs text-muted-foreground">正式啟用前，請同時停用或刪除測試帳號（admin、staff、merchant1、merchant2、guest1、guest2）及測試嘉賓。</p>
      </Card>
    </div>
  );
}

const ACTION: Record<string, string> = {
  "tx.create": "商家提交消費", "tx.confirm": "買家確認消費", "tx.reject": "買家拒絕消費",
  "preorder.collect": "標記預購已取貨", "preorder.create": "新增預購單", "preorder.cancel": "取消預購單",
  "guest.checkin": "嘉賓簽到", "guest.undo_checkin": "撤銷簽到", "guest.walkin": "新增現場嘉賓", "guest.create": "新增嘉賓",
  "guest.update": "修改嘉賓", "guest.import": "匯入嘉賓", "guest.delete": "刪除嘉賓", "guest.deactivate": "停用嘉賓",
  "account.create": "建立帳號", "account.reset_password": "重設密碼", "account.enable": "啟用帳號", "account.disable": "停用帳號",
  "user.change_password": "修改密碼", "owner.google_verified": "擁有人 Google 驗證", "event.update": "修改活動資料",
  "draw.create": "新增抽獎", "draw.update": "修改抽獎", "draw.confirm_rules": "確認抽獎規則", "draw.unconfirm_rules": "撤回抽獎規則確認",
  "draw.run": "執行抽獎", "draw.cancel": "取消抽獎",
  "auction.create": "新增拍賣品", "auction.update": "修改拍賣品", "auction.confirm_rules": "拍賣規則確認", "auction.start": "開始拍賣",
  "auction.end": "結束拍賣", "auction.cancel": "取消拍賣", "auction.bid": "拍賣出價",
  "merchant.create": "新增商家", "merchant.enable": "啟用商家", "merchant.disable": "停用商家", "test.reset": "重設測試資料",
};

function Audit() {
  const q = trpc.admin.audit.useQuery();
  return (
    <div className="space-y-4">
      <PageTitle>操作記錄</PageTitle>
      <Card className="p-0">
        <ul className="divide-y text-sm">
          {q.data?.map((a) => (
            <li key={a.id} className="px-3 py-2">
              <p><b>{a.actor}</b> · {ACTION[a.action] ?? a.action}</p>
              <p className="text-xs text-muted-foreground">{hkTime(a.createdAt)}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
