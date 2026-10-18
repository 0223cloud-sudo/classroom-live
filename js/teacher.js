// 老師控制台
import {
  auth, db, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where,
  getDocs, onSnapshot, serverTimestamp, writeBatch, onAuthStateChanged, signOut,
  signInGoogle, isTeacher, uploadImage, resolveImage, esc, $, LETTERS,
} from "./firebase.js";
import { renderScreen } from "./projection.js";

// ---------- 共用 ----------
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2400);
}
function show(id) { ["v-loading", "v-login", "v-app"].forEach((v) => $("#" + v).classList.toggle("hidden", v !== id)); }
function loadImages(root) {
  root.querySelectorAll("img[data-img]").forEach((img) => resolveImage(img.dataset.img).then((src) => { img.src = src; }));
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

function stripActivity(a) {
  return {
    type: a.type, prompt: a.prompt || "", image: a.image || "",
    options: a.type === "choice" ? (a.options || []) : [],
    askReason: !!a.askReason, reasonLabel: a.reasonLabel || "",
  };
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
  const lesson = lessons.find((l) => l.id === $("#st-lesson").value);
  if (!cls || !lesson) return;
  if (!(lesson.activities || []).length) return toast("這個課程還沒有任何頁面");
  const btn = $("#btn-start");
  btn.disabled = true; btn.textContent = "準備中…";
  try {
    const code = await newCode();
    const session = {
      code, active: true, createdAt: serverTimestamp(),
      classId: cls.id, className: cls.name, lessonId: lesson.id, lessonTitle: lesson.title,
      index: 0, total: lesson.activities.length, activity: stripActivity(lesson.activities[0]),
      state: "answering", reveal: null, picked: [],
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

function isCorrect(r) {
  const a = currentAct();
  if (a.type !== "choice" || a.answer == null || r.choice == null) return null;
  return r.choice === a.answer;
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
      const counts = (s.activity.options || []).map((_, i) => live.responses.filter((r) => r.choice === i).length);
      if (JSON.stringify(counts) !== JSON.stringify(p.counts) || p.answered !== live.responses.length) {
        patch["projection.counts"] = counts;
        patch["projection.answered"] = live.responses.length;
      }
    }
    if (Object.keys(patch).length) await updateDoc(doc(db, "sessions", live.code), patch);
  }, 500);
}

function setProjection(mode) {
  const s = live.session;
  const proj = { mode };
  if (mode === "join") proj.joined = live.members.length;
  if (mode === "chart") {
    proj.counts = (s.activity.options || []).map((_, i) => live.responses.filter((r) => r.choice === i).length);
    proj.answered = live.responses.length;
  }
  if (mode === "answers") {
    proj.items = live.selected
      .map((uid) => live.responses.find((r) => r.uid === uid)).filter(Boolean)
      .map((r, i) => ({ label: LETTERS[i], choice: r.choice ?? null, text: r.text || "" }));
    if (!proj.items.length) return toast("請先在座位表或答案列表點選要投影的答案");
  }
  return updateDoc(doc(db, "sessions", live.code), { projection: proj });
}

async function goTo(i) {
  const acts = live.lesson.activities;
  if (i < 0 || i >= acts.length) return;
  const mode = live.session.projection?.mode === "join" ? "join" : "question";
  await updateDoc(doc(db, "sessions", live.code), {
    index: i, total: acts.length, activity: stripActivity(acts[i]),
    state: "answering", reveal: null, projection: { mode, joined: live.members.length },
  });
}

function setState(state) {
  const patch = { state };
  if (state === "revealed") {
    const a = currentAct();
    patch.reveal = { answer: a.type === "choice" && a.answer != null ? a.answer : null, explanation: a.explanation || "" };
    if (!["chart", "answers"].includes(live.session.projection?.mode)) patch.projection = { mode: "question" };
  } else {
    patch.reveal = null;
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
  if (!live.selected.includes(r.uid)) live.selected.push(r.uid);
  await updateDoc(doc(db, "sessions", live.code), { picked: [...new Set([...picked, r.uid])] });
  modal(`<div class="center"><div class="muted">抽到</div>
    <div style="font-size:3rem;font-weight:800">${r.seat} 號</div>
    ${safe ? "" : `<div style="font-size:1.4rem">${esc(r.name)}</div>`}
    <p class="muted small">已加入「並排投影」的選取中</p>
    <button class="btn" onclick="this.closest('.modal').remove()">好</button></div>`);
  renderLiveBody();
}

function detail(seat) {
  const m = live.members.find((x) => x.seat === seat);
  const r = m && live.responses.find((x) => x.uid === m.uid);
  const a = live.session.activity;
  modal(`<h2>${seat} 號 ${esc(m?.name || live.roster.find((x) => x.seat === seat)?.name || "")}</h2>
    ${!m ? `<p class="muted">還沒有加入這堂課</p>` : !r ? `<p class="muted">已加入，這一頁還沒作答</p>` : `
      ${r.choice != null ? `<p><b>${LETTERS[r.choice]}. ${esc(a.options[r.choice])}</b>
        ${isCorrect(r) === true ? `<span class="tag ok">對</span>` : isCorrect(r) === false ? `<span class="tag bad">錯</span>` : ""}</p>` : ""}
      ${r.text ? `<p style="white-space:pre-wrap">${esc(r.text)}</p>` : ""}`}
    <button class="btn" onclick="this.closest('.modal').remove()">關閉</button>`);
}

function renderLiveBody() {
  const root = $("#tab-live");
  if (!live.code || !live.session) return;
  const s = live.session, a = s.activity || {}, act = currentAct();
  const isQ = a.type !== "slide";
  const mode = s.projection?.mode || "question";

  // ---- 座位表 ----
  const bySeat = new Map(live.members.map((m) => [m.seat, m]));
  const respByUid = new Map(live.responses.map((r) => [r.uid, r]));
  const maxSeat = Math.max(35, ...live.members.map((m) => m.seat), ...live.roster.map((r) => r.seat));
  let cells = "";
  const missing = [];
  for (let n = 1; n <= maxSeat; n++) {
    const m = bySeat.get(n);
    const rosterName = live.roster.find((x) => x.seat === n)?.name || "";
    let cls = "absent", name = rosterName;
    if (m) {
      name = m.name;
      const r = respByUid.get(m.uid);
      if (!isQ) cls = "";
      else if (!r) { cls = "joined"; missing.push(n); }
      else {
        const ok = isCorrect(r);
        cls = safe || ok === null ? "answered" : ok ? "correct" : "wrong";
        if (live.selected.includes(m.uid)) cls += " selected";
      }
      if ((s.picked || []).includes(m.uid)) cls += " picked";
    }
    cells += `<div class="seat ${cls}" data-seat="${n}"><span class="no">${n}</span>${safe || !name ? "" : `<span class="nm">${esc(name)}</span>`}</div>`;
  }

  // ---- 答案列表 ----
  const resps = [...live.responses].sort((x, y) => x.seat - y.seat);
  const ansList = resps.map((r) => {
    const ok = isCorrect(r);
    const sel = live.selected.indexOf(r.uid);
    return `<div class="ans ${sel >= 0 ? "selected" : ""}" data-uid="${r.uid}">
      <div class="meta">${sel >= 0 ? `<b>想法 ${LETTERS[sel]}</b>　` : ""}${safe ? "" : `${r.seat} 號 ${esc(r.name)}`}
        ${!safe && ok === true ? `<span class="tag ok">對</span>` : ""}${!safe && ok === false ? `<span class="tag bad">錯</span>` : ""}</div>
      ${r.choice != null ? `<div><b>${LETTERS[r.choice]}. ${esc(a.options[r.choice])}</b></div>` : ""}
      ${r.text ? `<div class="txt">${esc(r.text)}</div>` : ""}</div>`;
  }).join("");

  // ---- 長條圖（老師自己看）----
  const counts = (a.options || []).map((_, i) => live.responses.filter((r) => r.choice === i).length);
  const maxC = Math.max(1, ...counts);
  const bars = a.type === "choice" ? `<div class="bars" style="margin-top:12px">${(a.options || []).map((o, i) => `
    <div class="bar-row"><b>${LETTERS[i]}</b><div><div class="bar ${!safe && act.answer === i ? "ok" : ""}" style="width:${counts[i] / maxC * 100}%"></div></div><span>${counts[i]}</span></div>`).join("")}</div>` : "";

  const stateTag = !isQ ? `<span class="tag">投影片</span>` :
    s.state === "answering" ? `<span class="tag">作答中</span>` :
    s.state === "locked" ? `<span class="tag wait">已停止作答</span>` : `<span class="tag ok">已公布</span>`;
  const projBtn = (m, label) => `<button class="btn secondary sm ${mode === m ? "on" : ""}" data-proj="${m}">${label}</button>`;

  root.innerHTML = `
    <div class="live-head">
      <span class="progress">第 ${s.index + 1} / ${s.total} 頁</span> ${stateTag}
      <span class="muted">${esc(s.className)}・${esc(s.lessonTitle)}・代碼 <b>${esc(s.code)}</b></span>
      <span class="grow"></span>
      <button class="btn ghost sm" id="btn-prev" ${s.index === 0 ? "disabled" : ""}>◀ 上一頁</button>
      <button class="btn sm" id="btn-next" ${s.index + 1 >= s.total ? "disabled" : ""}>下一頁 ▶</button>
    </div>
    <div class="live">
      <div>
        <div class="card mini-q">
          <div class="prompt">${esc(a.prompt)}</div>
          ${a.image ? `<img data-img="${esc(a.image)}" alt="" style="margin-top:8px">` : ""}
          ${(a.options || []).length ? `<div class="small" style="margin-top:8px">${a.options.map((o, i) =>
            `<span class="tag ${!safe && act.answer === i ? "ok" : ""}" style="margin:2px">${LETTERS[i]}. ${esc(o)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="card">
          <div class="row" style="margin-bottom:10px">
            <b>已加入 ${live.members.length} 人</b>
            ${isQ ? `<b>・已作答 ${live.responses.length} 人</b>` : ""}
            ${isQ && missing.length ? `<span class="muted small">未作答：${missing.join("、")}</span>` : ""}
          </div>
          <div class="seats">${cells}</div>
          <div class="legend">
            <span><i style="border-color:var(--idle);border-style:dashed"></i>未加入</span>
            ${isQ ? `<span><i style="border-color:var(--wait);background:var(--wait-soft)"></i>未作答</span>
            <span><i style="border-color:var(--accent);background:var(--accent-soft)"></i>已作答</span>
            ${safe ? "" : `<span><i style="border-color:var(--ok);background:var(--ok-soft)"></i>答對</span>
            <span><i style="border-color:var(--bad);background:var(--bad-soft)"></i>答錯</span>`}` : ""}
            <span>點一下：選取投影｜長按：看答案｜★ 被抽過</span>
          </div>
        </div>
      </div>
      <div class="panel">
        ${isQ ? `<div class="card">
          <h3>作答</h3>
          <div class="ctrl-grid">
            ${s.state === "answering"
              ? `<button class="btn" data-state="locked">停止作答</button>`
              : `<button class="btn secondary" data-state="answering">重新開放作答</button>`}
            ${s.state === "revealed"
              ? `<button class="btn ghost" data-state="locked">收回答案</button>`
              : `<button class="btn ok" data-state="revealed">公布答案</button>`}
          </div>
          ${bars}
        </div>` : ""}
        <div class="card">
          <h3>大螢幕顯示</h3>
          <div class="row">
            ${projBtn("join", "加入 QR")}
            ${projBtn("question", "題目")}
            ${a.type === "choice" ? projBtn("chart", "統計圖") : ""}
            ${isQ ? projBtn("answers", `並排答案（${live.selected.length}）`) : ""}
            ${projBtn("blank", "遮蔽")}
          </div>
          <div class="row" style="margin-top:10px">
            <button class="btn ghost sm" id="btn-embed">📺 在這台 iPad 切到投影畫面</button>
            <button class="btn ghost sm" id="btn-screen-link">投影電腦網址</button>
          </div>
        </div>
        ${isQ ? `<div class="card">
          <h3>挑答案討論 <span class="muted small">（選了 ${live.selected.length} 份）</span></h3>
          <div class="row" style="margin-bottom:10px">
            <button class="btn secondary sm" id="btn-pick">🎲 隨機抽一位</button>
            ${a.type === "choice" && act.answer != null ? `<button class="btn secondary sm" id="btn-pick-wrong">🎲 從答錯的抽</button>` : ""}
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
  root.querySelectorAll("[data-state]").forEach((b) => b.onclick = () => setState(b.dataset.state));
  root.querySelectorAll("[data-proj]").forEach((b) => b.onclick = () => setProjection(b.dataset.proj));
  $("#btn-prev").onclick = () => goTo(s.index - 1);
  $("#btn-next").onclick = () => goTo(s.index + 1);
  $("#btn-embed").onclick = openEmbed;
  $("#btn-screen-link").onclick = () => {
    const url = new URL("screen.html", location.href).href;
    modal(`<h2>投影電腦</h2><p>在教室電腦打開這個網址，用同一個老師帳號登入，畫面會自動跟著這堂課：</p>
      <p style="word-break:break-all"><b>${esc(url)}</b></p>
      <button class="btn" onclick="this.closest('.modal').remove()">好</button>`);
  };
  const pick = $("#btn-pick"); if (pick) pick.onclick = () => randomPick(false);
  const pw = $("#btn-pick-wrong"); if (pw) pw.onclick = () => randomPick(true);
  const cs = $("#btn-clear-sel"); if (cs) cs.onclick = () => { live.selected = []; renderLiveBody(); };
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
  const root = $("#tab-lessons");
  root.innerHTML = `<div class="card" style="max-width:820px">
    <div class="row" style="margin-bottom:10px"><h2 class="grow" style="margin:0">我的課程</h2>
      <button class="btn sm" id="btn-new-lesson">＋ 新增課程</button>
      <button class="btn secondary sm" id="btn-library">📚 課程庫</button>
      <button class="btn ghost sm" id="btn-import">貼上 JSON</button></div>
    ${lessons.length ? lessons.map((l) => `<div class="list-item">
      <div class="grow"><b>${esc(l.title)}</b> <span class="muted small">${(l.activities || []).length} 頁</span></div>
      <button class="btn secondary sm" data-edit="${l.id}">編輯</button>
      <button class="btn ghost sm" data-copy="${l.id}">複製</button>
      <button class="btn danger sm" data-del="${l.id}">刪除</button></div>`).join("") : `<p class="muted">還沒有課程</p>`}
  </div>`;
  $("#btn-new-lesson").onclick = () => openEditor({ id: null, title: "新課程", activities: [] });
  $("#btn-import").onclick = importLesson;
  $("#btn-library").onclick = openLibrary;
  root.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    const l = lessons.find((x) => x.id === b.dataset.edit);
    openEditor(JSON.parse(JSON.stringify({ id: l.id, title: l.title, activities: l.activities || [] })));
  });
  root.querySelectorAll("[data-copy]").forEach((b) => b.onclick = async () => {
    const l = lessons.find((x) => x.id === b.dataset.copy);
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

function importData(data) {
  if (!Array.isArray(data.activities)) throw new Error("缺少 activities");
  openEditor({ id: null, title: data.title || "匯入的課程", activities: data.activities });
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
      importData(data);
    });
  } catch (e) { $("#lib-list", m).textContent = "讀取課程庫失敗：" + e.message; }
}

function importLesson() {
  const m = modal(`<h2>匯入課程 JSON</h2>
    <p class="muted small">把 Claude 幫你產生的課程內容整段貼進來。</p>
    <textarea id="imp-text" style="min-height:240px;font-family:monospace;font-size:.85rem"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="imp-ok">匯入</button>
    <button class="btn ghost" id="imp-cancel">取消</button></div>`);
  $("#imp-cancel", m).onclick = () => m.remove();
  $("#imp-ok", m).onclick = () => {
    try {
      const data = JSON.parse($("#imp-text", m).value);
      m.remove();
      importData(data);
    } catch (e) { toast("格式不正確：" + e.message); }
  };
}

function openEditor(lesson) { editing = lesson; renderEditor(); }

const TYPE_NAMES = { slide: "投影片（只展示）", choice: "選擇題", text: "簡答題" };

function renderEditor() {
  const root = $("#tab-lessons");
  const L = editing;
  root.innerHTML = `<div style="max-width:820px">
    <div class="card">
      <div class="row"><button class="btn ghost sm" id="ed-back">← 返回</button><span class="grow"></span>
        <button class="btn secondary sm" id="ed-export">匯出 JSON</button>
        <button class="btn sm" id="ed-save">儲存</button></div>
      <label class="field" style="margin-top:12px"><span>課程名稱</span><input type="text" id="ed-title" value="${esc(L.title)}"></label>
    </div>
    <div id="ed-acts">${L.activities.map((a, i) => actEditor(a, i)).join("")}</div>
    <div class="card row">
      <span class="muted">新增一頁：</span>
      <button class="btn secondary sm" data-add="slide">＋ 投影片</button>
      <button class="btn secondary sm" data-add="choice">＋ 選擇題</button>
      <button class="btn secondary sm" data-add="text">＋ 簡答題</button>
    </div></div>`;
  loadImages(root);

  $("#ed-title").oninput = (e) => { L.title = e.target.value; };
  $("#ed-back").onclick = () => { if (confirm("離開編輯？沒儲存的修改會不見。")) { editing = null; renderLessonList(); } };
  $("#ed-save").onclick = saveLesson;
  $("#ed-export").onclick = () => {
    modal(`<h2>課程 JSON</h2><textarea style="min-height:300px;font-family:monospace;font-size:.8rem">${esc(JSON.stringify({ title: L.title, activities: L.activities }, null, 2))}</textarea>
      <button class="btn" style="margin-top:10px" onclick="this.closest('.modal').remove()">關閉</button>`);
  };
  root.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
    const t = b.dataset.add;
    L.activities.push(t === "choice"
      ? { type: "choice", prompt: "", options: ["", "", "", ""], answer: null, askReason: true, explanation: "" }
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
        else if (f === "answer") a.answer = inp.value === "" ? null : Number(inp.value);
        else if (f === "askReason") a.askReason = inp.checked;
        else if (f === "type") { a.type = inp.value; if (a.type === "choice" && !a.options) a.options = ["", "", "", ""]; renderEditor(); }
        else a[f] = inp.value;
        if (f === "options") {
          // 選項改了，答案下拉選單跟著更新
          const sel = el.querySelector("[data-f=answer]");
          if (sel) sel.innerHTML = answerOptions(a);
        }
      });
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
    if (a.type !== "slide") o.explanation = a.explanation || "";
    return o;
  });
  const data = { title: L.title || "未命名課程", activities: acts, updatedAt: serverTimestamp() };
  try {
    if (L.id) await setDoc(doc(db, "lessons", L.id), data);
    else { const r = await addDoc(collection(db, "lessons"), data); L.id = r.id; }
    await reloadData();
    toast("已儲存 ✓");
  } catch (e) { toast("儲存失敗：" + (e.code || e.message)); }
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
