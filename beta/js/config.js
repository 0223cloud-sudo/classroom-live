// ===== 系統設定 =====
// 把 Firebase 主控台給的 firebaseConfig 貼在這裡
export const firebaseConfig = {
  apiKey: "AIzaSyAtm3d4LaJAr8nLBLZN1vFURuqVpwBb_-g",
  authDomain: "cloud-classroom-b46d8.firebaseapp.com",
  projectId: "cloud-classroom-b46d8",
  storageBucket: "cloud-classroom-b46d8.firebasestorage.app",
  messagingSenderId: "325247673831",
  appId: "1:325247673831:web:e28034b4430cce43398942",
};

// 可以進入老師控制台的 Google 帳號（要和 firestore.rules 裡的名單一致）
export const TEACHER_EMAILS = ["0223cloud@gmail.com"];

// 學校擋 Google 登入時的備用方案：學生可以只填班級座號姓名進入
export const ALLOW_SEAT_LOGIN = true;
