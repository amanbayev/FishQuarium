import { PRESETS, TEX_SIZE, silhouetteMask } from './fish.js';
import { loadToCanvas, cutout } from './cutout.js';

// Редактор детской рыбки: вырезать рисунок, выбрать форму, подогнать и раскрасить.
const S = TEX_SIZE, VIEW_H = 460, VIEW_Y = (S - VIEW_H) / 2;
const COLORS = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#1c1c1e'];
const $ = (id) => document.getElementById(id);
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

const masks = PRESETS.map((p) => silhouetteMask(p));
const tex = mk(S, S), paint = mk(S, S);
const st = { src: null, cut: null, flip: false, preset: 0, zoom: 1, ox: 0, oy: 0, base: '#f4a261', mode: 'move', color: COLORS[0], erase: false, done: null };

function averageColor(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return n ? `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})` : '#f4a261';
}

// Собирает текстуру: основа → рисунок → краска.
function compose() {
  const g = tex.getContext('2d');
  g.fillStyle = st.base; g.fillRect(0, 0, S, S);
  if (st.cut) {
    const b = masks[st.preset].box, w = b.w * st.zoom, h = b.h * st.zoom;
    g.drawImage(st.cut, b.x + b.w / 2 - w / 2 + st.ox, b.y + b.h / 2 - h / 2 + st.oy, w, h);
  }
  g.drawImage(paint, 0, 0);
}
function render() {
  compose();
  const v = $('preview'), g = v.getContext('2d');
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, S, VIEW_H);
  g.drawImage(tex, 0, -VIEW_Y);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(masks[st.preset].canvas, 0, -VIEW_Y);
  g.globalCompositeOperation = 'source-over';
}
function recut() {
  st.cut = cutout(st.src, +$('thr').value, st.flip);
  if (st.cut) st.base = averageColor(st.cut);
  render();
}
function setPreset(i) {
  st.preset = i; st.ox = st.oy = 0; st.zoom = 1; $('zoom').value = 100;
  [...$('presets').children].forEach((b, k) => b.classList.toggle('on', k === i));
  render();
}
function setMode(m) {
  st.mode = m;
  $('moveBtn').classList.toggle('on', m === 'move'); $('paintBtn').classList.toggle('on', m === 'paint');
  $('preview').style.cursor = m === 'move' ? 'grab' : 'crosshair';
}
function setColor(c, erase = false) {
  st.color = c; st.erase = erase; setMode('paint');
  [...$('palette').children].forEach((b) => b.classList.toggle('on', !erase && b.dataset.c === c));
  $('eraseBtn').classList.toggle('on', erase);
}
function close(result) { $('modal').classList.remove('open'); const d = st.done; st.done = null; if (d) d(result); }

export function initEditor() {
  PRESETS.forEach((p, i) => { const b = document.createElement('button'); b.textContent = p.label; b.onclick = () => setPreset(i); $('presets').appendChild(b); });
  COLORS.forEach((c) => { const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.dataset.c = c; b.onclick = () => setColor(c); $('palette').appendChild(b); });
  $('customColor').oninput = (e) => setColor(e.target.value);
  $('eraseBtn').onclick = () => setColor(st.color, true);
  $('moveBtn').onclick = () => setMode('move');
  $('paintBtn').onclick = () => setColor(st.color);
  $('zoom').oninput = (e) => { st.zoom = e.target.value / 100; render(); };
  $('thr').oninput = recut;
  $('flipBtn').onclick = () => { st.flip = !st.flip; recut(); };
  $('cancelBtn').onclick = () => close(null);
  $('okBtn').onclick = () => {
    if (!st.cut) { alert('Рыбка не нашлась — подвигайте ползунок «Вырезание» или переснимите фото.'); return; }
    compose();
    close({ preset: st.preset, tex: tex.toDataURL('image/jpeg', 0.85) });
  };

  const v = $('preview');
  let last = null;
  const at = (e) => { const r = v.getBoundingClientRect(); return { x: (e.clientX - r.left) * S / r.width, y: (e.clientY - r.top) * VIEW_H / r.height + VIEW_Y }; };
  const stroke = (a, b) => {
    const g = paint.getContext('2d');
    g.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
    g.strokeStyle = st.color; g.lineWidth = +$('brush').value; g.lineCap = g.lineJoin = 'round';
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x + 0.01, b.y); g.stroke();
  };
  v.addEventListener('pointerdown', (e) => { v.setPointerCapture(e.pointerId); last = at(e); if (st.mode === 'paint') { stroke(last, last); render(); } });
  v.addEventListener('pointermove', (e) => {
    if (!last) return;
    const p = at(e);
    if (st.mode === 'paint') stroke(last, p); else { st.ox += p.x - last.x; st.oy += p.y - last.y; }
    last = p; render();
  });
  const up = () => { last = null; };
  v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
}

// Открывает редактор для фото; возвращает { preset, tex } или null.
export async function editFish(file) {
  st.src = await loadToCanvas(file);
  st.flip = false;
  paint.getContext('2d').clearRect(0, 0, S, S);
  st.cut = cutout(st.src, +$('thr').value, false);
  if (st.cut) st.base = averageColor(st.cut);
  // форму подбираем по пропорциям рисунка
  const ar = st.cut ? st.cut.width / st.cut.height : 2;
  setMode('move'); setPreset(ar > 3 ? 2 : ar < 1.35 ? 3 : ar < 1.7 ? 1 : 0);
  $('modal').classList.add('open');
  return new Promise((res) => { st.done = res; });
}
