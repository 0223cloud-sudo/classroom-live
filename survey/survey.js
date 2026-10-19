// 匿名調查：共用設定、Firebase 連線、統計計算
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, TEACHER_EMAILS } from "../js/config.js";

// 用另一個名字初始化，和課堂系統分開
export const app = initializeApp(firebaseConfig, "survey");
export const auth = getAuth(app);
export const db = getFirestore(app);

// 調查代號：資料存在 Firestore 的 surveys/{SURVEY_ID}
export const SURVEY_ID = "antibully";

export const GENDERS = [
  { key: "m", label: "男生" },
  { key: "f", label: "女生" },
  { key: "n", label: "不想回答" },
];

export const ITEMS = [
  "孤立同學",
  "取不喜歡的綽號",
  "弄小團體",
  "評論長相、身材",
  "同學聊得很開心，一過去大家就離開",
  "背後議論同學",
  "說黃色笑話",
  "分組時故意不跟某人一組",
  "講話時故意不理、已讀不回",
  "一直拿同學的糗事出來講",
  "模仿同學講話或動作來取笑",
  "說人「開不起玩笑」「玻璃心」",
  "在群組貼同學照片或做成梗圖",
  "沒經過同意就拍照或錄影",
  "在群組或限動上影射、嘲諷同學",
  "起鬨配對，例如「你們是不是在一起」",
  "不舒服的身體碰觸，例如拍、捏、勾肩",
]; // 存的是編號 1～17

export function isTeacher(user) {
  return !!user && !!user.email && TEACHER_EMAILS.includes(user.email.toLowerCase());
}

// 只接受格式正確的答卷，避免奇怪的資料讓統計出錯
function clean(r) {
  if (!r || !["m", "f", "n"].includes(r.g) || !Array.isArray(r.items)) return null;
  const items = [...new Set(r.items.filter((i) => Number.isInteger(i) && i >= 1 && i <= ITEMS.length))];
  return items.length ? { g: r.g, items } : null;
}

// responses：答卷陣列 → { counts: {m,f,n,all}, groups: {all,m,f: [{item,label,count,total,pct}]} }
// 每組依人數由多到少排序（同票依題號），百分比 = 勾選人數 ÷ 該組總人數
export function computeStats(responses) {
  const rows = responses.map(clean).filter(Boolean);
  const counts = { m: 0, f: 0, n: 0, all: rows.length };
  rows.forEach((r) => counts[r.g]++);
  const groups = {};
  for (const key of ["all", "m", "f"]) {
    const members = key === "all" ? rows : rows.filter((r) => r.g === key);
    const total = members.length;
    const tally = ITEMS.map(() => 0);
    members.forEach((r) => r.items.forEach((i) => tally[i - 1]++));
    groups[key] = tally
      .map((count, idx) => ({
        item: idx + 1, label: ITEMS[idx], count, total,
        pct: total ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count || a.item - b.item);
  }
  return { counts, groups };
}

// 取前五名；第五名同票的一起列出（標「並列」），沒有人勾的不列
export function topFive(list) {
  const picked = list.filter((x) => x.count > 0);
  if (picked.length <= 5) return picked;
  const cutoff = picked[4].count;
  return picked.filter((x, i) => i < 5 || x.count === cutoff);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
