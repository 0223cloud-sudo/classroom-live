// 老師控制台
import {
  auth, db, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where,
  getDocs, onSnapshot, serverTimestamp, writeBatch, onAuthStateChanged, signOut,
  signInGoogle, isTeacher, uploadImage, resolveImage, esc, $, LETTERS, studentUrl,
} from "./firebase.js";
import { renderScreen, qrSvg } from "./projection.js";
import { initTextSize } from "./textsize.js";

// 介面跟著視窗寬度自動放大，大螢幕不會縮在角落
initTextSize("teacher", document.getElementById("textsize-mount"), { baseWidth: 1250, min: window.innerWidth < 600 ? 1 : 1.15 });

// ---------- 共用 ----------
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2400);
}
function show(id) { ["v-loading", "v-login", "v-app"].forEach((v) => $("#" + v).classList.toggle("hidden", v !== id)); }
function loadImages(root) {
  root.querySelectorAll("img[data-img]").forEach((img) => {
    resolveImage(img.dataset.img).then((src) => { img.src = src; });
    img.onclick = () => showImage(img.src); // 點圖片看大圖
  });
}
function showImage(src) {
  if (!src) return;
  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = `<img src="${src}" alt="">`;
  box.onclick = () => box.remove();
  document.body.appendChild(box);
}
function modal(html) {
  const m = document.createElement("div");
  m.className = "modal";
  m.innerHTML = `<div class="card">${html}</div>`;
  m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  return m;
}
// 長按（約半秒）與點一下分開處理
function pressable(el, onTap, onLong) {
  let timer = null, long = false;
  el.addEventListener("pointerdown", () => {
    long = false;
    timer = setTimeout(() => { long = true; onLong(); }, 550);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener("pointerup", () => { cancel(); if (!long) onTap(); });
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}
const sortByName = (a, b) => (a.name || a.title || "").localeCompare(b.name || b.title || "", "zh-Hant");

let me = null;
let safe = localStorage.getItem("safeMode") === "1";
let classes = [];
let lessons = [];

// ---------- 登入 ----------
$("#btn-login").onclick = async () => {
  try { await signInGoogle(); }
  catch (e) { const el = $("#login-err"); el.textContent = "登入失敗：" + (e.code || e.message); el.classList.remove("hidden"); }
};
$("#btn-logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
  me = u;
  if (!u) return show("v-login");
  if (!isTeacher(u)) {
    show("v-login");
    const el = $("#login-err");
    el.textContent = `${u.email || "這個帳號"} 不是老師帳號。`;
    el.classList.remove("hidden");
    await signOut(auth);
    return;
  }
  show("v-app");
  applySafe();
  fetch("version.json", { cache: "no-store" }).then((r) => r.json())
    .then((d) => { $("#app-version").textContent = "版本 " + d.v; }).catch(() => {});
  await reloadData();
  renderLive();
});

async function reloadData() {
  const [cs, ls] = await Promise.all([getDocs(collection(db, "classes")), getDocs(collection(db, "lessons"))]);
  classes = cs.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortByName);
  lessons = ls.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
}

// ---------- 分頁 ----------
document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  ["live", "lessons", "classes"].forEach((t) => $("#tab-" + t).classList.toggle("hidden", t !== b.dataset.tab));
  if (b.dataset.tab === "lessons") renderLessonList();
  if (b.dataset.tab === "classes") renderClasses();
  if (b.dataset.tab === "live" && !live.code) renderLive();
});

// ---------- 鏡像安全模式 ----------
$("#btn-safe").onclick = () => {
  safe = !safe;
  localStorage.setItem("safeMode", safe ? "1" : "0");
  applySafe();
  if (live.code) renderLiveBody();
};
function applySafe() {
  const b = $("#btn-safe");
  b.textContent = `🛡 鏡像安全模式：${safe ? "開" : "關"}`;
  b.classList.toggle("safe-on", safe);
}

// =====================================================================
// 上課
// =====================================================================
const live = {
  code: null, session: null, lesson: null, members: [], responses: [], roster: [],
  selected: [], unsubs: [], unsubResp: null, respIndex: -1, writeTimer: null,
};

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
async function newCode() {
  for (let i = 0; i < 20; i++) {
    let c = "";
    for (let j = 0; j < 4; j++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const s = await getDoc(doc(db, "sessions", c));
    if (!s.exists()) return c;
  }
  throw new Error("無法產生課堂代碼");
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 給學生看的版本：拿掉答案；配合題的右欄打亂順序
function stripActivity(a) {
  const s = {
    type: a.type, prompt: a.prompt || "", image: a.image || "",
    options: a.type === "choice" || a.type === "multi" ? (a.options || []) : [],
    askReason: !!a.askReason, reasonLabel: a.reasonLabel || "",
  };
  if (a.type === "match") {
    s.left = a.left || [];
    s.choices = shuffle(a.right || []);
  }
  return s;
}

// 配合題：學生每一列選的文字（存文字而不是位置，換頁回來重新打亂也不會錯）
function matchPicks(r) { return r.match || []; }
// 配合題：答對幾列（課程的 right[i] 是左邊第 i 列的正確答案）
function matchScore(r) {
  const right = currentAct().right || [];
  const picks = matchPicks(r);
  return { ok: (live.session.activity.left || []).filter((_, i) => picks[i] && picks[i] === right[i]).length, total: (live.session.activity.left || []).length };
}

async function renderLive() {
  const root = $("#tab-live");
  const qs = await getDocs(query(collection(db, "sessions"), where("active", "==", true)));
  const actives = qs.docs.map((d) => d.data());
  root.innerHTML = `
    <div class="card" style="max-width:640px">
      <h2>開始上課</h2>
      ${!classes.length ? `<p class="status-bar wait">還沒有班級，請先到「班級」分頁新增。</p>` : ""}
      ${!lessons.length ? `<p class="status-bar wait">還沒有課程，請先到「課程」分頁新增。</p>` : ""}
      <label class="field"><span>班級</span><select id="st-class">${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
      <label class="field"><span>課程</span><select id="st-lesson">${lessons.map((l) => `<option value="${l.id}">${esc(l.title)}（${(l.activities || []).length} 頁）</option>`).join("")}</select></label>
      <button class="btn big" id="btn-start" ${classes.length && lessons.length ? "" : "disabled"}>開始上課</button>
    </div>
    ${actives.length ? `<div class="card" style="max-width:640px"><h2>進行中的課堂</h2>
      ${actives.map((s) => `<div class="list-item"><div class="grow"><b>${esc(s.code)}</b>　${esc(s.className)}・${esc(s.lessonTitle)}</div>
        <button class="btn sm" data-resume="${s.code}">繼續</button>
        <button class="btn danger sm" data-end="${s.code}">結束</button></div>`).join("")}
    </div>` : ""}`;
  $("#btn-start").onclick = startSession;
  root.querySelectorAll("[data-resume]").forEach((b) => b.onclick = () => enterSession(b.dataset.resume));
  root.querySelectorAll("[data-end]").forEach((b) => b.onclick = async () => {
    if (!confirm("結束這堂課並清除作答資料？")) return;
    await endSession(b.dataset.end); renderLive();
  });
}

async function startSession() {
  const cls = classes.find((c) => c.id === $("#st-class").value);
  const lessonId = $("#st-lesson").value;
  if (!cls || !lessonId) return;
  const btn = $("#btn-start");
  btn.disabled = true; btn.textContent = "準備中…";
  try {
    // 用資料庫裡的最新版本上課（課程可能剛在別的裝置改過）
    const snap = await getDoc(doc(db, "lessons", lessonId));
    if (!snap.exists()) throw new Error("找不到這個課程");
    const lesson = { id: lessonId, ...snap.data() };
    if (!(lesson.activities || []).length) throw new Error("這個課程還沒有任何頁面");
    const code = await newCode();
    const session = {
      code, active: true, createdAt: serverTimestamp(),
      classId: cls.id, className: cls.name, lessonId: lesson.id, lessonTitle: lesson.title,
      index: 0, total: lesson.activities.length, activity: stripActivity(lesson.activities[0]),
      state: "lobby", reveal: null, picked: [],
      lock: (() => { try { return localStorage.getItem("lockOnSubmit") !== "0"; } catch (e) { return true; } })(),
      projection: { mode: "join", joined: 0 },
    };
    // 不等伺服器回應，畫面先進入上課（Firestore 會在背景完成寫入）
    setDoc(doc(db, "sessions", code), session).catch((e) => toast("建立課堂失敗：" + (e.code || e.message)));
    enterSession(code, session, lesson);
  } catch (e) {
    btn.disabled = false; btn.textContent = "開始上課";
    toast("開始上課失敗：" + (e.code || e.message));
  }
}

async function enterSession(code, presetSession, presetLesson) {
  leaveSession();
  $("#tab-live").innerHTML = `<div class="card center muted">進入課堂中…</div>`;
  let session = presetSession;
  if (!session) {
    const s = await getDoc(doc(db, "sessions", code));
    if (!s.exists()) { toast("找不到課堂"); return renderLive(); }
    session = s.data();
  }
  live.code = code;
  live.session = session;
  const lessonP = presetLesson ? Promise.resolve(presetLesson)
    : getDoc(doc(db, "lessons", session.lessonId)).then((ls) => ls.exists() ? ls.data() : null);
  const rosterP = getDocs(query(collection(db, "profiles"), where("classId", "==", session.classId)));
  live.lesson = (await lessonP) || { title: session.lessonTitle, activities: [] };
  // 名單只用來顯示還沒加入的同學姓名，不必等它
  rosterP.then((r) => { live.roster = r.docs.map((d) => ({ uid: d.id, ...d.data() })); renderLiveBody(); })
    .catch(() => {});
  live.roster = [];
  live.selected = [];
  renderLiveBody();
  live.unsubs.push(onSnapshot(doc(db, "sessions", code), (d) => {
    if (!d.exists()) return;
    live.session = d.data();
    if (live.respIndex !== live.session.index) subscribeResponses();
    renderLiveBody();
    syncEmbed();
  }));
  live.unsubs.push(onSnapshot(collection(db, "sessions", code, "members"), (qs) => {
    live.members = qs.docs.map((d) => d.data());
    renderLiveBody();
    scheduleProjectionStats();
  }));
}

function subscribeResponses() {
  if (live.unsubResp) live.unsubResp();
  live.respIndex = live.session.index;
  live.responses = [];
  live.selected = [];
  live.unsubResp = onSnapshot(
    query(collection(db, "sessions", live.code, "responses"), where("index", "==", live.respIndex)),
    (qs) => {
      live.responses = qs.docs.map((d) => d.data());
      renderLiveBody();
      scheduleProjectionStats();
    });
}

function leaveSession() {
  live.unsubs.forEach((u) => u());
  live.unsubs = [];
  if (live.unsubResp) live.unsubResp();
  live.unsubResp = null;
  live.respIndex = -1;
  live.code = null; live.session = null; live.members = []; live.responses = [];
}

async function endSession(code) {
  await updateDoc(doc(db, "sessions", code), { active: false });
  // 作答資料不長期保存：結束時一併清除
  for (const sub of ["responses", "members"]) {
    const qs = await getDocs(collection(db, "sessions", code, sub));
    for (let i = 0; i < qs.docs.length; i += 400) {
      const b = writeBatch(db);
      qs.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
  }
  await deleteDoc(doc(db, "sessions", code));
}

// 目前這一頁在課程裡的完整資料（含答案）
function currentAct() { return live.lesson.activities[live.session.index] || {}; }

// 複選題：選對幾個、選錯幾個（answers 是正確選項的位置）
function multiScore(r) {
  const answers = currentAct().answers || [], sel = r.multi || [];
  return {
    hits: sel.filter((i) => answers.includes(i)).length,
    wrong: sel.filter((i) => !answers.includes(i)).length,
    total: answers.length,
  };
}
function isAnswerOpt(i) {
  const a = currentAct();
  return a.type === "multi" ? (a.answers || []).includes(i) : a.answer === i;
}
function multiHtml(r, showMissing = false) {
  const a = live.session.activity, sel = r.multi || [];
  let h = sel.map((i) => `<div><b>${LETTERS[i]}. ${esc(a.options[i])}</b>${safe ? "" : isAnswerOpt(i) ? " ✅" : " ❌"}</div>`).join("");
  if (showMissing && !safe) {
    const miss = (currentAct().answers || []).filter((i) => !sel.includes(i));
    if (miss.length) h += `<div class="small muted">漏選：${miss.map((i) => `${LETTERS[i]}. ${esc(a.options[i])}`).join("、")}</div>`;
  }
  return h;
}

function isCorrect(r) {
  const a = currentAct();
  if (a.type === "multi") { const sc = multiScore(r); return sc.total ? sc.hits === sc.total && sc.wrong === 0 : null; }
  if (a.type === "match") { const sc = matchScore(r); return sc.total ? sc.ok === sc.total : null; }
  if (a.type !== "choice" || a.answer == null || r.choice == null) return null;
  return r.choice === a.answer;
}

// 長條圖的數字：選擇題＝每個選項幾人；配合題＝每一列答對幾人
function chartCounts() {
  const a = live.session.activity;
  if (a.type === "match") {
    const right = currentAct().right || [];
    return (a.left || []).map((_, i) => live.responses.filter((r) => matchPicks(r)[i] === right[i]).length);
  }
  if (a.type === "multi") return (a.options || []).map((_, i) => live.responses.filter((r) => (r.multi || []).includes(i)).length);
  return (a.options || []).map((_, i) => live.responses.filter((r) => r.choice === i).length);
}

function pairsHtml(r) {
  const a = live.session.activity, right = currentAct().right || [], picks = matchPicks(r);
  return (a.left || []).map((l, i) => {
    const mark = safe ? "" : picks[i] === right[i] ? " ✅" : " ❌";
    return `<div>${esc(l)} → <b>${esc(picks[i] || "（未選）")}</b>${mark}</div>`;
  }).join("");
}

// 投影統計（長條圖、加入人數）跟著作答即時更新
function scheduleProjectionStats() {
  clearTimeout(live.writeTimer);
  live.writeTimer = setTimeout(async () => {
    const s = live.session; if (!s || !live.code) return;
    const p = s.projection || {};
    const patch = {};
    if (p.mode === "join" && p.joined !== live.members.length) patch["projection.joined"] = live.members.length;
    if (p.mode === "chart") {
      const counts = chartCounts();
      if (JSON.stringify(counts) !== JSON.stringify(p.counts) || p.answered !== live.responses.length) {
        patch["projection.counts"] = counts;
        patch["projection.answered"] = live.responses.length;
      }
    }
    if (Object.keys(patch).length) await updateDoc(doc(db, "sessions", live.code), patch);
  }, 500);
}

function setProjection(mode, opts = {}) {
  const s = live.session;
  if ((mode === "chart" || mode === "answers") && !liveInfo(s).closed) {
    return toast("停止作答後才能顯示統計或答案，避免影響學生的想法");
  }
  const proj = { mode };
  if (mode === "join") proj.joined = live.members.length;
  if (mode === "chart") {
    proj.counts = chartCounts();
    proj.answered = live.responses.length;
  }
  const patch = {};
  if (mode === "answers") {
    const named = !!opts.named;
    proj.kind = opts.kind || "picked";
    proj.items = live.selected
      .map((uid) => live.responses.find((r) => r.uid === uid)).filter(Boolean)
      .map((r, i) => ({
        label: LETTERS[i], uid: r.uid, choice: r.choice ?? null, text: r.text || "",
        ...(named ? { who: `${r.seat} 號 ${r.name}` } : {}),
        ...(s.activity.type === "match" ? { pairs: matchPicks(r) } : {}),
        ...(s.activity.type === "multi" ? { multi: r.multi || [] } : {}),
      }));
    if (!proj.items.length) return toast("請先點選要投影的想法");
    // 投影紀錄：只存內部編號，老師的控制台再對回是哪位同學
    patch.shown = [...(s.shown || []), { page: s.index + 1, items: proj.items.map((it) => ({ label: it.label, uid: it.uid })) }].slice(-60);
  }
  const names = { join: "加入 QR", question: "題目", chart: "統計圖", answers: "並排想法", blank: "遮蔽" };
  toast(`大螢幕已切換到：${names[mode] || mode}`);
  patch.projection = proj;
  return updateDoc(doc(db, "sessions", live.code), patch);
}

async function goTo(i) {
  const acts = live.lesson.activities;
  if (i < 0 || i >= acts.length) return;
  // 換頁時大螢幕自動顯示新題目（題目先預覽，按「開放作答」學生才看得到）
  live.selected = [];
  await updateDoc(doc(db, "sessions", live.code), {
    index: i, total: acts.length, activity: stripActivity(acts[i]),
    state: acts[i].type === "slide" ? "answering" : "preview",
    reveal: null, projection: { mode: "question" },
  });
}

function setState(state) {
  const patch = { state };
  if (state === "revealed") {
    const a = currentAct();
    patch.reveal = { answer: a.type === "choice" && a.answer != null ? a.answer : null, explanation: a.explanation || "" };
    if (a.type === "match") patch.reveal.pairs = (a.right || []).slice(0, (a.left || []).length);
    if (a.type === "multi") patch.reveal.answers = a.answers || [];
    // 公布答案時，大螢幕自動切到題目＋正確答案（想再看統計可以再按「統計」）
    patch.projection = { mode: "question" };
  } else {
    patch.reveal = null;
    if (state === "answering") patch.projection = { mode: "question" };
  }
  return updateDoc(doc(db, "sessions", live.code), patch);
}

function toggleSelect(uid) {
  if (!live.responses.find((r) => r.uid === uid)) return toast("這位同學還沒作答");
  const i = live.selected.indexOf(uid);
  if (i >= 0) live.selected.splice(i, 1); else live.selected.push(uid);
  renderLiveBody();
}

async function randomPick(onlyWrong) {
  let pool = live.responses;
  if (onlyWrong) pool = pool.filter((r) => isCorrect(r) === false);
  if (!pool.length) return toast(onlyWrong ? "沒有答錯的同學（或這題沒有設定答案）" : "還沒有人作答");
  const picked = live.session.picked || [];
  let fresh = pool.filter((r) => !picked.includes(r.uid));
  if (!fresh.length) fresh = pool; // 大家都被抽過了，就重新開始
  const r = fresh[Math.floor(Math.random() * fresh.length)];
  await updateDoc(doc(db, "sessions", live.code), { picked: [...new Set([...picked, r.uid])] });
  const a = live.session.activity, ok = isCorrect(r);
  const closed = liveInfo(live.session).closed;
  const m = modal(`<div class="center">
    <div class="muted">🎲 抽到了${onlyWrong ? "（答錯的同學）" : ""}</div>
    <div style="font-size:3rem;font-weight:800;line-height:1.2">${r.seat} 號</div>
    <div style="font-size:1.4rem">${esc(r.name)}</div></div>
    <div class="card" style="margin:12px 0;box-shadow:none;border:1px solid var(--line)">
      <div class="muted small">他的答案（只有你看得到）${ok === true ? ` <span class="tag ok">對</span>` : ok === false ? ` <span class="tag bad">錯</span>` : ""}</div>
      ${a.type === "match" ? pairsHtml(r) : ""}${a.type === "multi" ? multiHtml(r) : ""}
      ${r.choice != null ? `<div><b>${LETTERS[r.choice]}. ${esc(a.options[r.choice])}</b></div>` : ""}
      ${r.text ? `<div style="white-space:pre-wrap">${esc(r.text)}</div>` : ""}
    </div>
    ${closed ? `<div class="ctrl-grid">
      <button class="btn" data-c="named">📺 投影他的想法（具名）</button>
      <button class="btn secondary" data-c="anon">🎭 匿名投影</button></div>`
      : `<p class="muted small">停止作答後才能投影，避免影響還在作答的同學。</p>`}
    <div class="ctrl-grid" style="margin-top:8px">
      <button class="btn ghost" data-c="again">🎲 再抽一位</button>
      <button class="btn ghost" data-c="close">關閉</button></div>
    <p class="muted small" style="margin-top:10px">⭐ 抽過的同學，座號旁會有星星；下次會優先抽還沒被抽過的人。</p>`);
  const project = (named) => { m.remove(); live.selected = [r.uid]; setProjection("answers", { named, kind: "picked" }); };
  m.querySelector("[data-c=named]")?.addEventListener("click", () => project(true));
  m.querySelector("[data-c=anon]")?.addEventListener("click", () => project(false));
  m.querySelector("[data-c=again]").onclick = () => { m.remove(); randomPick(onlyWrong); };
  m.querySelector("[data-c=close]").onclick = () => m.remove();
  renderLiveBody();
}

function detail(seat) {
  const m = live.members.find((x) => x.seat === seat);
  const r = m && live.responses.find((x) => x.uid === m.uid);
  const a = live.session.activity;
  modal(`<h2>${seat} 號 ${esc(m?.name || live.roster.find((x) => x.seat === seat)?.name || "")}</h2>
    ${!m ? `<p class="muted">還沒有加入這堂課</p>` : !r ? `<p class="muted">已加入，這一頁還沒作答</p>` : `
      ${a.type === "match" ? `<div style="margin-bottom:10px">${pairsHtml(r)}</div>` : ""}
      ${a.type === "multi" ? `<div style="margin-bottom:10px">${multiHtml(r, true)}</div>` : ""}
      ${r.choice != null ? `<p><b>${LETTERS[r.choice]}. ${esc(a.options[r.choice])}</b>
        ${isCorrect(r) === true ? `<span class="tag ok">對</span>` : isCorrect(r) === false ? `<span class="tag bad">錯</span>` : ""}</p>` : ""}
      ${r.text ? `<p style="white-space:pre-wrap">${esc(r.text)}</p>` : ""}`}
    <button class="btn" onclick="this.closest('.modal').remove()">關閉</button>`);
}

// ---- 上課畫面有兩種 ----
// class：上課畫面，投影出去也安全（只有題目、已交人數、座號亮燈，沒有姓名和對錯）
// private：完整控制台，有姓名、對錯、挑答案（適合手機，或大螢幕不是鏡像這台裝置時）
let liveView = (() => {
  try { return localStorage.getItem("liveView") || (window.innerWidth < 700 ? "private" : "class"); }
  catch (e) { return window.innerWidth < 700 ? "private" : "class"; }
})();
function setLiveView(v) {
  liveView = v;
  try { localStorage.setItem("liveView", v); } catch (e) { /* 忽略 */ }
  live.cvKey = null;
  renderLiveBody();
}
function askPrivateView() {
  if (window.innerWidth < 700) return setLiveView("private"); // 手機不會被投影
  const m = modal(`<h2>🔐 切到完整控制台？</h2>
    <p>完整控制台會顯示<b>學生姓名和答對答錯</b>。</p>
    <p class="status-bar bad" style="margin:10px 0">如果這台 iPad 正在投影（鏡像或 HDMI），全班都會看到。</p>
    <p class="muted small">想私下看姓名和對錯：用<b>手機</b>打開控制台最方便；或先按投影機遙控器的「凍結 / Freeze」，大螢幕會停在目前畫面，看完再解除。</p>
    <div class="ctrl-grid" style="margin-top:12px">
      <button class="btn danger" data-c="go">我知道了，切換</button>
      <button class="btn ghost" data-c="no">取消</button>
    </div>`);
  m.querySelector("[data-c=go]").onclick = () => { m.remove(); setLiveView("private"); };
  m.querySelector("[data-c=no]").onclick = () => m.remove();
}

function liveInfo(s) {
  const a = s.activity || {};
  const isQ = a.type !== "slide";
  const lobby = s.state === "lobby";
  const preview = s.state === "preview";
  const collecting = isQ && !lobby && !preview;
  const closed = collecting && (s.state === "locked" || s.state === "revealed"); // 停止作答之後才能看統計
  const stateTag = lobby ? `<span class="tag wait">等待室</span>` :
    !isQ ? `<span class="tag">投影片</span>` :
    preview ? `<span class="tag wait">預覽中・學生還看不到題目</span>` :
    s.state === "answering" ? `<span class="tag">作答中</span>` :
    s.state === "locked" ? `<span class="tag wait">已停止作答</span>` : `<span class="tag ok">已公布</span>`;
  return { a, isQ, lobby, preview, collecting, closed, stateTag };
}

// 兩種畫面共用的操作按鈕（照上課步驟只顯示下一步要按的）
function controlBarHtml(s) {
  const { isQ, lobby, preview } = liveInfo(s);
  let main = "";
  if (lobby) main = `<button class="btn ok xl" data-ctl="begin">▶ 開始第一題</button>`;
  else if (isQ && preview) main = `<button class="btn ok xl" data-ctl="open">▶ 開放作答</button>`;
  else if (isQ && s.state === "answering") main = `<button class="btn xl" data-ctl="stop">⏹ 停止作答</button>`;
  else if (isQ && s.state === "locked") main = `<button class="btn ok xl" data-ctl="reveal">✅ 公布答案</button>
    <button class="btn ghost" data-ctl="reopen">重新開放作答</button>`;
  else if (isQ && s.state === "revealed") main = `<button class="btn ghost" data-ctl="unreveal">收回答案</button>`;
  return `<div class="ctl-bar">
    ${lobby ? "" : `<button class="btn ghost" data-ctl="prev" ${s.index === 0 ? "disabled" : ""}>◀ 上一頁</button>`}
    ${main}
    ${lobby ? "" : `<button class="btn secondary" data-ctl="next" ${s.index + 1 >= s.total ? "disabled" : ""}>下一頁 ▶</button>`}
    <span class="grow"></span>
    ${isQ || lobby ? `<button class="btn ghost sm" data-ctl="lock" title="開：學生送出後就不能改答案">🔒 送出後鎖定：${s.lock ? "開" : "關"}</button>` : ""}
  </div>`;
}

// 大螢幕要顯示什麼（平常會自動切換，這裡是手動調整）
function displayBarHtml(s) {
  const { a, isQ, closed } = liveInfo(s);
  const mode = s.projection?.mode || "question";
  const b = (m, label, enabled = true, title = "") =>
    `<button class="btn secondary sm ${mode === m ? "on" : ""}" data-proj="${m}" ${enabled ? "" : "disabled"} title="${title}">${label}</button>`;
  const chartable = ["choice", "multi", "match"].includes(a.type);
  const wait = "停止作答後才能顯示";
  const ok = closed && live.responses.length;
  const kind = mode === "answers" ? s.projection?.kind : "";
  const cnt = ideaCount();
  return `<div class="row">
    <span class="muted small">大螢幕：</span>
    ${b("question", "📝 題目")}
    ${chartable ? b("chart", "📊 統計", closed, closed ? "" : wait) : ""}
    ${b("join", "📱 加入 QR")}
    ${b("blank", "⬛ 遮蔽")}
  </div>
  ${isQ ? `<div class="row" style="margin-top:8px">
    <span class="muted small">討論：</span>
    <button class="btn secondary sm ${kind === "ideas" ? "on" : ""}" data-ctl="ideas" ${ok ? "" : "disabled"} title="${closed ? "挑幾份答案不一樣的想法並排" : wait}">💬 看看大家的想法</button>
    ${hasAnswerKey() ? `<button class="btn secondary sm ${kind === "wrong" ? "on" : ""}" data-ctl="wrongideas" ${ok ? "" : "disabled"} title="${closed ? "只抽答錯的，一律匿名" : wait}">🎭 看看答錯的原因</button>` : ""}
    ${liveView === "private" ? `<button class="btn secondary sm ${kind === "picked" ? "on" : ""}" data-proj="answers" ${closed && live.selected.length ? "" : "disabled"} title="${closed ? "在座位表或答案列表點選後投影" : wait}">📌 投影選取的想法（${live.selected.length}）</button>` : ""}
    <select data-opt="count" title="一次抽幾份" style="width:auto;padding:6px 8px">${[2, 3, 4].map((n) => `<option value="${n}" ${n === cnt ? "selected" : ""}>${n} 份</option>`).join("")}</select>
    <button class="btn ghost sm" data-ctl="names" title="只影響「看看大家的想法」和「投影選取的想法」；答錯的一律匿名">🏷️ 顯示姓名：${ideaNamed() ? "開" : "關"}</button>
  </div>` : ""}`;
}

function bindControls(root, s) {
  root.querySelectorAll("[data-ctl]").forEach((btn) => btn.onclick = () => {
    const c = btn.dataset.ctl;
    if (c === "begin") goTo(0);
    else if (c === "prev") goTo(s.index - 1);
    else if (c === "next") goTo(s.index + 1);
    else if (c === "open" || c === "reopen") setState("answering");
    else if (c === "stop" || c === "unreveal") setState("locked");
    else if (c === "reveal") setState("revealed");
    else if (c === "lock") toggleLock();
    else if (c === "ideas") pickIdeas("ideas");
    else if (c === "wrongideas") pickIdeas("wrong");
    else if (c === "names") { setPref("ideaNamed", ideaNamed() ? "0" : "1"); live.cvKey = null; renderLiveBody(); }
  });
  root.querySelectorAll("[data-proj]").forEach((btn) => btn.onclick = () =>
    setProjection(btn.dataset.proj, btn.dataset.proj === "answers" ? { named: ideaNamed(), kind: "picked" } : {}));
  root.querySelectorAll("[data-opt=count]").forEach((sel) => sel.onchange = () => setPref("ideaCount", sel.value));
}

function toggleLock() {
  const v = !live.session.lock;
  try { localStorage.setItem("lockOnSubmit", v ? "1" : "0"); } catch (e) { /* 忽略 */ }
  toast(v ? "已開啟：學生送出後不能修改" : "已關閉：停止作答前學生都能修改");
  return updateDoc(doc(db, "sessions", live.code), { lock: v });
}

// ---- 討論用的小設定（每台裝置各自記住）----
function getPref(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }
function setPref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } }
const ideaCount = () => Number(getPref("ideaCount", "3")) || 3;
const ideaNamed = () => getPref("ideaNamed", "0") === "1";

// 這一題系統能不能自己判斷對錯（簡答題、沒設答案的題目不行）
function hasAnswerKey() {
  const a = currentAct();
  return (a.type === "choice" && a.answer != null) || (a.type === "multi" && (a.answers || []).length > 0)
    || (a.type === "match" && (a.left || []).length > 0);
}

// 💬 看看大家的想法：挑答案不一樣的幾份；🎭 看看答錯的原因：只抽答錯的、每種錯法各一份，一律匿名
function pickIdeas(kind) {
  const n = ideaCount();
  const answerKey = (r) => JSON.stringify([r.choice ?? null, r.multi || null, r.match || null]);
  const fullKey = (r) => answerKey(r) + "|" + (r.text || "").trim();
  let pool = [...live.responses].sort(() => Math.random() - 0.5);
  if (kind === "wrong") {
    pool = pool.filter((r) => isCorrect(r) === false);
    if (!pool.length) return toast("這一題沒有答錯的同學 👍");
  }
  if (!pool.length) return toast("還沒有人作答");
  const keyOf = kind === "wrong" ? answerKey : fullKey;
  const seen = new Set(), pick = [];
  for (const r of pool) { if (pick.length >= n) break; if (!seen.has(keyOf(r))) { seen.add(keyOf(r)); pick.push(r.uid); } }
  for (const r of pool) { if (pick.length >= n) break; if (!pick.includes(r.uid)) pick.push(r.uid); }
  live.selected = pick;
  return setProjection("answers", { named: kind === "ideas" && ideaNamed(), kind });
}

// 大螢幕上的想法是誰的（只在完整控制台顯示）
function whoHtml(s) {
  const nameOf = (uid) => {
    const r = live.responses.find((x) => x.uid === uid) || live.members.find((x) => x.uid === uid);
    return r ? `${r.seat} 號 ${esc(r.name)}` : "（已離開）";
  };
  const okTag = (uid) => {
    const r = live.responses.find((x) => x.uid === uid);
    const ok = r ? isCorrect(r) : null;
    return ok === true ? ` <span class="tag ok">對</span>` : ok === false ? ` <span class="tag bad">錯</span>` : "";
  };
  const now = s.projection?.mode === "answers" ? s.projection.items || [] : [];
  const log = (s.shown || []).slice().reverse();
  if (!now.length && !log.length) return "";
  return `<div class="card">
    ${now.length ? `<h3>大螢幕上的想法是誰的 <span class="muted small">（只有你看得到）</span></h3>
      ${now.map((it) => `<div class="list-item" style="padding:6px 0"><b style="width:4.5em">想法 ${esc(it.label)}</b><span class="grow">${nameOf(it.uid)}${okTag(it.uid)}</span></div>`).join("")}` : ""}
    ${log.length ? `<details style="margin-top:8px"><summary class="muted small" style="cursor:pointer">這堂課投影過的想法紀錄（${log.length} 次）</summary>
      ${log.map((g) => `<div class="small" style="padding:4px 0">第 ${g.page} 頁：${g.items.map((it) => `想法 ${esc(it.label)}＝${nameOf(it.uid)}`).join("、")}</div>`).join("")}</details>` : ""}
  </div>`;
}

function renderLiveBody() {
  if (!live.code || !live.session) return;
  if (liveView === "class") renderClassView(); else renderPrivateView();
}

function seatCount() {
  return Math.max(35, ...live.members.map((m) => m.seat), ...live.roster.map((r) => r.seat));
}

// ---- 上課畫面（投影安全）----
function renderClassView() {
  const root = $("#tab-live");
  const s = live.session;
  const { collecting, stateTag, lobby } = liveInfo(s);
  // 題目區只在題目或狀態改變時重畫，學生交卷時只更新下方座號，畫面不會閃
  const key = JSON.stringify([s.index, s.state, s.projection, s.activity, s.reveal]);
  if (live.cvKey !== key || !root.querySelector(".classview")) {
    live.cvKey = key;
    root.innerHTML = `<div class="classview">
      <div class="cv-head">
        <span class="progress">${lobby ? "等待學生加入" : `第 ${s.index + 1} / ${s.total} 頁`}</span> ${stateTag}
        <span class="muted small">代碼 <b>${esc(s.code)}</b></span>
        <span class="grow"></span>
        <button class="btn ghost sm" id="btn-qr">📱 顯示 QR Code</button>
        <button class="btn ghost sm" id="btn-private">🔐 完整控制台</button>
      </div>
      <div class="class-screen" id="cv-screen"></div>
      <div id="cv-strip"></div>
      <div id="cv-controls"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn ghost sm" id="btn-leave">離開（課堂繼續）</button>
        <button class="btn danger sm" id="btn-end">結束課堂</button>
      </div>
    </div>`;
    renderScreen($("#cv-screen"), s);
    $("#btn-qr").onclick = () => showJoinQr(s.code);
    $("#btn-private").onclick = askPrivateView;
    bindLeaveEnd();
  }
  // 已交人數＋座號亮燈（只有座號，沒有姓名、沒有對錯）
  const answered = new Set(live.responses.map((r) => r.uid));
  const bySeat = new Map(live.members.map((m) => [m.seat, m]));
  let dots = "";
  for (let n = 1; n <= seatCount(); n++) {
    const m = bySeat.get(n);
    const cls = !m ? "" : collecting && answered.has(m.uid) ? "done" : "in";
    dots += `<span class="dot ${cls}">${n}</span>`;
  }
  $("#cv-strip").innerHTML = `<div class="cv-strip">
    <b>${collecting ? `已交 ${live.responses.length} / ${live.members.length}` : `已加入 ${live.members.length} 人`}</b>
    <div class="dots">${dots}</div></div>`;
  const ctl = $("#cv-controls");
  ctl.innerHTML = controlBarHtml(s) + `<div style="margin-top:8px">${displayBarHtml(s)}</div>`;
  bindControls(ctl, s);
}

function bindLeaveEnd() {
  $("#btn-leave").onclick = () => { leaveSession(); renderLive(); };
  $("#btn-end").onclick = async () => {
    if (!confirm("結束這堂課？學生的作答資料會一併清除。")) return;
    const code = live.code;
    leaveSession();
    await endSession(code);
    toast("課堂已結束");
    renderLive();
  };
}

// ---- 完整控制台（私人：姓名、對錯、挑答案）----
function renderPrivateView() {
  const root = $("#tab-live");
  const s = live.session, act = currentAct();
  const { a, isQ, lobby, collecting, stateTag } = liveInfo(s);

  // 座位表
  const bySeat = new Map(live.members.map((m) => [m.seat, m]));
  const respByUid = new Map(live.responses.map((r) => [r.uid, r]));
  let cells = "";
  const missing = [];
  for (let n = 1; n <= seatCount(); n++) {
    const m = bySeat.get(n);
    const rosterName = live.roster.find((x) => x.seat === n)?.name || "";
    let cls = "absent", name = rosterName, score = "";
    if (m) {
      name = m.name;
      const r = respByUid.get(m.uid);
      if (!collecting) cls = "";
      else if (!r) { cls = "joined"; missing.push(n); }
      else {
        const ok = isCorrect(r);
        cls = safe || ok === null ? "answered" : ok ? "correct" : "wrong";
        if (!safe && a.type === "match") {
          const sc = matchScore(r);
          if (sc.ok > 0 && sc.ok < sc.total) cls = "partial";
          score = `${sc.ok}/${sc.total}`;
        }
        if (!safe && a.type === "multi" && multiScore(r).total) {
          const sc = multiScore(r);
          if (!ok && sc.hits > 0) cls = "partial";
          score = `對${sc.hits}/${sc.total}${sc.wrong ? ` 錯${sc.wrong}` : ""}`;
        }
        if (live.selected.includes(m.uid)) cls += " selected";
        const shownItem = s.projection?.mode === "answers" && (s.projection.items || []).find((it) => it.uid === m.uid);
        if (shownItem) score = `想法 ${shownItem.label}` + (score ? `・${score}` : "");
      }
      if ((s.picked || []).includes(m.uid)) cls += " picked";
    }
    cells += `<div class="seat ${cls}" data-seat="${n}"><span class="no">${n}</span>${safe || !name ? "" : `<span class="nm">${esc(name)}</span>`}${score ? `<span class="nm">${score}</span>` : ""}</div>`;
  }

  // 答案列表
  const resps = [...live.responses].sort((x, y) => x.seat - y.seat);
  const ansList = resps.map((r) => {
    const ok = isCorrect(r);
    const sel = live.selected.indexOf(r.uid);
    return `<div class="ans ${sel >= 0 ? "selected" : ""}" data-uid="${r.uid}">
      <div class="meta">${sel >= 0 ? `<b>想法 ${LETTERS[sel]}</b>　` : ""}${safe ? "" : `${r.seat} 號 ${esc(r.name)}`}
        ${!safe && ok === true ? `<span class="tag ok">對</span>` : ""}${!safe && ok === false ? `<span class="tag bad">錯</span>` : ""}</div>
      ${a.type === "match" ? pairsHtml(r) : ""}
      ${a.type === "multi" ? multiHtml(r) : ""}
      ${r.choice != null ? `<div><b>${LETTERS[r.choice]}. ${esc(a.options[r.choice])}</b></div>` : ""}
      ${r.text ? `<div class="txt">${esc(r.text)}</div>` : ""}</div>`;
  }).join("");

  // 長條圖（只有自己看得到）
  const counts = chartCounts();
  const maxC = Math.max(1, ...counts);
  const bars = a.type === "choice" || a.type === "multi" ? `<div class="bars">${(a.options || []).map((o, i) => `
    <div class="bar-row"><b>${LETTERS[i]}</b><div><div class="bar ${!safe && isAnswerOpt(i) ? "ok" : ""}" style="width:${counts[i] / maxC * 100}%"></div></div><span>${counts[i]}</span></div>`).join("")}</div>`
    : a.type === "match" && !safe ? `<div class="small muted">每一列答對人數</div><div class="bars">${(a.left || []).map((l, i) => `
    <div class="bar-row" style="grid-template-columns:5em 1fr 3em"><b>${esc(l)}</b><div><div class="bar ok" style="width:${counts[i] / Math.max(1, live.responses.length) * 100}%"></div></div><span>${counts[i]}/${live.responses.length}</span></div>`).join("")}</div>` : "";

  root.innerHTML = `
    <div class="live-head">
      <span class="progress">${lobby ? "等待學生加入" : `第 ${s.index + 1} / ${s.total} 頁`}</span> ${stateTag}
      <span class="muted">${esc(s.className)}・代碼 <b>${esc(s.code)}</b></span>
      <span class="grow"></span>
      <button class="btn ghost sm" id="btn-qr">📱 QR Code</button>
      <button class="btn ghost sm" id="btn-classview">🖥️ 上課畫面</button>
    </div>
    <div class="card" id="pv-controls">${controlBarHtml(s)}</div>
    <div class="live">
      <div>
        <div class="card">
          <div class="row" style="margin-bottom:10px">
            <b>已加入 ${live.members.length} 人</b>
            ${collecting ? `<b>・已作答 ${live.responses.length} 人</b>` : ""}
            ${collecting && missing.length ? `<span class="muted small">未作答：${missing.join("、")}</span>` : ""}
          </div>
          <div class="seats">${cells}</div>
          <div class="legend">
            <span><i style="border-color:var(--idle);border-style:dashed"></i>未加入</span>
            ${collecting ? `<span><i style="border-color:var(--wait);background:var(--wait-soft)"></i>未作答</span>
            <span><i style="border-color:var(--accent);background:var(--accent-soft)"></i>已作答</span>
            ${safe ? "" : `<span><i style="border-color:var(--ok);background:var(--ok-soft)"></i>答對</span>
            ${["match", "multi"].includes(a.type) ? `<span><i style="border-color:var(--partial);background:var(--partial-soft)"></i>部分對</span>` : ""}
            <span><i style="border-color:var(--bad);background:var(--bad-soft)"></i>答錯</span>`}` : ""}
            <span>點一下：選取投影｜長按：看答案｜★ 被抽過</span>
          </div>
        </div>
        <div class="card mini-q">
          ${lobby ? `<div class="muted small">第一頁預覽（學生還看不到）</div>` : ""}
          <div class="prompt">${esc(a.prompt)}</div>
          ${a.image ? `<img data-img="${esc(a.image)}" alt="" style="margin-top:8px">` : ""}
          ${(a.options || []).length ? `<div class="small" style="margin-top:8px">${a.options.map((o, i) =>
            `<span class="tag ${!safe && isAnswerOpt(i) ? "ok" : ""}" style="margin:2px">${LETTERS[i]}. ${esc(o)}</span>`).join("")}</div>` : ""}
          ${a.type === "match" ? `<div class="small" style="margin-top:8px">${(a.left || []).map((l, i) =>
            `<span class="tag" style="margin:2px">${esc(l)}${safe ? "" : ` → ${esc((act.right || [])[i] || "")}`}</span>`).join("")}</div>` : ""}
        </div>
      </div>
      <div class="panel">
        ${collecting && bars ? `<div class="card"><h3>統計 <span class="muted small">（只有你看得到）</span></h3>${bars}</div>` : ""}
        ${whoHtml(s)}
        <div class="card">${displayBarHtml(s)}
          <div class="row" style="margin-top:10px"><button class="btn ghost sm" id="btn-screen-link">投影電腦網址</button></div>
        </div>
        ${collecting ? `<div class="card">
          <h3>挑答案討論 <span class="muted small">（選了 ${live.selected.length} 份）</span></h3>
          <div class="row" style="margin-bottom:10px">
            <button class="btn secondary sm" id="btn-pick">🎲 隨機抽一位</button>
            ${(a.type === "choice" && act.answer != null) || a.type === "match" || (a.type === "multi" && (act.answers || []).length) ? `<button class="btn secondary sm" id="btn-pick-wrong">🎲 從答錯的抽</button>` : ""}
            <button class="btn ghost sm" id="btn-clear-sel" ${live.selected.length ? "" : "disabled"}>清除選取</button>
          </div>
          <div class="answer-list">${ansList || `<p class="muted">還沒有人作答</p>`}</div>
        </div>` : ""}
        <div class="row">
          <button class="btn ghost sm" id="btn-leave">離開（課堂繼續）</button>
          <button class="btn danger sm" id="btn-end">結束課堂</button>
        </div>
      </div>
    </div>`;
  loadImages(root);

  root.querySelectorAll(".seat[data-seat]").forEach((el) => {
    const seat = Number(el.dataset.seat);
    pressable(el, () => { const m = bySeat.get(seat); if (m) toggleSelect(m.uid); }, () => detail(seat));
  });
  root.querySelectorAll(".ans[data-uid]").forEach((el) => el.onclick = () => toggleSelect(el.dataset.uid));
  bindControls(root, s);
  $("#btn-qr").onclick = () => showJoinQr(s.code);
  $("#btn-classview").onclick = () => setLiveView("class");
  $("#btn-screen-link").onclick = () => {
    const url = new URL("tv", location.href).href;
    modal(`<h2>投影電腦</h2><p>在教室電腦打開這個網址，<b>不用登入</b>，畫面會自動跟著你最新開始的課堂：</p>
      <p style="word-break:break-all"><b>${esc(url)}</b></p>
      <button class="btn" onclick="this.closest('.modal').remove()">好</button>`);
  };
  const pick = $("#btn-pick"); if (pick) pick.onclick = () => randomPick(false);
  const pw = $("#btn-pick-wrong"); if (pw) pw.onclick = () => randomPick(true);
  const cs = $("#btn-clear-sel"); if (cs) cs.onclick = () => { live.selected = []; renderLiveBody(); };
  bindLeaveEnd();
}

// ---- 在老師的螢幕上直接秀 QR Code（沒有投影時，拿著 iPad 給學生掃）----
function showJoinQr(code) {
  const url = studentUrl(code);
  const m = modal(`<div class="center">
    <h2 style="margin-bottom:4px">掃描加入課堂</h2>
    <div class="join-qr">${qrSvg(url)}</div>
    <div class="muted small">或打開 ${esc(url.replace(/^https?:\/\//, "").replace(/\?s=.*$/, ""))} 輸入代碼</div>
    <div style="font-size:2.6rem;font-weight:800;letter-spacing:.15em;color:var(--accent)">${esc(code)}</div>
    <button class="btn" style="margin-top:8px" onclick="this.closest('.modal').remove()">關閉</button></div>`);
  return m;
}

// ---- 在 iPad 上直接顯示投影畫面（鏡像投影用）----
function openEmbed() { $("#screen-embed").classList.remove("hidden"); syncEmbed(); }
$("#btn-embed-exit").onclick = () => $("#screen-embed").classList.add("hidden");
function syncEmbed() {
  if ($("#screen-embed").classList.contains("hidden")) return;
  renderScreen($("#embed-root"), live.session);
}

// =====================================================================
// 課程
// =====================================================================
let editing = null; // { id, title, activities }

function renderLessonList() {
  stopEditWatch();
  const root = $("#tab-lessons");
  root.innerHTML = `<div class="card" style="max-width:820px">
    <div class="row" style="margin-bottom:10px"><h2 class="grow" style="margin:0">我的課程</h2>
      <button class="btn sm" id="btn-new-lesson">＋ 新增課程</button>
      <button class="btn secondary sm" id="btn-library">📚 課程庫</button>
      <button class="btn ghost sm" id="btn-import">匯入／還原</button></div>
    ${lessons.length ? lessons.map((l) => `<div class="list-item">
      <div class="grow"><b>${esc(l.title)}</b> <span class="muted small">${(l.activities || []).length} 頁</span></div>
      <button class="btn secondary sm" data-edit="${l.id}">編輯</button>
      <button class="btn ghost sm" data-backup="${l.id}">下載備份</button>
      <button class="btn ghost sm" data-copy="${l.id}">複製</button>
      <button class="btn danger sm" data-del="${l.id}">刪除</button></div>`).join("") : `<p class="muted">還沒有課程</p>`}
  </div>`;
  $("#btn-new-lesson").onclick = () => openEditor({ id: null, title: "新課程", activities: [] });
  $("#btn-import").onclick = importLesson;
  $("#btn-library").onclick = openLibrary;
  root.querySelectorAll("[data-edit]").forEach((b) => b.onclick = async () => {
    b.disabled = true; b.textContent = "讀取中…";
    try {
      const snap = await getDoc(doc(db, "lessons", b.dataset.edit));
      if (!snap.exists()) { toast("找不到這份課程，可能已被刪除"); return renderLessonList(); }
      const l = snap.data();
      openEditor({ id: snap.id, title: l.title, activities: l.activities || [], base: tsMillis(l.updatedAt) });
    } catch (e) {
      b.disabled = false; b.textContent = "編輯";
      toast("讀取失敗：" + (e.code || e.message));
    }
  });
  // 備份、複製都用資料庫裡的最新版本
  const fresh = async (id) => { const snap = await getDoc(doc(db, "lessons", id)); return snap.exists() ? snap.data() : null; };
  root.querySelectorAll("[data-backup]").forEach((b) => b.onclick = async () => {
    const l = await fresh(b.dataset.backup);
    if (l) downloadBackup(l); else toast("找不到這份課程");
  });
  root.querySelectorAll("[data-copy]").forEach((b) => b.onclick = async () => {
    const l = await fresh(b.dataset.copy);
    if (!l) return toast("找不到這份課程");
    await addDoc(collection(db, "lessons"), { title: l.title + "（複本）", activities: l.activities || [], updatedAt: serverTimestamp() });
    await reloadData(); renderLessonList();
  });
  root.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    const l = lessons.find((x) => x.id === b.dataset.del);
    if (!confirm(`刪除「${l.title}」？`)) return;
    await deleteDoc(doc(db, "lessons", l.id));
    await reloadData(); renderLessonList();
  });
}

// 備份檔把圖片一起包進去（data: 網址），還原時不怕原本的圖片被刪掉
async function downloadBackup(l) {
  toast("準備備份中…");
  const activities = await Promise.all((l.activities || []).map(async (a) =>
    a.image && a.image.startsWith("img:") ? { ...a, image: await resolveImage(a.image) } : a));
  const blob = new Blob([JSON.stringify({ title: l.title, activities }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${l.title}｜系統備份.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

async function importData(data) {
  if (!Array.isArray(data.activities)) throw new Error("缺少 activities");
  const acts = data.activities;
  if (acts.some((a) => a.image && a.image.startsWith("data:"))) {
    toast("還原圖片中…");
    for (const a of acts) {
      if (a.image && a.image.startsWith("data:")) a.image = await uploadImage(await (await fetch(a.image)).blob());
    }
  }
  openEditor({ id: null, title: data.title || "匯入的課程", activities: acts });
  toast("已匯入，確認後記得按「儲存」");
}

// 課程庫：Claude 產生的課程放在 lessons/ 資料夾，列在 lessons/index.json
async function openLibrary() {
  const m = modal(`<h2>從課程庫匯入</h2><div id="lib-list" class="muted">載入中…</div>
    <button class="btn ghost" style="margin-top:12px" id="lib-close">關閉</button>`);
  $("#lib-close", m).onclick = () => m.remove();
  try {
    const list = await fetch("lessons/index.json", { cache: "no-store" }).then((r) => r.json());
    $("#lib-list", m).innerHTML = list.map((l, i) => `<div class="list-item">
      <div class="grow"><b>${esc(l.title)}</b><div class="small muted">${esc(l.note || "")}</div></div>
      <button class="btn sm" data-lib="${i}">匯入</button></div>`).join("") || "課程庫是空的";
    m.querySelectorAll("[data-lib]").forEach((b) => b.onclick = async () => {
      const data = await fetch("lessons/" + list[b.dataset.lib].file, { cache: "no-store" }).then((r) => r.json());
      m.remove();
      importData(data).catch((e) => toast("匯入失敗：" + e.message));
    });
  } catch (e) { $("#lib-list", m).textContent = "讀取課程庫失敗：" + e.message; }
}

function importLesson() {
  const m = modal(`<h2>匯入課程</h2>
    <p class="muted small">選擇備份檔（例如從雲端硬碟下載的「系統備份.json」）：</p>
    <input type="file" accept=".json,application/json" id="imp-file">
    <p class="muted small" style="margin-top:14px">或把 Claude 給你的課程內容整段貼進來：</p>
    <textarea id="imp-text" style="min-height:180px;font-family:monospace;font-size:.85rem"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="imp-ok">匯入</button>
    <button class="btn ghost" id="imp-cancel">取消</button></div>`);
  $("#imp-cancel", m).onclick = () => m.remove();
  $("#imp-file", m).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      m.remove();
      importData(data).catch((err) => toast("匯入失敗：" + err.message));
    } catch (err) { toast("檔案格式不正確：" + err.message); }
  };
  $("#imp-ok", m).onclick = () => {
    try {
      const data = JSON.parse($("#imp-text", m).value);
      m.remove();
      importData(data).catch((e) => toast("匯入失敗：" + e.message));
    } catch (e) { toast("格式不正確：" + e.message); }
  };
}

// ---- 防止互相覆蓋：記住打開時的版本，別處改了就提醒 ----
let editWatch = null;
const tsMillis = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);

function stopEditWatch() { if (editWatch) { editWatch(); editWatch = null; } }

// 比較內容用：欄位順序不同也視為相同
function stableStr(v) {
  if (Array.isArray(v)) return `[${v.map(stableStr).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStr(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const contentOf = (d) => ({ title: d.title, activities: d.activities || [] });

function openEditor(lesson) {
  stopEditWatch();
  editing = lesson;
  renderEditor();
  if (!lesson.id) return;
  editWatch = onSnapshot(doc(db, "lessons", lesson.id), (snap) => {
    if (editing !== lesson || lesson.saving || snap.metadata.hasPendingWrites) return;
    let changed = !snap.exists() || tsMillis(snap.data().updatedAt) !== lesson.base;
    // 是自己剛存的內容（時間戳晚一步才到），就當成新的基準，不算別人改的
    if (changed && snap.exists() && lesson.lastSaved && stableStr(contentOf(snap.data())) === lesson.lastSaved) {
      lesson.base = tsMillis(snap.data().updatedAt);
      changed = false;
    }
    if (changed !== !!lesson.changedElsewhere) {
      lesson.changedElsewhere = changed;
      const bar = $("#ed-conflict");
      if (bar) bar.classList.toggle("hidden", !changed);
    }
  });
}

// 儲存時發現衝突：讓老師決定
function askConflict() {
  return new Promise((resolve) => {
    const m = modal(`<h2>⚠️ 這份課程在別的地方被修改過</h2>
      <p>你打開編輯之後，這份課程被另一台裝置（或 Claude）改過了。</p>
      <p class="muted small">如果直接儲存，另一邊的修改會被你現在的版本蓋掉。</p>
      <div class="ctrl-grid" style="margin-top:12px">
        <button class="btn" data-c="reload">載入最新版</button>
        <button class="btn danger" data-c="force">仍然儲存</button>
      </div>
      <button class="btn ghost" style="margin-top:8px;width:100%" data-c="cancel">取消</button>
      <p class="muted small" style="margin-top:10px">建議：先按「取消」，把你這次改的地方記下來，再按「載入最新版」重新修改。</p>`);
    m.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => { m.remove(); resolve(b.dataset.c); });
  });
}

const TYPE_NAMES = { slide: "投影片（只展示）", choice: "選擇題", multi: "複選題", match: "配合題", text: "簡答題" };

function renderEditor() {
  const root = $("#tab-lessons");
  const L = editing;
  root.innerHTML = `<div style="max-width:820px">
    <div class="card">
      <div class="row"><button class="btn ghost sm" id="ed-back">← 返回</button><span class="grow"></span>
        <button class="btn secondary sm" id="ed-export">匯出 JSON</button>
        <button class="btn sm" id="ed-save">儲存</button></div>
      <label class="field" style="margin-top:12px"><span>課程名稱</span><input type="text" id="ed-title" value="${esc(L.title)}"></label>
      <div id="ed-conflict" class="status-bar bad ${L.changedElsewhere ? "" : "hidden"}">⚠️ 這份課程剛剛在別的地方被修改了。按「儲存」前請先確認，避免蓋掉對方的修改。</div>
    </div>
    <div id="ed-acts">${L.activities.map((a, i) => actEditor(a, i)).join("")}</div>
    <div class="card row">
      <span class="muted">新增一頁：</span>
      <button class="btn secondary sm" data-add="slide">＋ 投影片</button>
      <button class="btn secondary sm" data-add="choice">＋ 選擇題</button>
      <button class="btn secondary sm" data-add="multi">＋ 複選題</button>
      <button class="btn secondary sm" data-add="match">＋ 配合題</button>
      <button class="btn secondary sm" data-add="text">＋ 簡答題</button>
    </div></div>`;
  loadImages(root);

  $("#ed-title").oninput = (e) => { L.title = e.target.value; };
  $("#ed-back").onclick = () => { if (confirm("離開編輯？沒儲存的修改會不見。")) { stopEditWatch(); editing = null; renderLessonList(); } };
  $("#ed-save").onclick = saveLesson;
  $("#ed-export").onclick = () => {
    modal(`<h2>課程 JSON</h2><textarea style="min-height:300px;font-family:monospace;font-size:.8rem">${esc(JSON.stringify({ title: L.title, activities: L.activities }, null, 2))}</textarea>
      <button class="btn" style="margin-top:10px" onclick="this.closest('.modal').remove()">關閉</button>`);
  };
  root.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
    const t = b.dataset.add;
    L.activities.push(t === "choice"
      ? { type: "choice", prompt: "", options: ["", "", "", ""], answer: null, askReason: true, explanation: "" }
      : t === "match" ? { type: "match", prompt: "", left: [], right: [], askReason: false, explanation: "" }
      : t === "multi" ? { type: "multi", prompt: "", options: ["", "", "", "", "", ""], answers: [], askReason: false, explanation: "" }
      : t === "text" ? { type: "text", prompt: "", explanation: "" } : { type: "slide", prompt: "" });
    renderEditor();
    window.scrollTo(0, document.body.scrollHeight);
  });

  root.querySelectorAll(".act").forEach((el) => {
    const i = Number(el.dataset.i), a = L.activities[i];
    el.querySelectorAll("[data-f]").forEach((inp) => {
      const f = inp.dataset.f;
      const ev = inp.tagName === "SELECT" || inp.type === "checkbox" ? "change" : "input";
      inp.addEventListener(ev, () => {
        if (f === "options") a.options = inp.value.split("\n");
        else if (f === "left" || f === "right") a[f] = inp.value.split("\n");
        else if (f === "answer") a.answer = inp.value === "" ? null : Number(inp.value);
        else if (f === "askReason") a.askReason = inp.checked;
        else if (f === "type") {
          a.type = inp.value;
          if (a.type === "choice" && !a.options) a.options = ["", "", "", ""];
          if (a.type === "match" && !a.left) { a.left = []; a.right = []; }
          if (a.type === "multi") { if (!a.options) a.options = ["", "", "", "", "", ""]; if (!a.answers) a.answers = []; }
          renderEditor();
        }
        else a[f] = inp.value;
        if (f === "options") {
          // 選項改了，答案下拉選單跟著更新
          const sel = el.querySelector("[data-f=answer]");
          if (sel) sel.innerHTML = answerOptions(a);
          const boxes = el.querySelector(".multi-answers");
          if (boxes) boxes.innerHTML = multiAnswerBoxes(a);
        }
      });
    });
    el.addEventListener("change", (e) => {
      if (!e.target.matches("[data-ans]")) return;
      a.answers = [...el.querySelectorAll("[data-ans]:checked")].map((x) => Number(x.dataset.ans));
    });
    el.querySelector("[data-act=up]").onclick = () => { if (i > 0) { [L.activities[i - 1], L.activities[i]] = [L.activities[i], L.activities[i - 1]]; renderEditor(); } };
    el.querySelector("[data-act=down]").onclick = () => { if (i < L.activities.length - 1) { [L.activities[i + 1], L.activities[i]] = [L.activities[i], L.activities[i + 1]]; renderEditor(); } };
    el.querySelector("[data-act=del]").onclick = () => { if (confirm(`刪除第 ${i + 1} 頁？`)) { L.activities.splice(i, 1); renderEditor(); } };
    el.querySelector("[data-act=dup]").onclick = () => { L.activities.splice(i + 1, 0, JSON.parse(JSON.stringify(a))); renderEditor(); };
    el.querySelector("[data-act=img]").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      toast("圖片上傳中…");
      try { a.image = await uploadImage(file); toast("圖片已上傳"); renderEditor(); }
      catch (err) { toast("上傳失敗：" + err.message); }
    };
    const rm = el.querySelector("[data-act=rmimg]");
    if (rm) rm.onclick = () => { a.image = ""; renderEditor(); };
  });
}

function multiAnswerBoxes(a) {
  return (a.options || []).map((o, k) => o.trim() ? `<label class="row" style="gap:6px;margin:2px 10px 2px 0">
    <input type="checkbox" data-ans="${k}" ${(a.answers || []).includes(k) ? "checked" : ""} style="width:22px;height:22px">${LETTERS[k]}. ${esc(o)}</label>` : "").join("");
}

function answerOptions(a) {
  return `<option value="">（不設定，開放討論）</option>` +
    (a.options || []).map((o, k) => `<option value="${k}" ${a.answer === k ? "selected" : ""}>${LETTERS[k]}. ${esc(o)}</option>`).join("");
}

function actEditor(a, i) {
  return `<div class="act card" data-i="${i}">
    <div class="act-head">
      <span class="num">${i + 1}</span>
      <select data-f="type" style="width:auto">${Object.entries(TYPE_NAMES).map(([k, v]) => `<option value="${k}" ${a.type === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="grow"></span>
      <button class="btn ghost sm" data-act="up">↑</button>
      <button class="btn ghost sm" data-act="down">↓</button>
      <button class="btn ghost sm" data-act="dup">複製</button>
      <button class="btn danger sm" data-act="del">刪除</button>
    </div>
    <label class="field"><span>${a.type === "slide" ? "標題／文字" : "題目"}</span><textarea data-f="prompt" style="min-height:70px">${esc(a.prompt)}</textarea></label>
    <div class="field">
      <span class="muted small">圖片</span>
      ${a.image ? `<img class="thumb" data-img="${esc(a.image)}" alt=""><button class="btn ghost sm" data-act="rmimg">移除圖片</button>` : ""}
      <div class="row" style="margin-top:6px"><input type="file" accept="image/*" data-act="img"></div>
      <input type="url" data-f="image" placeholder="或貼上圖片網址" value="${a.image && !a.image.startsWith("img:") ? esc(a.image) : ""}" style="margin-top:6px">
    </div>
    ${a.type === "choice" ? `
      <label class="field"><span>選項（一行一個）</span><textarea data-f="options" style="min-height:100px">${esc((a.options || []).join("\n"))}</textarea></label>
      <label class="field"><span>正確答案</span><select data-f="answer">${answerOptions(a)}</select></label>
      <label class="row" style="margin-bottom:10px"><input type="checkbox" data-f="askReason" ${a.askReason ? "checked" : ""} style="width:22px;height:22px">要學生寫理由</label>
      ${a.askReason ? `<label class="field"><span>理由欄的提示（可留空）</span><input type="text" data-f="reasonLabel" value="${esc(a.reasonLabel || "")}" placeholder="你是怎麼判斷的？"></label>` : ""}` : ""}
    ${a.type === "multi" ? `
      <label class="field"><span>選項（一行一個，最多 10 個）</span><textarea data-f="options" style="min-height:140px">${esc((a.options || []).join("\n"))}</textarea></label>
      <div class="field"><span class="muted small">正確答案（可以勾很多個）</span><div class="row multi-answers">${multiAnswerBoxes(a)}</div></div>
      <label class="row" style="margin-bottom:10px"><input type="checkbox" data-f="askReason" ${a.askReason ? "checked" : ""} style="width:22px;height:22px">要學生寫理由</label>
      ${a.askReason ? `<label class="field"><span>理由欄的提示（可留空）</span><input type="text" data-f="reasonLabel" value="${esc(a.reasonLabel || "")}" placeholder="你是怎麼判斷的？"></label>` : ""}` : ""}
    ${a.type === "match" ? `
      <div class="row" style="align-items:flex-start">
        <label class="field grow"><span>左欄（一行一個）</span><textarea data-f="left" style="min-height:120px">${esc((a.left || []).join("\n"))}</textarea></label>
        <label class="field grow"><span>右欄：同一行＝正確配對，多出來的行是干擾項</span><textarea data-f="right" style="min-height:120px">${esc((a.right || []).join("\n"))}</textarea></label>
      </div>
      <p class="muted small" style="margin-top:-6px">學生看到的右欄順序會自動打亂。</p>
      <label class="row" style="margin-bottom:10px"><input type="checkbox" data-f="askReason" ${a.askReason ? "checked" : ""} style="width:22px;height:22px">要學生寫理由</label>
      ${a.askReason ? `<label class="field"><span>理由欄的提示（可留空）</span><input type="text" data-f="reasonLabel" value="${esc(a.reasonLabel || "")}" placeholder="你是怎麼記住的？"></label>` : ""}` : ""}
    ${a.type !== "slide" ? `<label class="field"><span>公布答案時的說明（可留空）</span><textarea data-f="explanation" style="min-height:60px">${esc(a.explanation || "")}</textarea></label>` : ""}
  </div>`;
}

async function saveLesson() {
  const L = editing;
  const acts = L.activities.map((a) => {
    const o = { type: a.type, prompt: a.prompt || "", image: a.image || "" };
    if (a.type === "choice") {
      o.options = (a.options || []).map((x) => x.trim()).filter((x) => x !== "");
      o.answer = a.answer != null && a.answer < o.options.length ? a.answer : null;
      o.askReason = !!a.askReason;
      o.reasonLabel = a.reasonLabel || "";
    }
    if (a.type === "multi") {
      // 去掉空白選項時，正確答案的位置要跟著調整
      const kept = (a.options || []).map((x, k) => ({ x: x.trim(), k })).filter((o2) => o2.x).slice(0, 10);
      o.options = kept.map((o2) => o2.x);
      o.answers = kept.map((o2, n) => ((a.answers || []).includes(o2.k) ? n : -1)).filter((n) => n >= 0);
      o.askReason = !!a.askReason;
      o.reasonLabel = a.reasonLabel || "";
    }
    if (a.type === "match") {
      o.left = (a.left || []).map((x) => x.trim()).filter(Boolean);
      o.right = (a.right || []).map((x) => x.trim()).filter(Boolean);
      o.askReason = !!a.askReason;
      o.reasonLabel = a.reasonLabel || "";
    }
    if (a.type !== "slide") o.explanation = a.explanation || "";
    return o;
  });
  const data = { title: L.title || "未命名課程", activities: acts, updatedAt: serverTimestamp() };
  try {
    if (L.id) {
      const latest = await getDoc(doc(db, "lessons", L.id));
      if (latest.exists() && tsMillis(latest.data().updatedAt) !== L.base) {
        const choice = await askConflict();
        if (choice === "cancel") return;
        if (choice === "reload") {
          const l = latest.data();
          openEditor({ id: L.id, title: l.title, activities: l.activities || [], base: tsMillis(l.updatedAt) });
          return toast("已載入最新版");
        }
      }
      L.saving = true;
      await setDoc(doc(db, "lessons", L.id), data);
    } else {
      L.saving = true;
      const r = await addDoc(collection(db, "lessons"), data);
      L.id = r.id;
    }
    // 記住剛存好的版本，之後別處再改才會提醒
    L.lastSaved = stableStr(contentOf(data));
    const saved = await getDoc(doc(db, "lessons", L.id));
    L.base = tsMillis(saved.data()?.updatedAt);
    L.saving = false;
    L.changedElsewhere = false;
    $("#ed-conflict")?.classList.add("hidden");
    if (!editWatch) openEditor(L);
    await reloadData();
    toast("已儲存 ✓");
  } catch (e) { L.saving = false; toast("儲存失敗：" + (e.code || e.message)); }
}

// =====================================================================
// 班級
// =====================================================================
async function renderClasses() {
  const root = $("#tab-classes");
  const ps = await getDocs(collection(db, "profiles"));
  const profiles = ps.docs.map((d) => ({ uid: d.id, ...d.data() }));
  root.innerHTML = `<div class="card" style="max-width:820px">
    <h2>班級</h2>
    <div class="row" style="margin-bottom:12px"><input type="text" id="cls-name" placeholder="例如：九年二班" class="grow" style="width:auto">
      <button class="btn" id="cls-add">新增班級</button></div>
    ${classes.map((c) => {
      const list = profiles.filter((p) => p.classId === c.id).sort((a, b) => a.seat - b.seat);
      return `<details class="list-item" style="display:block">
        <summary class="row" style="cursor:pointer"><b class="grow">${esc(c.name)}</b><span class="muted">${list.length} 位學生</span>
          <button class="btn danger sm" data-delcls="${c.id}">刪除班級</button></summary>
        <div style="margin-top:8px">${list.map((p) => `<div class="row small" style="padding:4px 0">
          <span style="width:3em">${p.seat} 號</span><span class="grow">${esc(p.name)} <span class="muted">${esc(p.email || "（座號登入）")}</span></span>
          <button class="btn ghost sm" data-delp="${p.uid}">移除</button></div>`).join("") || `<p class="muted small">還沒有學生登記</p>`}</div>
      </details>`;
    }).join("") || `<p class="muted">還沒有班級</p>`}
  </div>
  <div class="card" style="max-width:820px">
    <h2>新學年</h2>
    <p class="muted">清除所有學生的登記資料（班級、座號、姓名）。學生下次登入時會重新填寫。課程不會被刪除。</p>
    <button class="btn danger" id="btn-reset-year">清除所有學生資料（${profiles.length} 筆）</button>
  </div>`;
  $("#cls-add").onclick = async () => {
    const name = $("#cls-name").value.trim();
    if (!name) return;
    await addDoc(collection(db, "classes"), { name, createdAt: serverTimestamp() });
    await reloadData(); renderClasses();
  };
  root.querySelectorAll("[data-delcls]").forEach((b) => b.onclick = async (e) => {
    e.preventDefault();
    const c = classes.find((x) => x.id === b.dataset.delcls);
    if (!confirm(`刪除班級「${c.name}」？（學生資料保留，可用「新學年」清除）`)) return;
    await deleteDoc(doc(db, "classes", c.id));
    await reloadData(); renderClasses();
  });
  root.querySelectorAll("[data-delp]").forEach((b) => b.onclick = async () => {
    if (!confirm("移除這位學生的登記資料？")) return;
    await deleteDoc(doc(db, "profiles", b.dataset.delp)); renderClasses();
  });
  $("#btn-reset-year").onclick = async () => {
    if (!profiles.length) return;
    if (prompt(`確定要清除 ${profiles.length} 筆學生資料？請輸入「清除」確認`) !== "清除") return;
    for (let i = 0; i < ps.docs.length; i += 400) {
      const b = writeBatch(db);
      ps.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    toast("已清除"); renderClasses();
  };
}
