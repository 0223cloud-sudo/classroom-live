// 投影畫面：screen.html 與老師控制台的「切到投影畫面」共用
import { esc, resolveImage, studentUrl, LETTERS } from "./firebase.js";

export function qrSvg(text) {
  // qrcode-generator（由 <script> 載入成全域變數 qrcode）
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

export async function renderScreen(root, s) {
  if (!s) {
    root.innerHTML = `<div class="screen-body s-blank"><div class="big">等待老師開始上課…</div></div>`;
    return;
  }
  const p = s.projection || { mode: "question" };
  const a = s.activity || {};
  const top = `<div class="screen-top"><span>${esc(s.className)}・${esc(s.lessonTitle)}</span>
    <span>課堂代碼 <b>${esc(s.code)}</b>・第 ${s.index + 1} / ${s.total} 頁</span></div>`;
  let body = "";

  if (p.mode === "join") {
    const url = studentUrl(s.code);
    body = `<div class="s-join">
      <div class="qr">${qrSvg(url)}</div>
      <div>
        <div style="font-size:1.2em;font-weight:700">掃描 QR Code 加入</div>
        <div class="muted" style="font-size:.7em;margin:.4em 0 1em;word-break:break-all">${esc(url)}</div>
        <div class="muted" style="font-size:.8em">或輸入課堂代碼</div>
        <div class="s-code">${esc(s.code)}</div>
        <div style="margin-top:.6em">已加入 <b>${p.joined ?? 0}</b> 人</div>
      </div></div>`;
  } else if (p.mode === "blank") {
    body = `<div class="s-blank"><div class="big">${esc(s.lessonTitle)}</div><div>請看老師 👀</div></div>`;
  } else if (p.mode === "chart" && a.type === "match") {
    const counts = p.counts || [];
    const n = Math.max(1, p.answered || 0);
    body = `<div class="s-prompt">${esc(a.prompt)}</div>
      <div class="muted" style="font-size:.7em;margin-bottom:.4em">每一組答對的人數</div>
      <div class="s-bars">${(a.left || []).map((l, i) => `
        <div class="s-bar-row"><b>${esc(l)}</b>
          <div><div class="s-bar ok" style="width:${(counts[i] || 0) / n * 100}%"></div></div>
          <b>${counts[i] || 0}</b></div>`).join("")}
      </div>
      <div class="muted" style="margin-top:.6em;font-size:.75em">已作答 ${p.answered ?? 0} 人</div>`;
  } else if (p.mode === "chart") {
    const counts = p.counts || [];
    const max = Math.max(1, ...counts);
    const ans = s.state === "revealed" ? s.reveal?.answer : null;
    const ansSet = s.state === "revealed" ? s.reveal?.answers || [] : [];
    body = `<div class="s-prompt">${esc(a.prompt)}</div>
      ${a.type === "multi" ? `<div class="muted" style="font-size:.7em;margin-bottom:.4em">每個選項被選的人數（複選）</div>` : ""}
      <div class="s-bars">${(a.options || []).map((o, i) => `
        <div class="s-bar-row"><b>${LETTERS[i]}. ${esc(o)}</b>
          <div><div class="s-bar ${ans === i || ansSet.includes(i) ? "ok" : ""}" style="width:${(counts[i] || 0) / max * 100}%"></div></div>
          <b>${counts[i] || 0}</b></div>`).join("")}
      </div>
      <div class="muted" style="margin-top:.6em;font-size:.75em">已作答 ${p.answered ?? 0} 人</div>`;
  } else if (p.mode === "answers") {
    const items = p.items || [];
    body = `<div class="s-prompt" style="font-size:1.1em">${esc(a.prompt)}</div>
      ${items.length ? `<div class="s-cards">${items.map((it) => `
        <div class="s-card"><div class="lbl">想法 ${esc(it.label)}</div>
          ${it.choice != null && a.options ? `<div class="ch">${LETTERS[it.choice]}. ${esc(a.options[it.choice])}</div>` : ""}
          ${it.multi ? `<div class="ch">${it.multi.map((k) => `${LETTERS[k]}. ${esc((a.options || [])[k])}`).join("、") || "（沒有選）"}</div>` : ""}
          ${it.pairs ? (a.left || []).map((l, k) => `<div class="pair">${esc(l)} → <b>${esc(it.pairs[k] || "？")}</b></div>`).join("") : ""}
          ${it.text ? `<div class="txt">${esc(it.text)}</div>` : ""}
        </div>`).join("")}</div>` : `<div class="muted">（老師還沒有挑選答案）</div>`}`;
  } else {
    // question
    const revealed = s.state === "revealed";
    const ans = revealed ? s.reveal?.answer : null;
    const ansSet = revealed ? s.reveal?.answers || [] : [];
    const opts = (a.options || []).length
      ? `${a.type === "multi" ? `<div class="muted" style="font-size:.65em">（可以選很多個）</div>` : ""}<div class="s-opts">${a.options.map((o, i) => `
          <div class="s-opt ${ans === i || ansSet.includes(i) ? "correct" : ""}"><span class="letter">${LETTERS[i]}</span>${esc(o)}</div>`).join("")}</div>`
      : "";
    let match = "";
    if (a.type === "match") {
      const pairs = revealed ? s.reveal?.pairs || [] : [];
      match = `<div class="s-match">${(a.left || []).map((l, i) => `
          <div class="s-match-row ${pairs[i] ? "ok" : ""}"><b>${esc(l)}</b><span>→</span><b>${pairs[i] ? esc(pairs[i]) : "？"}</b></div>`).join("")}</div>
        ${revealed ? "" : `<div class="s-pool">${(a.choices || []).map((c) => `<span>${esc(c)}</span>`).join("")}</div>`}`;
    }
    const explain = revealed && s.reveal?.explanation
      ? `<div class="s-explain">${esc(s.reveal.explanation)}</div>` : "";
    const stateTag = a.type === "slide" ? "" :
      s.state === "answering" ? `<span class="tag">作答中</span>` :
      s.state === "locked" ? `<span class="tag wait">已停止作答</span>` : `<span class="tag ok">公布答案</span>`;
    const side = `<div class="s-prompt">${esc(a.prompt)}</div><div style="font-size:.6em">${stateTag}</div>${opts}${match}${explain}`;
    body = a.image
      ? `<div class="s-split"><div class="s-img"><img data-img="${esc(a.image)}" alt=""></div><div class="s-side">${side}</div></div>`
      : `<div>${side}</div>`;
  }

  root.innerHTML = `${top}<div class="screen-body">${body}</div>`;
  for (const img of root.querySelectorAll("img[data-img]")) {
    resolveImage(img.dataset.img).then((src) => { img.src = src; });
  }
}
