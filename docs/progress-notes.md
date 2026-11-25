# EventFlow 重建進度筆記（內部）

專案目錄：/home/ubuntu/eventflow（Webdev project wdp_ae87529b4ab2af99d613b5af，獨立資料庫）
舊版來源（只參考，不改動）：/home/ubuntu/upload/EventFlow-ef691b0.zip，解壓於 /home/ubuntu/eventflow_src/EventFlow-ef691b0
用戶：cyrus 團隊，繁體中文（香港用語），Android 手機。要求：先預覽測試，明確同意後才發佈；不動舊站 bp.jengevents.com、DNS、GitHub。

## 已完成（後端，pnpm check 通過）
- drizzle/schema.ts、server/migrations/0001_eventflow.ts（ef_* 表，啟動時 server/ef/seed.ts 遷移+種子）
- server/ef/{pool,auth,members,seed,integration}.ts
- server/routers/{auth,memberMerchant,staff,admin,draws,auctions}.ts；server/routers.ts；server/_core/{context,trpc,index}.ts 已改寫
- 已刪除範本 oauth.ts/sdk.ts/db.ts 及範本測試
- dev server 已由 runtime/dev-commands 宣告 (pnpm dev, port 3000)

## 設計決定
- 登入 portal: staff(owner/admin/staff) / merchant / member。owner 只能 Google 登入且電郵在 ef_owner_allowlist。
- 認證：JWT(HS256, MANUS_JWT_SECRET 衍生) cookie ef_session (SameSite=None; Secure) + Bearer 備援（client localStorage "ef_token"）。
- 測試帳號（密碼 EventFlow2027，僅測試環境）：admin, staff, merchant1, merchant2, guest1, guest2；測試嘉賓 ZX0001-ZX0005（電話 90000001-90000005）；測試預購 TEST-PO-001..004。
- 會員碼 ZX+4位；QR 內容 `EFM:<qr_token>`。HK$500 = 50000 cents 一次抽獎機會。
- 抽獎：只有「下午5時 HK$1,000 利是」rules_confirmed=1；其他4項未確認，不可執行。
- Google 登入需 GOOGLE_CLIENT_ID（尚未向用戶索取 → 需 webdev.request_secrets），並在 Google Cloud 加入預覽來源。
- 整合 API：/api/integration/v1/*，需 YEEAHK_INTEGRATION_KEY，未設定回 503。

## 待做
1. 用 curl 測 API（登入、createTx、respond、重複提交）
2. 前端：App.tsx 路由、登入頁(三身份)、staff/merchant/member 介面、掃碼器、QR、彈窗輪詢、拍賣、抽獎、對帳
3. client/public/manus-routes.json、index.html lang zh-HK + 字體、index.css 主題
4. docs/yeeahk-integration.md、docs/pending-rules.md（待確認規則）
5. app.config.ts logoUrl；git commit/push origin main（checkpoint）；請用戶預覽；不發佈
