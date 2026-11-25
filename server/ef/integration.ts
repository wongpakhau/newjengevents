import { timingSafeEqual } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { exec, q, q1 } from "./pool";

/**
 * 預留給 www.yeeahk.com 商城的會員及預購資料接口。
 * 目前未串接：未設定 YEEAHK_INTEGRATION_KEY 時所有資料接口回覆 503。
 * 文件見 docs/yeeahk-integration.md。
 */
function requireKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.YEEAHK_INTEGRATION_KEY;
  if (!expected) return res.status(503).json({ error: "integration_disabled", message: "商城整合尚未啟用" });
  const given = String(req.headers["x-api-key"] ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: "invalid_api_key" });
  next();
}

export function registerIntegrationRoutes(app: Express) {
  app.get("/api/integration/v1/health", (_req, res) =>
    res.json({ status: "reserved", enabled: !!process.env.YEEAHK_INTEGRATION_KEY, version: "v1" })
  );

  // 以會員碼查詢會員（不回傳電話）
  app.get("/api/integration/v1/members/:code", requireKey, async (req, res) => {
    const m = await q1("SELECT member_code, name, email, is_active FROM ef_members WHERE member_code = ?", [String(req.params.code).toUpperCase()]);
    if (!m) return res.status(404).json({ error: "member_not_found" });
    res.json({ memberCode: m.member_code, name: m.name, email: m.email ?? null, active: !!m.is_active });
  });

  // 查詢會員預購單
  app.get("/api/integration/v1/members/:code/preorders", requireKey, async (req, res) => {
    const rows = await q(
      `SELECT p.order_no, p.items, p.amount_cents, p.status, mer.name AS merchant_name FROM ef_preorders p
       JOIN ef_members m ON m.id = p.member_id JOIN ef_merchants mer ON mer.id = p.merchant_id WHERE m.member_code = ? ORDER BY p.id`,
      [String(req.params.code).toUpperCase()]
    );
    res.json({ preorders: rows.map((r) => ({ orderNo: r.order_no, merchant: r.merchant_name, items: r.items, amountCents: r.amount_cents, status: r.status })) });
  });

  // 商城推送預購單（以 orderNo 冪等：重複推送只更新，不重複建立）
  app.post("/api/integration/v1/preorders", requireKey, async (req, res) => {
    const b = req.body ?? {};
    const orderNo = String(b.orderNo ?? "").trim().slice(0, 64);
    const items = String(b.items ?? "").trim().slice(0, 1000);
    const amountCents = Number.isInteger(b.amountCents) ? b.amountCents : 0;
    if (!orderNo || !items || !b.memberCode || !b.merchantId) return res.status(400).json({ error: "invalid_payload" });
    const m = await q1("SELECT id FROM ef_members WHERE member_code = ?", [String(b.memberCode).toUpperCase()]);
    const mer = await q1("SELECT id FROM ef_merchants WHERE id = ?", [b.merchantId]);
    if (!m || !mer) return res.status(404).json({ error: "member_or_merchant_not_found" });
    await exec(
      `INSERT INTO ef_preorders (order_no, merchant_id, member_id, items, amount_cents) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE items = VALUES(items), amount_cents = VALUES(amount_cents)`,
      [orderNo, mer.id, m.id, items, amountCents]
    );
    res.status(201).json({ orderNo, status: "accepted" });
  });
}
