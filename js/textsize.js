// 字體大小（A− / A+）：每台裝置各自記住，整個畫面一起放大縮小
const STEPS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

export function initTextSize(key, mount, defaultScale = 1) {
  const storeKey = "textScale:" + key;
  let scale = defaultScale;
  try { scale = Number(localStorage.getItem(storeKey)) || defaultScale; } catch (e) { /* 無法讀取就用預設值 */ }

  const apply = () => {
    document.documentElement.style.zoom = scale;
    try { localStorage.setItem(storeKey, String(scale)); } catch (e) { /* 存不了也沒關係 */ }
    if (label) label.textContent = Math.round(scale * 100) + "%";
  };
  const step = (dir) => {
    let i = STEPS.findIndex((s) => Math.abs(s - scale) < 0.01);
    if (i < 0) i = STEPS.findIndex((s) => s > scale) - 1;
    scale = STEPS[Math.max(0, Math.min(STEPS.length - 1, i + dir))];
    apply();
  };

  let label = null;
  if (mount) {
    const box = document.createElement("span");
    box.className = "textsize";
    box.innerHTML = `<button class="btn ghost sm" type="button" title="字變小">A−</button>
      <span class="small muted"></span>
      <button class="btn ghost sm" type="button" title="字變大">A+</button>`;
    const [minus, plus] = box.querySelectorAll("button");
    label = box.querySelector("span");
    minus.onclick = () => step(-1);
    plus.onclick = () => step(1);
    mount.appendChild(box);
  }
  apply();
}
