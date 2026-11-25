import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { downloadCsv, errMsg } from "@/lib/format";
import { Card, PageTitle } from "@/components/ef/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GuestList } from "./GuestList";

/** 簡單 CSV 解析（支援引號）。欄位：姓名,電話,分區,座位,組別；第一行如為標題會自動略過。 */
function parseCsv(text: string) {
  const rows: string[][] = [];
  for (const line of text.replace(/^\ufeff/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === "," || c === "\t") { cells.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  if (rows.length && /姓名|name/i.test(rows[0][0] ?? "")) rows.shift();
  return rows
    .filter((r) => r[0] && r[1])
    .map((r) => ({ name: r[0], phone: r[1], zone: r[2] || undefined, seat: r[3] || undefined, groupName: r[4] || undefined }));
}

export default function GuestsTab() {
  const utils = trpc.useUtils();
  const [f, setF] = useState({ name: "", phone: "", zone: "", seat: "" });
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const create = trpc.admin.createGuest.useMutation({
    onSuccess: (r) => {
      toast.success(`已新增，會員碼 ${r.memberCode}`);
      setF({ name: "", phone: "", zone: "", seat: "" });
      utils.staff.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const imp = trpc.admin.importGuests.useMutation({
    onSuccess: (r) => {
      toast.success(`已匯入 ${r.created} 位${r.skipped.length ? `，略過 ${r.skipped.length} 位重複` : ""}`);
      setText("");
      utils.staff.invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const rows = parseCsv(text);
  return (
    <div className="space-y-4">
      <PageTitle hint="管理嘉賓名單、會員碼、分區及座位。">嘉賓管理</PageTitle>
      <Card className="space-y-2">
        <h2 className="font-bold">新增嘉賓</h2>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="姓名" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="h-11" />
          <Input placeholder="電話" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="h-11" />
          <Input placeholder="分區（可留空）" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} className="h-11" />
          <Input placeholder="座位（可留空）" value={f.seat} onChange={(e) => setF({ ...f, seat: e.target.value })} className="h-11" />
        </div>
        <Button className="h-11 w-full" disabled={!f.name.trim() || f.phone.replace(/\D/g, "").length < 6 || create.isPending} onClick={() => create.mutate(f)}>
          新增並自動產生會員碼
        </Button>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-bold">批量匯入（CSV／貼上）</h2>
        <p className="text-xs text-muted-foreground">欄位次序：姓名、電話、分區、座位、組別（分區、座位、組別可留空）。電話相同且姓名相同者會自動略過。</p>
        <input
          ref={file}
          type="file"
          accept=".csv,.txt,text/csv"
          className="hidden"
          onChange={async (e) => {
            const t = await e.target.files?.[0]?.text();
            if (t) setText(t);
            e.target.value = "";
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={() => file.current?.click()}>
            <Upload size={16} className="mr-1.5" /> 選擇檔案
          </Button>
          <Button variant="outline" className="h-11" onClick={() => downloadCsv("嘉賓匯入範本.csv", [["姓名", "電話", "分區", "座位", "組別"], ["陳大文", "91234567", "A", "A01", ""]])}>
            <Download size={16} className="mr-1.5" /> 下載範本
          </Button>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={"陳大文,91234567,A,A01\n李小明,98765432"} className="w-full rounded-lg border bg-background p-2 text-sm" />
        <Button className="h-11 w-full" disabled={!rows.length || imp.isPending} onClick={() => imp.mutate({ rows })}>
          匯入 {rows.length} 位
        </Button>
      </Card>
      <h2 className="pt-2 font-serif text-lg font-bold">嘉賓名單</h2>
      <GuestList mode="admin" />
    </div>
  );
}
