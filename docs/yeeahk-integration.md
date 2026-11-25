# www.yeeahk.com 商城整合接口（預留，未串接）

> 狀態：**預留**。目前未與商城實際連接。未設定環境變數 `YEEAHK_INTEGRATION_KEY` 時，所有資料接口一律回覆 `503 integration_disabled`。

## 1. 用途

日後商城可透過以下接口：

1. 以會員碼查詢 EventFlow 會員（核對身份，不回傳電話）。
2. 查詢會員的預購單及取貨狀態。
3. 把商城的預購單推送到 EventFlow，讓商家在活動當日掃買家會員碼時，看到該買家在該商家的「未取貨預購單」並標記已取貨。

## 2. 啟用方法（日後）

1. 由大會產生一組長而隨機的 API 金鑰（建議 32 字元以上）。
2. 在 Manus 專案的密鑰設定中加入 `YEEAHK_INTEGRATION_KEY`（不要寫入程式碼或傳送於聊天）。
3. 把同一金鑰以安全方式交給商城開發者，由商城伺服器端（不可放在瀏覽器）呼叫。
4. 雙方在測試環境驗證後，才於正式環境啟用。

## 3. 認證

所有資料接口須在 HTTP header 帶上：

```
x-api-key: <YEEAHK_INTEGRATION_KEY>
```

金鑰錯誤回覆 `401 invalid_api_key`；未啟用回覆 `503 integration_disabled`。

## 4. 接口

基礎路徑：`/api/integration/v1`

### 4.1 健康檢查（毋須金鑰）

`GET /api/integration/v1/health`

```json
{ "status": "reserved", "enabled": false, "version": "v1" }
```

### 4.2 查詢會員

`GET /api/integration/v1/members/{memberCode}`

回覆 200：

```json
{ "memberCode": "ZX0001", "name": "陳大文", "email": null, "active": true }
```

找不到：`404 member_not_found`。基於私隱，此接口不回傳電話號碼。

### 4.3 查詢會員預購單

`GET /api/integration/v1/members/{memberCode}/preorders`

```json
{
  "preorders": [
    { "orderNo": "YH-10001", "merchant": "測試商家甲", "items": "春茗禮盒 x1", "amountCents": 38800, "status": "pending" }
  ]
}
```

`status`：`pending`（未取貨）、`collected`（已取貨）、`cancelled`（已取消）。

### 4.4 推送預購單（冪等）

`POST /api/integration/v1/preorders`，`Content-Type: application/json`

```json
{
  "orderNo": "YH-10001",
  "memberCode": "ZX0001",
  "merchantId": 1,
  "items": "春茗禮盒 x1；茶葉 x2",
  "amountCents": 38800
}
```

- `orderNo`：商城訂單編號，全系統唯一；**重複推送同一 `orderNo` 只會更新內容，不會重複建立**。
- `merchantId`：EventFlow 商家編號（由大會提供對照表）。
- `amountCents`：金額以「仙」為單位的整數（HK$388 = 38800）。

回覆 `201 { "orderNo": "YH-10001", "status": "accepted" }`；欄位不全 `400 invalid_payload`；會員或商家不存在 `404 member_or_merchant_not_found`。

## 5. 重要說明

- 預購單金額只作記錄及取貨核對，**不會**自動計入營業額或抽獎機會；現場消費仍須商家提交、買家在手機確認後才入帳。
- EventFlow 記錄的消費不等於已透過平台收款；收款及結算由大會、商家及商城另行處理。
- 待確認事項：商家編號對照、商城會員與 EventFlow 會員碼如何對應（例如以電郵或電話配對）、取消／退款如何同步、是否需要 webhook 回傳取貨狀態。
