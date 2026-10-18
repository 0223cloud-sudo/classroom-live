# 課堂即時互動系統 使用說明

## 三個網址

| 用途 | 網址 | 在哪裡開 |
|---|---|---|
| 老師控制台 | https://0223cloud-sudo.github.io/classroom-live/teacher.html | 老師的 iPad（建議加到主畫面） |
| 投影畫面 | https://0223cloud-sudo.github.io/classroom-live/screen.html | 教室電腦（用老師帳號登入） |
| 學生作答 | https://0223cloud-sudo.github.io/classroom-live/ | 學生掃 QR Code 自動打開 |

**iPad 加到主畫面：** Safari 打開老師控制台 → 分享按鈕（方框加箭頭）→「加入主畫面」。

## 日常操作

**課前**：控制台「課程」分頁，新增或編輯課程、上傳圖片、設定答案。
也可以請 Claude 出題，再按「匯入 JSON」貼上。

**上課**
1. 教室電腦打開投影畫面網址（會自動跟著目前的課堂）。
2. iPad「上課」分頁：選班級、選課程 →「開始上課」。
3. 大螢幕顯示 QR Code，學生掃描加入。第一次要填班級、座號、姓名。
4. 用 iPad 控制：下一頁、停止作答、公布答案、挑答案投影、隨機抽人。
5. 座位表：點一下＝選取要投影的答案；長按＝看這位同學的答案。

**iPad 鏡像投影時**：打開右上角「🛡 鏡像安全模式」，座位表會隱藏姓名與對錯；
也可以按「📺 在這台 iPad 切到投影畫面」。

**下課**：按「結束課堂」，作答資料會自動刪除。

**每學年**：學期初在「班級」分頁新增班級；學年末按「清除所有學生資料」。

## 想優化或加功能

- **內容**（課程、題目、圖片）：自己在控制台修改。
- **功能**（新題型、遊戲、版面）：
  - **在家裡電腦**：打開 Claude，到這個資料夾，說出你的想法。
  - **在學校或其他電腦**：用瀏覽器打開 https://claude.ai/code ，選 GitHub 專案 `0223cloud-sudo/classroom-live`，說出你的想法。Claude 改好後，確認沒問題再請它「合併到 main」，網站約 1 分鐘後更新。
  - 不管在哪裡，Claude 都會先讀專案裡的 `CLAUDE.md`，照同樣的規則工作（例如：你調過的題目不能動、不升級付費方案）。

## 安全與隱私

- 只有 0223cloud@gmail.com 能進老師控制台（名單在 `js/config.js` 和 `firestore.rules`）。
- 學生只能看到、寫入自己的答案；只有「作答中」才能送出。
- 只保存班級、座號、姓名；作答資料在下課時刪除。
- Firebase 是免費 Spark 方案，沒有綁信用卡，不會產生費用。
- 建議 Google 與 GitHub 帳號都開啟「兩步驟驗證」。
- 確認學校的 Google 登入可以用之後，可以把 `js/config.js` 的 `ALLOW_SEAT_LOGIN` 改成 `false`（關閉「用座號進入」）。

## 技術資訊（給 Claude 看的）

- 純前端（HTML + JS 模組），Firebase Auth + Firestore（專案 `cloud-classroom-b46d8`），GitHub Pages 託管。
- 安全規則：`firestore.rules`，修改後要貼到 Firebase 主控台 → Firestore → 規則 → 發布。
- 課程格式範例：`lessons/seasons-festivals.json`。
