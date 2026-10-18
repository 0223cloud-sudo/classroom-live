# 課堂即時互動系統：給 Claude 的工作說明

這是一位國中老師（教國三，1～3 個班，每班最多 35 人）自己的課堂即時問答系統。老師不是工程師，**一律用繁體中文、白話回答**，少用術語。老師可能在家裡電腦、學校電腦或 Claude Code 網頁版找你，這份文件是共用的記憶。

## 老師的規則（一定要遵守）

1. **老師調過的題目一律不能動。**請你改課程時，只能「新增頁面」或「改老師指名的那一題」。動手前先說清楚會加在第幾頁、改哪裡。
2. **不要任何付費或訂閱。**Firebase 維持免費的 Spark 方案，不升級 Blaze，也不綁信用卡。看到需要付費的選項就跳過，並告訴老師。
3. 先討論、再動手。老師說「還不要做」時，只討論。
4. 改完功能要實際測試，並老實說哪些測過、哪些沒測過。

## 網址

| 用途 | 網址 |
|---|---|
| 老師控制台（老師用 iPad） | https://0223cloud-sudo.github.io/classroom-live/teacher.html |
| 投影畫面（教室電腦） | https://0223cloud-sudo.github.io/classroom-live/screen.html |
| 學生作答（掃 QR Code） | https://0223cloud-sudo.github.io/classroom-live/ |

## 架構

- 純前端：HTML ＋ JavaScript 模組，**沒有建置步驟**，不用 npm。Firebase SDK 從 gstatic CDN 載入（10.12.2）。
- **Firebase**：專案 `cloud-classroom-b46d8`。Google 登入＋匿名登入（「用座號進入」的備用方案），Firestore 位置在 asia-east1。
- **網站**：GitHub Pages，從 `main` 分支的根目錄發布。**推到 main 就會上線**，約 1 分鐘生效。瀏覽器會暫存舊檔最多 10 分鐘，請老師重新整理（電腦按 Ctrl+F5，iPad 把控制台關掉重開）。
- 老師帳號：0223cloud@gmail.com（`js/config.js` 的 `TEACHER_EMAILS`，以及 `firestore.rules` 的 `isTeacher()`，兩邊要一致）。

### 檔案

| 檔案 | 內容 |
|---|---|
| `index.html` ＋ `js/student.js` | 學生端：登入、填班級座號姓名、作答 |
| `teacher.html` ＋ `js/teacher.js` | 老師控制台：上課（座位表、投影控制、抽人）、課程編輯器、班級管理、備份 |
| `screen.html` ＋ `js/projection.js` | 投影畫面（老師 iPad 的「切到投影畫面」也用 `projection.js`） |
| `js/firebase.js` | Firebase 初始化、圖片上傳與讀取、共用小工具 |
| `js/textsize.js` | A− / A+ 字體大小，預設依視窗寬度自動放大（用 CSS zoom） |
| `css/style.css` | 全部樣式 |
| `firestore.rules` | 安全規則。**改了之後要請老師（或用老師的瀏覽器）貼到 Firebase 主控台 → Firestore → 規則 → 發布**，推上 GitHub 不會自動生效 |
| `lessons/*.json` ＋ `lessons/index.json` | 「📚 課程庫」：Claude 出的課程放這裡，老師在控制台按一下就能匯入 |

### Firestore 資料

- `classes/{id}`：班級 `{ name }`
- `lessons/{id}`：課程 `{ title, activities[], updatedAt }`，只有老師能讀寫
- `images/{id}`：圖片 `{ data: dataURL }`（免費方案不開 Storage，圖片壓縮後存在這裡）；活動裡的 `image` 欄位寫成 `"img:文件ID"` 或網址
- `profiles/{uid}`：學生 `{ classId, className, seat, name, email }`
- `sessions/{4碼代碼}`：一堂課，含目前頁面 `activity`（**拿掉答案的版本**）、`state`（answering / locked / revealed）、`reveal`（公布時才寫入答案）、`projection`（大螢幕顯示什麼）
- `sessions/{code}/members/{uid}`、`sessions/{code}/responses/{uid}_{頁碼}`：加入的學生與作答。**按「結束課堂」會全部刪除**，作答資料不長期保存。

### 題型（activity.type）

| type | 欄位 | 作答存法 |
|---|---|---|
| `slide` 投影片 | prompt, image | 無 |
| `choice` 選擇題 | options[], answer（位置或 null）, askReason, reasonLabel, explanation | `choice` |
| `multi` 複選題 | options[]（最多 10 個）, answers[], askReason, reasonLabel, explanation | `multi`（位置陣列） |
| `match` 配合題 | left[], right[]（同一行是正確配對，多出來的是干擾項）, askReason, reasonLabel, explanation | `match`（每列選的**文字**；學生看到的右欄會打亂） |
| `text` 簡答題 | prompt, explanation | `text` |

新增題型時，要一起改：編輯器（`TYPE_NAMES`、`actEditor`、`saveLesson`、新增按鈕）、`stripActivity`（不能把答案給學生）、學生端 `render`/`submit`、老師端（`isCorrect`、座位表顏色、答案列表、長條圖、公布答案）、`projection.js`（題目、統計圖、並排答案）。

## 教學設計（不要改掉這個核心）

全班先各自作答 → 老師看座位表掌握誰交了、誰會 → 挑幾份答案**匿名**並排投影 → 討論不同想法 → 老師統一公布答案。
老師的 iPad 有時會**鏡像投影**，所以「🛡 鏡像安全模式」打開時，座位表不能顯示姓名和對錯。

## 已有的保護

- 打開編輯、複製、下載備份、開始上課，都會先讀資料庫的**最新版本**。
- 編輯時如果課程被別處改了，畫面會提醒；儲存時會讓老師選「載入最新版／仍然儲存／取消」。
- 如果你要用程式直接寫入老師的課程，一定先讀最新版，只插入新頁，絕不覆蓋老師的修改。

## 發布流程

- 在家裡電腦：直接 commit 到 `main` 並 push，就會上線。
- 在 Claude Code 網頁版：改在分支上，**跟老師確認後合併到 `main`**，網站才會更新。合併後告訴老師大約 1 分鐘後重新整理。
- commit 訊息用英文，結尾加：`Co-Authored-By: Claude <noreply@anthropic.com>`

## 測試方式

- 本機：`python -m http.server 5173`，打開 http://localhost:5173/ （localhost 已在 Firebase 授權網域內）。
- 完整流程測試可以用「用座號進入」當測試學生（座號 35、姓名「測試學生」），測完要**刪掉測試課堂和測試學生資料**。
- 不要在老師的真實課程上做測試；需要時建一份「ZZ測試課程（可刪）」，測完刪除。

## 課程備份

老師的雲端硬碟：🏫勝利國中 › 系統課程，**每份課程一個資料夾**，裡面放「課程名｜系統備份.json」（含照片，可用控制台「匯入／還原」還原）、「課程名｜題目一覽」（Google 文件）、照片檔。

## 之後可能做的功能（老師提過或討論過）

討論後再答一次、作答倒數計時、在圖片上點出線索、課堂遊戲（分組競賽、RPG 闖關）、AI 出題。學生頁的大圖在 Chromebook 上可能要往下捲才看得到選項，老師會看過學生畫面後再決定要不要調整。
