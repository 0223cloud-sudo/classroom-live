// Firebase 初始化與共用小工具
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, getDocs, onSnapshot, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, TEACHER_EMAILS } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where,
  getDocs, onSnapshot, serverTimestamp, writeBatch, onAuthStateChanged, signOut,
};

export function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export function signInSeat() {
  return signInAnonymously(auth);
}

export function isTeacher(user) {
  return !!user && !!user.email && TEACHER_EMAILS.includes(user.email.toLowerCase());
}

// ---- 圖片：存在 Firestore 的 images 集合（免費方案不用開 Storage）----
const imageCache = new Map();

// 活動裡的圖片欄位可以是網址，或是 "img:文件ID"
export async function resolveImage(ref) {
  if (!ref) return "";
  if (!ref.startsWith("img:")) return ref;
  const id = ref.slice(4);
  if (imageCache.has(id)) return imageCache.get(id);
  const snap = await getDoc(doc(db, "images", id));
  const url = snap.exists() ? snap.data().data : "";
  imageCache.set(id, url);
  return url;
}

// 把上傳的照片縮小成 JPEG，存進 Firestore，回傳 "img:ID"
export async function uploadImage(file) {
  const bitmap = await createImageBitmap(file);
  let maxSide = 1400, quality = 0.82, dataUrl = "";
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length < 900_000) break; // Firestore 單一文件上限約 1MB
    maxSide *= 0.8; quality -= 0.08;
  }
  const ref = await addDoc(collection(db, "images"), {
    data: dataUrl, name: file.name, createdAt: serverTimestamp(),
  });
  imageCache.set(ref.id, dataUrl);
  return "img:" + ref.id;
}

// ---- 小工具 ----
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function $(sel, root = document) { return root.querySelector(sel); }

export function studentUrl(code) {
  const base = new URL("./", location.href).href;
  return code ? `${base}?s=${code}` : base;
}

export const LETTERS = "ABCDEFGHIJ";
