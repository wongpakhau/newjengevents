import { useEffect, useRef, useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck, Store, Ticket, ArrowDownAZ, Phone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { setToken } from "@/lib/session";
import { errMsg } from "@/lib/format";
import { homeFor, Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Seal } from "@/components/ef/Shell";

type Portal = "staff" | "merchant" | "member";

const PORTALS: { key: Portal; title: string; desc: string; icon: any }[] = [
  { key: "staff", title: "大會管理員／工作人員", desc: "簽到、嘉賓名單、抽獎、拍賣、對帳", icon: ShieldCheck },
  { key: "merchant", title: "商家", desc: "掃碼收款登記、預購取貨、對帳", icon: Store },
  { key: "member", title: "用戶／嘉賓", desc: "消費領抽獎券、預購單、座位、拍賣", icon: Ticket },
];

export function Landing() {
  const me = trpc.auth.me.useQuery();
  const cfg = trpc.auth.config.useQuery();
  const [, nav] = useLocation();
  useEffect(() => {
    if (me.data) nav(homeFor(me.data.role as Role));
  }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const ev = cfg.data?.event;
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-md px-5 pt-10 pb-12">
        <div className="flex flex-col items-center text-center">
          <Seal size={64} />
          <h1 className="mt-4 text-3xl font-bold text-primary">{ev?.name ?? "正向春茗活動"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ev ? (([y, m, d]) => `${y} 年 ${Number(m)} 月 ${Number(d)} 日`)(ev.date.split("-")) : "2027 年 1 月 31 日"}
            {ev?.startTime ? `　${ev.startTime}` : ""}
            {ev?.venue ? `　${ev.venue}` : ""}
          </p>
        </div>
        <div className="gold-rule my-6" />
        <p className="mb-3 text-center text-sm text-muted-foreground">請選擇你的身份登入</p>
        <div className="space-y-3">
          {PORTALS.map((p) => (
            <Link key={p.key} href={`/login/${p.key}`} className="ticket-card flex items-center gap-4 p-4 active:scale-[0.99] transition-transform">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                <p.icon size={24} />
              </span>
              <span className="min-w-0">
                <span className="block font-serif text-lg font-bold">{p.title}</span>
                <span className="block text-sm text-muted-foreground">{p.desc}</span>
              </span>
            </Link>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-muted-foreground">測試環境 · 資料僅供驗收測試</p>
      </div>
    </div>
  );
}

function useGoogle(portal: Portal, clientId: string | null | undefined, onToken: (t: string, user: any) => void) {
  const box = useRef<HTMLDivElement>(null);
  const login = trpc.auth.googleLogin.useMutation({
    onSuccess: (r) => onToken(r.token, r.user),
    onError: (e) => toast.error(errMsg(e)),
  });
  useEffect(() => {
    if (!clientId || !box.current) return;
    let dead = false;
    const init = () => {
      const g = (window as any).google?.accounts?.id;
      if (!g || dead || !box.current) return;
      g.initialize({ client_id: clientId, callback: (r: any) => login.mutate({ portal, credential: r.credential }) });
      box.current.innerHTML = "";
      g.renderButton(box.current, { theme: "outline", size: "large", width: Math.min(340, box.current.clientWidth || 340), text: "signin_with", locale: "zh_HK" });
    };
    if ((window as any).google?.accounts?.id) init();
    else {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = init;
      document.head.appendChild(s);
    }
    return () => {
      dead = true;
    };
  }, [clientId, portal]); // eslint-disable-line react-hooks/exhaustive-deps
  return box;
}

export function LoginPage() {
  const [, params] = useRoute("/login/:portal");
  const portal = (params?.portal ?? "staff") as Portal;
  const meta = PORTALS.find((p) => p.key === portal) ?? PORTALS[0];
  const [, nav] = useLocation();
  const utils = trpc.useUtils();
  const cfg = trpc.auth.config.useQuery();
  const [mode, setMode] = useState<"guest" | "pw">(portal === "member" ? "guest" : "pw");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");

  const done = (token: string, user: any) => {
    setToken(token);
    utils.auth.me.setData(undefined, user);
    utils.invalidate();
    nav(homeFor(user.role));
  };
  const pw = trpc.auth.passwordLogin.useMutation({ onSuccess: (r) => done(r.token, r.user), onError: (e) => toast.error(errMsg(e)) });
  const gbox = useGoogle(portal, cfg.data?.googleClientId, done);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-md px-5 pt-6 pb-12">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground py-2">
          <ArrowLeft size={16} /> 返回選擇身份
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-primary">
            <meta.icon size={24} />
          </span>
          <div>
            <h1 className="text-xl font-bold">{meta.title}</h1>
            <p className="text-sm text-muted-foreground">登入後只會看到獲授權的功能</p>
          </div>
        </div>

        {portal === "member" && (
          <div className="mt-5 grid grid-cols-2 rounded-xl bg-muted p-1 text-sm">
            {(["guest", "pw"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-lg py-2.5 font-medium ${mode === m ? "bg-card shadow-sm text-primary" : "text-muted-foreground"}`}>
                {m === "guest" ? "選擇姓名登入" : "帳號密碼"}
              </button>
            ))}
          </div>
        )}

        {mode === "guest" && portal === "member" ? (
          <GuestPicker onDone={done} />
        ) : (
          <form
            className="mt-5 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              pw.mutate({ portal, identity, password });
            }}
          >
            <div>
              <label className="mb-1 block text-sm font-medium">帳號或電郵</label>
              <Input value={identity} onChange={(e) => setIdentity(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" className="h-12" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">密碼</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="h-12" />
            </div>
            <Button type="submit" className="h-12 w-full text-base" disabled={!identity || !password || pw.isPending}>
              {pw.isPending ? "登入中…" : "登入"}
            </Button>
          </form>
        )}

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> 或 <div className="h-px flex-1 bg-border" />
        </div>
        {cfg.data?.googleClientId ? (
          <div ref={gbox} className="flex justify-center min-h-11" />
        ) : (
          <div className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">
            Google 登入尚未啟用（待設定 Google 用戶端 ID），現階段請使用帳號密碼。
          </div>
        )}
        {portal === "staff" && (
          <p className="mt-3 text-xs text-muted-foreground">系統擁有人只可使用已驗證的 Google 帳戶登入，不能使用密碼。</p>
        )}
      </div>
    </div>
  );
}

function GuestPicker({ onDone }: { onDone: (token: string, user: any) => void }) {
  const [sort, setSort] = useState<"name" | "phone">("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [phone, setPhone] = useState("");
  const list = trpc.auth.guestDirectory.useQuery({ sort, dir, q: search.trim() || undefined });
  const login = trpc.auth.guestLogin.useMutation({ onSuccess: (r) => onDone(r.token, r.user), onError: (e) => toast.error(errMsg(e)) });

  return (
    <div className="mt-4">
      {picked ? (
        <div className="ticket-card p-4 pop-in">
          <p className="text-sm text-muted-foreground">你選擇的姓名</p>
          <p className="font-serif text-xl font-bold">{picked.name}</p>
          <label className="mt-3 mb-1 block text-sm font-medium">請輸入報名時的電話號碼核對身份</label>
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="例如 9123 4567" className="h-12" autoFocus />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-12" onClick={() => { setPicked(null); setPhone(""); }}>
              重新選擇
            </Button>
            <Button className="h-12" disabled={phone.replace(/\D/g, "").length < 4 || login.isPending} onClick={() => login.mutate({ guestId: picked.id, phone })}>
              {login.isPending ? "核對中…" : "登入"}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋姓名" className="h-11" />
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">排序：</span>
            <button onClick={() => setSort("name")} className={`flex items-center gap-1 rounded-full border px-3 py-1.5 ${sort === "name" ? "border-primary bg-primary text-primary-foreground" : ""}`}>
              <ArrowDownAZ size={14} /> 姓名
            </button>
            <button onClick={() => setSort("phone")} className={`flex items-center gap-1 rounded-full border px-3 py-1.5 ${sort === "phone" ? "border-primary bg-primary text-primary-foreground" : ""}`}>
              <Phone size={14} /> 電話
            </button>
            <button onClick={() => setDir(dir === "asc" ? "desc" : "asc")} className="ml-auto rounded-full border px-3 py-1.5">
              {dir === "asc" ? "由小至大 ↑" : "由大至小 ↓"}
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">為保障私隱，名單不會顯示任何電話號碼。</p>
          <ul className="mt-2 divide-y rounded-xl border bg-card max-h-[52dvh] overflow-y-auto">
            {list.isLoading && <li className="p-4 text-sm text-muted-foreground">載入中…</li>}
            {list.data?.length === 0 && <li className="p-4 text-sm text-muted-foreground">找不到相符的姓名，請向工作人員查詢。</li>}
            {list.data?.map((g) => (
              <li key={g.id}>
                <button onClick={() => setPicked(g)} className="w-full px-4 py-3.5 text-left active:bg-muted">
                  {g.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
