// 學生端
import {
  auth, db, doc, getDoc, setDoc, collection, getDocs, onSnapshot, serverTimestamp,
  onAuthStateChanged, signOut, signInGoogle, signInSeat, resolveImage, esc, $, LETTERS,
} from "./firebase.js";
import { ALLOW_SEAT_LOGIN } from "./config.js";
import { initTextSize } from "./textsize.js";

initTextSize("student", document.getElementById("textsize-mount"), { baseWidth: 1000, min: 1.15 });

const views = ["v-loading", "v-login", "v-profile", "v-code", "v-activity"];
function show(id) { views.forEach((v) => $("#" + v).classList.toggle("hidden", v !== id)); }
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
}
function err(el, msg) { el.textContent = msg; el.classList.toggle("hidden", !msg); }

let user = null;
let profile = null;
let code = (new URLSearchParams(location.search).get("s") || localStorage.getItem("lastCode") || "").toUpperCase();
let unsubSession = null;
let session = null;
let renderKey = "";
let mine = null;     // 我這一題已送出的答案
let draft = { choice: null, text: "" };

if (ALLOW_SEAT_LOGIN) $("#seat-login").classList.remove("hidden");

// ---- 登入 ----
$("#btn-google").onclick = async () => {
  err($("#login-err"), "");
  try { await signInGoogle(); }
  catch (e) { err($("#login-err"), "登入失敗：" + (e.code || e.message) + "。可以改用座號進入。"); }
};
$("#btn-seat").onclick = async () => {
  try { await signInSeat(); }
  catch (e) { err($("#login-err"), "進入失敗：" + (e.code || e.message)); }
};
$("#btn-logout").onclick = async () => {
  if (unsubSession) unsubSession();
  await signOut(auth);
};
$("#btn-edit").onclick = () => openProfile();

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) { $("#topbar").classList.add("hidden"); show("v-login"); return; }
  show("v-loading");
  const snap = await getDoc(doc(db, "profiles", u.uid));
  profile = snap.exists() ? snap.data() : null;
  if (!profile || !profile.classId) return openProfile();
  afterProfile();
});

// ---- 基本資料 ----
async function openProfile() {
  show("v-profile");
  err($("#pf-err"), "");
  const sel = $("#pf-class");
  sel.innerHTML = `<option value="">載入中…</option>`;
  const qs = await getDocs(collection(db, "classes"));
  const classes = qs.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hant"));
  if (!classes.length) {
    sel.innerHTML = `<option value="">（老師還沒建立班級）</option>`;
  } else {
    sel.innerHTML = `<option value="">請選擇班級</option>` +
      classes.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  }
  if (profile) {
    sel.value = profile.classId || "";
    $("#pf-seat").value = profile.seat || "";
    $("#pf-name").value = profile.name || "";
  } else if (user?.displayName) {
    $("#pf-name").value = user.displayName;
  }
}

$("#btn-save-profile").onclick = async () => {
  const sel = $("#pf-class");
  const classId = sel.value;
  const seat = parseInt($("#pf-seat").value, 10);
  const name = $("#pf-name").value.trim();
  if (!classId) return err($("#pf-err"), "請選擇班級");
  if (!(seat >= 1 && seat <= 35)) return err($("#pf-err"), "座號請填 1～35");
  if (!name) return err($("#pf-err"), "請填姓名");
  profile = {
    classId, className: sel.options[sel.selectedIndex].text, seat, name,
    email: user.email || "", updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, "profiles", user.uid), profile);
    afterProfile();
  } catch (e) { err($("#pf-err"), "儲存失敗：" + (e.code || e.message)); }
};

function afterProfile() {
  $("#topbar").classList.remove("hidden");
  $("#who").textContent = `${profile.className} ${profile.seat} 號 ${profile.name}`;
  if (code) join(code); else { show("v-code"); }
}

// ---- 加入課堂 ----
$("#btn-join").onclick = () => join($("#code-input").value.trim().toUpperCase());
$("#code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-join").click(); });

async function join(c) {
  err($("#code-err"), "");
  if (!c) { show("v-code"); return; }
  show("v-loading");
  const snap = await getDoc(doc(db, "sessions", c)).catch(() => null);
  if (!snap || !snap.exists() || !snap.data().active) {
    localStorage.removeItem("lastCode"); code = "";
    show("v-code"); $("#code-input").value = c;
    return err($("#code-err"), "找不到這個課堂，請確認代碼，或等老師開始上課。");
  }
  const s = snap.data();
  if (s.classId !== profile.classId) {
    show("v-code"); $("#code-input").value = c;
    return err($("#code-err"), `這是「${s.className}」的課堂，你的班級是「${profile.className}」。如果班級填錯，請按上方「修改資料」。`);
  }
  code = c;
  localStorage.setItem("lastCode", c);
  history.replaceState(null, "", `?s=${c}`);
  await setDoc(doc(db, "sessions", c, "members", user.uid), {
    uid: user.uid, seat: profile.seat, name: profile.name, joinedAt: serverTimestamp(),
  });
  if (unsubSession) unsubSession();
  renderKey = "";
  unsubSession = onSnapshot(doc(db, "sessions", c), (d) => {
    session = d.data();
    if (!session || !session.active) {
      unsubSession(); unsubSession = null; localStorage.removeItem("lastCode"); code = "";
      $("#act-card").innerHTML = `<h2>這堂課已經結束 👋</h2><p class="muted">謝謝參與！</p>`;
      show("v-activity");
      return;
    }
    onSession();
  });
}

async function onSession() {
  const s = session;
  const key = `${s.index}|${s.state}|${JSON.stringify(s.reveal || null)}|${JSON.stringify(s.activity || null)}`;
  if (key === renderKey) return;
  const indexChanged = !renderKey || renderKey.split("|")[0] !== String(s.index);
  renderKey = key;
  if (indexChanged) {
    mine = null; draft = { choice: null, text: "", match: [], multi: [] };
    const r = await getDoc(doc(db, "sessions", code, "responses", `${user.uid}_${s.index}`)).catch(() => null);
    if (r && r.exists()) {
      mine = r.data();
      draft = { choice: mine.choice ?? null, text: mine.text || "", match: mine.match || [], multi: mine.multi || [] };
    }
  }
  render();
  show("v-activity");
}

// ---- 作答畫面 ----
function render() {
  const s = session, a = s.activity || {};
  const card = $("#act-card");
  const open = s.state === "answering";
  const revealed = s.state === "revealed";
  const ans = revealed ? s.reveal?.answer : null;
  const hasOptions = a.type === "choice" && (a.options || []).length;
  const isMatch = a.type === "match";
  const isMulti = a.type === "multi" && (a.options || []).length;
  const correctSet = revealed ? s.reveal?.answers || [] : [];
  const needText = a.type === "text" || ((a.type === "choice" || isMatch || a.type === "multi") && a.askReason);

  let html = `<div class="muted small">第 ${s.index + 1} / ${s.total} 頁</div>
    <div class="prompt">${esc(a.prompt)}</div>
    ${a.image ? `<div class="q-image"><img data-img="${esc(a.image)}" alt=""></div>` : ""}`;

  if (a.type === "slide") {
    html += `<div class="status-bar info">請看老師的投影 👀</div>`;
    card.innerHTML = html;
    loadImages(card);
    return;
  }

  if (hasOptions) {
    html += `<div class="options">${a.options.map((o, i) => {
      let cls = draft.choice === i ? "selected" : "";
      if (revealed && ans === i) cls = "correct";
      else if (revealed && draft.choice === i && ans != null) cls = "wrong";
      return `<button class="opt ${cls}" data-i="${i}" ${open ? "" : "disabled"}><span class="letter">${LETTERS[i]}</span>${esc(o)}</button>`;
    }).join("")}</div>`;
  }
  if (isMulti) {
    html += `<div class="muted small" style="margin-top:10px">可以選很多個，點一下選取，再點一下取消</div>
      <div class="options">${a.options.map((o, i) => {
      const on = draft.multi.includes(i);
      let cls = on ? "selected" : "";
      if (revealed && correctSet.length) cls = correctSet.includes(i) ? "correct" : on ? "wrong" : "";
      const tag = revealed && correctSet.includes(i) && !on ? `<span class="small" style="margin-left:auto">漏選</span>` : "";
      return `<button class="opt ${cls}" data-mi="${i}" ${open ? "" : "disabled"}><span class="letter">${on ? "✓" : LETTERS[i]}</span>${esc(o)}${tag}</button>`;
    }).join("")}</div>`;
  }
  if (isMatch) {
    const pairs = revealed ? s.reveal?.pairs || [] : [];
    html += `<div class="card" style="padding:6px 14px;margin:14px 0">${(a.left || []).map((l, i) => {
      const pick = draft.match[i] || "";
      const st = revealed && pairs[i] ? (pick === pairs[i] ? "ok" : "bad") : "";
      return `<div class="match-row ${st}"><span class="l">${esc(l)}</span>
        <select data-m="${i}" ${open ? "" : "disabled"}><option value="">請選擇…</option>
          ${(a.choices || []).map((c) => `<option ${c === pick ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        ${st === "bad" ? `<span class="fix">正確：${esc(pairs[i])}</span>` : ""}</div>`;
    }).join("")}</div>`;
  }
  if (needText) {
    const label = a.type === "text" ? "你的答案" : (a.reasonLabel || "你是怎麼判斷的？");
    html += `<label class="field"><span>${esc(label)}</span>
      <textarea id="ans-text" ${open ? "" : "disabled"} placeholder="寫下你的想法…">${esc(draft.text)}</textarea></label>`;
  }

  if (open) {
    html += `<button class="btn big" id="btn-submit">${mine ? "更新答案" : "送出"}</button>`;
    html += mine ? `<div class="status-bar ok">✓ 已送出，老師停止作答前都可以修改</div>` : "";
  } else if (!revealed) {
    html += mine ? `<div class="status-bar wait">老師已停止作答，等待討論</div>`
                 : `<div class="status-bar bad">老師已停止作答（你這題沒有送出）</div>`;
  } else {
    if (hasOptions && ans != null) {
      html += mine?.choice === ans ? `<div class="status-bar ok">🎉 答對了！</div>`
            : `<div class="status-bar bad">正確答案是 ${LETTERS[ans]}. ${esc(a.options[ans])}</div>`;
    } else if (isMulti && correctSet.length) {
      const sel = mine?.multi || [];
      const hits = sel.filter((i) => correctSet.includes(i)).length, wrong = sel.length - hits;
      html += hits === correctSet.length && !wrong ? `<div class="status-bar ok">🎉 全部選對了！</div>`
            : `<div class="status-bar bad">選對 ${hits} / ${correctSet.length} 個${wrong ? `，多選了 ${wrong} 個` : ""}（綠色是正確答案）</div>`;
    } else if (isMatch && (s.reveal?.pairs || []).length) {
      const pairs = s.reveal.pairs, ok = pairs.filter((p, i) => (mine?.match || [])[i] === p).length;
      html += ok === pairs.length ? `<div class="status-bar ok">🎉 全部配對正確！</div>`
            : `<div class="status-bar bad">答對 ${ok} / ${pairs.length} 組，紅色的是要訂正的</div>`;
    } else {
      html += `<div class="status-bar info">老師公布答案了</div>`;
    }
    if (s.reveal?.explanation) html += `<div class="explain">${esc(s.reveal.explanation)}</div>`;
  }

  card.innerHTML = html;
  loadImages(card);

  card.querySelectorAll(".opt").forEach((b) => b.onclick = () => {
    draft.choice = Number(b.dataset.i);
    card.querySelectorAll(".opt").forEach((x) => x.classList.toggle("selected", x === b));
  });
  card.querySelectorAll("[data-mi]").forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.mi);
    draft.multi = draft.multi.includes(i) ? draft.multi.filter((x) => x !== i) : [...draft.multi, i].sort((x, y) => x - y);
    const on = draft.multi.includes(i);
    b.classList.toggle("selected", on);
    b.querySelector(".letter").textContent = on ? "✓" : LETTERS[i];
  });
  card.querySelectorAll("select[data-m]").forEach((sel) => sel.onchange = () => {
    draft.match[Number(sel.dataset.m)] = sel.value;
  });
  const ta = $("#ans-text");
  if (ta) ta.oninput = () => { draft.text = ta.value; };
  const sb = $("#btn-submit");
  if (sb) sb.onclick = () => submit(hasOptions, needText);
}

function loadImages(root) {
  root.querySelectorAll("img[data-img]").forEach((img) => resolveImage(img.dataset.img).then((src) => { img.src = src; }));
}

async function submit(hasOptions, needText) {
  const s = session;
  if (hasOptions && draft.choice == null) return toast("請先選一個答案");
  const isMatch = s.activity.type === "match";
  const isMulti = s.activity.type === "multi";
  if (isMulti && !draft.multi.length) return toast("請至少選一個");
  if (isMatch && (s.activity.left || []).some((_, i) => !draft.match[i])) return toast("每一個都要配對喔");
  if (needText && !draft.text.trim()) return toast(s.activity.type === "text" ? "請寫下你的答案" : "請寫下你的判斷理由");
  const data = {
    uid: user.uid, index: s.index, seat: profile.seat, name: profile.name,
    choice: hasOptions ? draft.choice : null, text: needText ? draft.text.trim() : "",
    ...(isMatch ? { match: (s.activity.left || []).map((_, i) => draft.match[i] || "") } : {}),
    ...(isMulti ? { multi: [...draft.multi] } : {}),
    at: serverTimestamp(),
  };
  const btn = $("#btn-submit"); btn.disabled = true;
  try {
    await setDoc(doc(db, "sessions", code, "responses", `${user.uid}_${s.index}`), data);
    mine = data;
    toast("已送出 ✓");
    render();
  } catch (e) {
    btn.disabled = false;
    toast("送出失敗，可能老師已停止作答");
  }
}
