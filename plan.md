# EventFlow 重建計劃（獨立測試環境）

## 1. 目標與範圍

為「正向春茗活動」（2027-01-31，香港時間）建立手機優先的活動管理系統，繁體中文（香港用語）。此版本在全新的 Manus Webdev 專案及獨立資料庫運行，不連接、不覆蓋舊站 bp.jengevents.com、現有資料庫、GitHub 或網域；未經用戶明確同意不發佈。

核心範圍：
- 三種登入身份：大會管理員／工作人員、商家、用戶／嘉賓；Google 及帳號密碼登入。
- 五個指定 Google 帳戶列為系統擁有人，必須完成 Google 身份驗證才取得擁有人權限。
- 會員碼、個人 QR、商家掃碼收款、買家手機確認、跨商戶 HK$500 累計抽獎機會。
- 預購單取貨、嘉賓名單／簽到／座位分區、抽獎、拍賣、對帳。
- 預留 yeeahk.com 商城會員及預購 API 接口與文件（暫不實際串接）。
- 兩部手機可驗收：商家手機掃碼收款，會員手機確認及查看預購單。

未確定規則（抽獎資格、終極大獎截止、拍賣細節等）以「待確認」標示，不當作定案。

## 2. 技術與架構

- 前端：React 19 + Vite + Tailwind CSS 4 + wouter + tRPC React Query；手機優先版面，底部導航。
- 後端：Express + tRPC + Drizzle ORM + MySQL（Manus 托管資料庫）。
- 認證：自建 session（JWT + HttpOnly cookie，另提供 Bearer token 供跨站 iframe 使用）；密碼以 scrypt 雜湊；Google Identity Services ID token 驗證（jose + Google JWKS）。
- QR：`qrcode` 產生會員 QR；`@zxing/browser` 掃描。
- 即時確認：買家端每 2 秒輪詢待確認交易，商家端輪詢交易狀態；不依賴 WebSocket。
- 資料一致性：交易確認、會員累計消費、抽獎券發放使用 MySQL 交易及 `SELECT ... FOR UPDATE` 行鎖；商家提交以 `requestId` 唯一鍵防重複入帳。
- 啟動時執行 idempotent migration（`ef_schema_migrations` 記錄），再寫入預設活動、測試帳號及測試資料；不覆寫既有資料。

## 3. 資料模型（主要資料表）

- `ef_events`：活動名稱、日期、時間（可空）、地點（可空）、時區。
- `ef_users`：登入帳號、角色（owner/admin/staff/merchant/member）、密碼雜湊、Google sub、啟用狀態、session version、商家連結。
- `ef_owner_allowlist`：五個擁有人電郵、Google 驗證狀態。
- `ef_members`：會員碼、姓名、電話、QR token、累計確認消費、已獲抽獎機會。
- `ef_guests`：嘉賓會員連結、分區、座位、報名狀態、簽到時間。
- `ef_merchants`：商家名稱、檔位。
- `ef_transactions`：商家、會員、金額、狀態（pending/confirmed/rejected）、requestId、確認時間。
- `ef_draw_tickets`：抽獎券（會員、序號、狀態、來源交易）。
- `ef_preorders`：預購單（商家、會員、訂單號、項目、金額、取貨狀態）。
- `ef_draws` / `ef_draw_winners`：抽獎定義、資格規則、獎品數、已抽出數量、中獎記錄。
- `ef_auctions` / `ef_bids`：拍賣品、起標價、最少加價、時限、付款方式、出價記錄。
- `ef_audit_log`：帳號、交易、抽獎、拍賣、簽到等敏感操作記錄。
- `ef_settings`：測試 API key、系統設定。

## 4. 權限與登入

- 角色：owner（系統擁有人）、admin（大會管理員）、staff（工作人員）、merchant（商家）、member（用戶／嘉賓）。
- owner 只可透過 Google 驗證的 allowlist 電郵取得；密碼登入不可取得 owner 權限。
- admin 可建立／重設／停用 admin、staff、merchant、member 帳號；owner 可管理 allowlist。
- 嘉賓自助登入：選名 + 電話核對，不公開其他嘉賓電話；排序按姓名或電話（伺服器端排序，畫面顯示遮罩電話）。
- 所有 tRPC 程序按角色授權；商家只能讀寫自己的交易及預購單。

## 5. 核心流程

1. 商家登入 → 掃會員 QR 或輸入會員碼 → 看到會員資料及該商家未取貨預購單。
2. 商家輸入金額 → 建立 pending 交易（requestId 防重）→ 買家手機彈出確認。
3. 買家確認 → 行鎖更新交易、會員累計消費、發放抽獎券；拒絕則不計入營業額。
4. 每滿 HK$500 獲 1 次抽獎機會，餘額保留；跨商戶累計。
5. 工作人員掃碼／搜尋嘉賓簽到；嘉賓查詢自己的簽到、分區、座位。
6. 管理員建立抽獎及拍賣；未確認規則的抽獎不可執行。
7. 商家及大會查看已確認營業額及交易；明確標示「系統記錄消費不等於已透過平台收款」。

## 6. 設計方向

- 設計運動：現代粵式春茗請柬（Modern Cantonese Banquet Invitation）。
- 核心原則：手機單手操作、清晰層級、喜慶但不俗氣、每個畫面只有一個主要動作。
- 色彩：暖米紙色 #FAF6EE、硃紅 #A8322A、鎏金 #C8A24A、墨色 #2B2118；成功墨綠、警示琥珀。
- 版面：最大寬度 480px 的單欄卡片；底部固定導航；重要數字用大字；表單以底部彈層呈現。
- 視覺簽名：硃紅印章式標誌、金色細線分隔、票券式抽獎卡、嘉賓 QR 卡。
- 字體：標題 Noto Serif TC（宋體感），正文 Noto Sans TC；數字用 tabular-nums。
- 動效：按鈕輕微按壓、彈層由下往上、確認成功打勾；尊重 reduced-motion。

## 7. 專案結構

```
client/src/
  pages/           登入、嘉賓自助、管理員、工作人員、商家、會員、拍賣
  components/      AppShell、底部導航、掃碼器、QR 卡、交易卡、彈層
  lib/             trpc、format、csv、qr
server/
  _core/           Express 入口、tRPC context、認證
  routers/         auth、admin、guests、merchant、member、draws、auctions、reports
  migrations/      啟動 migration SQL
  seed.ts          預設活動及測試資料
drizzle/schema.ts  資料表型別
docs/              yeeahk API 文件、待確認規則
```

## 8. 驗收與限制

- 以兩部手機在 Preview 驗收：商家掃碼／輸入會員碼、輸入金額、買家確認、查看及標記預購單。
- 不進行任何真實付款；不寄發邀請；不開放公開登記。
- 未確定的抽獎及拍賣規則集中列於「待確認規則」頁，等待用戶確認。
- Google 登入需用戶提供 Google OAuth Client ID，並在 Google Cloud Console 加入 Preview 來源；未設定前以密碼登入測試。
