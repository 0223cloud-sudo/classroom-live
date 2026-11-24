// 隨機派題（分組配對）：純邏輯，不碰資料庫，方便測試
//
// 課程裡的一頁：{ type: "deal", prompt, cards: [{ name, versions: [...] }] }
//   name：這張題卡的名稱（公布分組時才顯示，例如課文原句）
//   versions：發給學生的各種版本（原句、白話、注釋…），同一組的人拿到不同版本
//
// 派題結果（只有老師讀得到）：groups: [{ name, uids: [...] }]
// 每位學生自己的題卡（只有本人和老師讀得到）：{ text, result }

export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 編輯器的文字 ⇄ 題卡。空一行分隔一張題卡；第一行是名稱，下面每一行是一種版本
export function parseCards(text) {
  return String(text || "").split(/\n\s*\n/)
    .map((block) => block.split("\n").map((x) => x.trim()).filter(Boolean))
    .filter((lines) => lines.length)
    .map(([name, ...versions]) => ({ name, versions: versions.length ? versions : [name] }));
}
export function cardsToText(cards) {
  return (cards || []).map((c) => [c.name, ...(c.versions || []).filter((v) => v !== c.name || (c.versions || []).length > 1)].join("\n")).join("\n\n");
}

// 把學生平均分到 groupCount 組；同一組裡的版本盡量不重複（人比版本多時才重複）
// members: [{ uid }]，回傳 { groups: [{ name, uids }], cards: { uid: text } }
export function dealCards(cards, members, groupCount, rand = Math.random) {
  const used = cards.slice(0, Math.max(1, Math.min(groupCount, cards.length)));
  const groups = used.map((c) => ({ name: c.name, uids: [] }));
  shuffle(members, rand).forEach((m, k) => groups[k % groups.length].uids.push(m.uid));
  const texts = {};
  groups.forEach((g, gi) => {
    const vs = shuffle(used[gi].versions, rand);
    g.uids.forEach((uid, k) => { texts[uid] = vs[k % vs.length]; });
  });
  return { groups, texts };
}

// 晚到的學生：補到人數最少的組，拿那一組最少人拿到的版本
export function addLate(cards, groups, uid, texts, rand = Math.random) {
  const min = Math.min(...groups.map((g) => g.uids.length));
  const cand = groups.map((g, i) => i).filter((i) => groups[i].uids.length === min);
  const gi = cand[Math.floor(rand() * cand.length)];
  const card = cards.find((c) => c.name === groups[gi].name) || { versions: [groups[gi].name] };
  const count = new Map(card.versions.map((v) => [v, 0]));
  groups[gi].uids.forEach((u) => { if (count.has(texts[u])) count.set(texts[u], count.get(texts[u]) + 1); });
  const fewest = Math.min(...count.values());
  const pool = card.versions.filter((v) => count.get(v) === fewest);
  const text = pool[Math.floor(rand() * pool.length)];
  groups[gi].uids.push(uid);
  return { group: gi, text };
}

// 學生輸入的座號：「3, 12 25」「3、12、25」都可以
export function parseSeats(str) {
  return [...new Set(String(str || "").split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n >= 1 && n <= 60))];
}

// 檢查一位學生找的組員對不對
// seatOf: uid → 座號；entered：他輸入的座號
// 回傳 { ok, wrong, missing }：wrong＝輸入了不是組員的人數，missing＝還沒找到的組員人數
export function checkMates(groups, uid, entered, seatOf) {
  const g = groups.find((x) => x.uids.includes(uid));
  if (!g) return null;
  const mySeat = seatOf(uid);
  const expect = new Set(g.uids.filter((u) => u !== uid).map(seatOf));
  const got = new Set((entered || []).filter((n) => n !== mySeat));
  const wrong = [...got].filter((n) => !expect.has(n)).length;
  const missing = [...expect].filter((n) => !got.has(n)).length;
  return { ok: wrong === 0 && missing === 0, wrong, missing };
}

// 給學生看的提示（不透露是誰）
export function resultText(r) {
  if (!r) return "";
  if (r.ok) return "🎉 配對成功！你們全組都找到了";
  const parts = [];
  if (r.wrong) parts.push(`你輸入的座號裡，有 ${r.wrong} 位不是你的組員`);
  if (r.missing) parts.push(`還有 ${r.missing} 位組員沒找到`);
  return parts.join("；") + "，再找找看！";
}
