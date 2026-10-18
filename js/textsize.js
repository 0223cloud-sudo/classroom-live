// 字體大小（A− / A+）：預設依視窗寬度自動放大；按過按鈕後，這台裝置就記住手動設定
const STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.25, 2.5];

// baseWidth：介面原本設計的寬度；視窗比它寬幾倍，就放大幾倍
export function initTextSize(key, mount, { baseWidth = 1200, min = 1.15 } = {}) {
  const storeKey = "textScale2:" + key;
  let manual = null;
  try { manual = Number(localStorage.getItem(storeKey)) || null; } catch (e) { /* 無法讀取就用自動 */ }
  let label = null;

  const autoScale = () => {
    const want = Math.max(min, Math.min(2.5, window.innerWidth / baseWidth));
    return STEPS.filter((s) => s <= want + 0.001).pop() || min;
  };
  const current = () => manual || autoScale();
  const apply = () => {
    const scale = current();
    document.documentElement.style.zoom = scale;
    if (label) label.textContent = Math.round(scale * 100) + "%" + (manual ? "" : " 自動");
  };
  const step = (dir) => {
    const scale = current();
    let i = STEPS.findIndex((s) => Math.abs(s - scale) < 0.01);
    if (i < 0) i = Math.max(0, STEPS.findIndex((s) => s > scale) - 1);
    manual = STEPS[Math.max(0, Math.min(STEPS.length - 1, i + dir))];
    try { localStorage.setItem(storeKey, String(manual)); } catch (e) { /* 存不了也沒關係 */ }
    apply();
  };

  if (mount) {
    const box = document.createElement("span");
    box.className = "textsize";
    box.innerHTML = `<button class="btn ghost sm" type="button" title="字變小">A−</button>
      <button class="btn ghost sm" type="button" title="點一下恢復自動大小" style="min-width:70px"></button>
      <button class="btn ghost sm" type="button" title="字變大">A+</button>`;
    const [minus, mid, plus] = box.querySelectorAll("button");
    label = mid;
    minus.onclick = () => step(-1);
    plus.onclick = () => step(1);
    mid.onclick = () => {
      manual = null;
      try { localStorage.removeItem(storeKey); } catch (e) { /* 忽略 */ }
      apply();
    };
    mount.appendChild(box);
  }
  // 視窗大小改變（例如 iPad 轉向、視窗拉大）時，自動模式會跟著調整
  window.addEventListener("resize", () => { if (!manual) apply(); });
  apply();
}
