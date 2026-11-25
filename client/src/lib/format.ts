export function hkd(cents: number): string {
  const v = cents / 100;
  return `HK$${v.toLocaleString("en-HK", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** 將使用者輸入（如 "1,234.5"）轉為分；無效回傳 null。 */
export function parseCents(input: string): number | null {
  const s = input.replace(/[,\s]/g, "").replace(/^HK\$/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 100);
  return n > 0 ? n : null;
}

const TZ = "Asia/Hong_Kong";

export function hkTime(d: Date | string | null | undefined, withDate = true): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: TZ,
    ...(withDate ? { month: "numeric", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** datetime-local 輸入值（視為香港時間）→ ISO 字串 */
export function hkLocalToIso(v: string): string | null {
  if (!v) return null;
  return new Date(`${v}:00+08:00`).toISOString();
}

/** ISO → datetime-local 輸入值（香港時間） */
export function isoToHkLocal(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return p.replace(" ", "T");
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // 防止試算表公式注入
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = "\ufeff" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function errMsg(e: unknown): string {
  const m = (e as any)?.message;
  return typeof m === "string" && m ? m : "發生錯誤，請再試一次";
}
