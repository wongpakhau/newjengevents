import { MIGRATION_0001_EVENTFLOW } from "../migrations/0001_eventflow";
import { exec, q, q1 } from "./pool";
import { hashPassword } from "./auth";
import { createMemberWithGuest } from "./members";

export const OWNER_EMAILS = [
  "pakhauwong@gmail.com",
  "mikilee1028@gmail.com",
  "yeeayeeahk@gmail.com",
  "garyyang020730@gmail.com",
  "cj93128@gmail.com",
];

/** 僅供獨立測試環境使用；發佈前須刪除或重設。 */
export const TEST_PASSWORD = "EventFlow2027";

export async function migrate() {
  await exec(
    "CREATE TABLE IF NOT EXISTS ef_schema_migrations (name VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  );
  const done = await q1("SELECT name FROM ef_schema_migrations WHERE name = ?", ["0001_eventflow"]);
  if (!done) {
    for (const stmt of MIGRATION_0001_EVENTFLOW.split(/;\s*\n/)) {
      const s = stmt.trim();
      if (s) await exec(s);
    }
    await exec("INSERT INTO ef_schema_migrations (name) VALUES (?)", ["0001_eventflow"]);
    console.log("[migrate] applied 0001_eventflow");
  }
}

async function mkUser(u: { username: string; name: string; role: string; merchantId?: number; memberId?: number }) {
  const hash = await hashPassword(TEST_PASSWORD);
  const r = await exec(
    "INSERT INTO ef_users (username, name, role, password_hash, merchant_id, member_id) VALUES (?,?,?,?,?,?)",
    [u.username, u.name, u.role, hash, u.merchantId ?? null, u.memberId ?? null]
  );
  return r.insertId;
}

export async function seed() {
  // 擁有人名單每次啟動都核對（只新增，不覆寫驗證狀態）
  for (const email of OWNER_EMAILS) {
    await exec("INSERT IGNORE INTO ef_owner_allowlist (email, label) VALUES (?,?)", [email, "系統擁有人"]);
  }
  const marker = await q1("SELECT value FROM ef_settings WHERE `key` = 'seed_v1'");
  if (marker) return;

  // 活動：只填已確認資料，時間與地點留空
  await exec("INSERT INTO ef_events (name, event_date, start_time, venue, timezone, status) VALUES (?,?,?,?,?,?)", [
    "正向春茗活動",
    "2027-01-31",
    null,
    null,
    "Asia/Hong_Kong",
    "active",
  ]);

  // 測試帳號
  await mkUser({ username: "admin", name: "大會管理員（測試）", role: "admin" });
  await mkUser({ username: "staff", name: "工作人員（測試）", role: "staff" });
  const m1 = (await exec("INSERT INTO ef_merchants (name, booth, contact_name) VALUES (?,?,?)", ["測試商家甲", "A01", "甲先生"])).insertId;
  const m2 = (await exec("INSERT INTO ef_merchants (name, booth, contact_name) VALUES (?,?,?)", ["測試商家乙", "A02", "乙小姐"])).insertId;
  await mkUser({ username: "merchant1", name: "測試商家甲", role: "merchant", merchantId: m1 });
  await mkUser({ username: "merchant2", name: "測試商家乙", role: "merchant", merchantId: m2 });

  // 測試嘉賓（虛構姓名及電話，分組「測試」，驗收後可刪除）
  const people = [
    ["測試嘉賓一", "90000001", "A 區", "A-01-1"],
    ["測試嘉賓二", "90000002", "A 區", "A-01-2"],
    ["測試嘉賓三", "90000003", "B 區", "B-02-1"],
    ["測試嘉賓四", "90000004", "B 區", null],
    ["測試嘉賓五", "90000005", null, null],
  ] as const;
  const ids: number[] = [];
  for (const [name, phone, zone, seat] of people) {
    const m = await createMemberWithGuest({ name, phone, zone, seat, groupName: "測試", note: "測試資料" });
    ids.push(m.memberId);
  }
  await mkUser({ username: "guest1", name: "測試嘉賓一", role: "member", memberId: ids[0] });
  await mkUser({ username: "guest2", name: "測試嘉賓二", role: "member", memberId: ids[1] });

  // 測試預購單
  const po = async (no: string, mer: number, mem: number, items: string, amt: number) =>
    exec("INSERT INTO ef_preorders (order_no, merchant_id, member_id, items, amount_cents) VALUES (?,?,?,?,?)", [no, mer, mem, items, amt]);
  await po("TEST-PO-001", m1, ids[0], "春茗禮盒 x1；茶葉 x2", 38800);
  await po("TEST-PO-002", m1, ids[0], "手工曲奇 x3", 24000);
  await po("TEST-PO-003", m1, ids[1], "春茗禮盒 x2", 77600);
  await po("TEST-PO-004", m2, ids[0], "乾果拼盤 x1", 16800);

  // 抽獎項目：只有用戶已明確定義的 5 時利是標為「規則已確認」
  const d = (
    name: string, kind: string, prize: string, count: number, at: string | null, elig: string, confirmed: number, note: string, shortlist = 20
  ) =>
    exec(
      "INSERT INTO ef_draws (name, kind, prize_description, prize_count, scheduled_at, eligibility, rules_confirmed, rules_note, shortlist_size, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [name, kind, prize, count, at, elig, confirmed, note, shortlist, confirmed ? "ready" : "draft"]
    );
  await d("下午 5 時 HK$1,000 利是", "cash", "HK$1,000 利是", 1, "2027-01-31 09:00:00", "checked_in", 1,
    "當刻已簽到的人均可等權參加，不受消費或過往中獎影響。");
  await d("全體報名者禮物抽獎", "gift", "禮物（內容及份數待確認）", 1, null, "all_registered", 0,
    "所有報名者可參加；禮物內容、份數及抽獎時間待大會確認。");
  await d("下午 6 時 HK$500 利是", "cash", "HK$500 利是", 1, "2027-01-31 10:00:00", "checked_in", 0,
    "詳細資格待大會確認；暫以「已簽到」作預設，確認前不可執行。");
  await d("市集消費者現金／禮物抽獎", "consumer", "現金／禮物（待確認）", 1, null, "tickets", 0,
    "任何消費者均可參加（包括未預先報名者）；每張抽獎券是否各算一個機會、獎品及份數待確認。");
  await d("終極大獎", "grand", "終極大獎（待確認）", 1, null, "top_spenders", 0,
    "由消費最多約 20 人入圍再抽獎；截止時間及實際人數待確認。", 20);

  await exec("INSERT INTO ef_settings (`key`, value) VALUES ('seed_v1', ?)", [new Date().toISOString()]);
  console.log("[seed] done");
}

export async function bootstrapDatabase() {
  await migrate();
  await seed();
  const n = await q("SELECT COUNT(*) AS c FROM ef_users");
  console.log("[db] ready, users:", n[0]?.c);
}
