// Вырезание рисунка с бумаги: фон, связанный с краями фото, становится прозрачным.

const MAX = 400;

export function loadToCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
    img.src = url;
  });
}

export function cutout(src, thr, flip) {
  const w = src.width, h = src.height, n = w * h;
  const img = src.getContext('2d').getImageData(0, 0, w, h);
  const d = img.data;

  // Цвет бумаги — среднее по рамке кадра.
  let pr = 0, pg = 0, pb = 0, cnt = 0;
  const sample = (x, y) => { const i = (y * w + x) * 4; pr += d[i]; pg += d[i + 1]; pb += d[i + 2]; cnt++; };
  for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }
  pr /= cnt; pg /= cnt; pb /= cnt;

  const isBg = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    // Тени на бумаге серые: вычитаем общую яркость, оставляя цвет и тёмные линии.
    const lum = (r + g + b) / 3, plum = (pr + pg + pb) / 3;
    const chroma = Math.max(Math.abs(r - lum - (pr - plum)), Math.abs(g - lum - (pg - plum)), Math.abs(b - lum - (pb - plum)));
    const dark = Math.max(0, plum - lum);
    isBg[i] = (chroma * 2 + dark * 0.7) < thr ? 1 : 0;
  }

  // Заливка фона от краёв.
  const outside = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i) => { if (isBg[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }

  // Оставляем самый большой связный кусок — это рыбка, остальное мусор.
  const label = new Int32Array(n);
  let best = 0, bestSize = 0, cur = 0;
  for (let s = 0; s < n; s++) {
    if (outside[s] || label[s]) continue;
    cur++; let size = 0; sp = 0; label[s] = cur; stack[sp++] = s;
    const visit = (j) => { if (!outside[j] && !label[j]) { label[j] = cur; stack[sp++] = j; } };
    while (sp) {
      const i = stack[--sp], x = i % w; size++;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < n - w) visit(i + w);
    }
    if (size > bestSize) { bestSize = size; best = cur; }
  }
  if (!best || bestSize < 80) return null;

  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    if (label[i] === best) {
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    } else d[i * 4 + 3] = 0;
  }
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(img, 0, 0);

  const pad = 3, ow = x1 - x0 + 1 + pad * 2, oh = y1 - y0 + 1 + pad * 2;
  const out = document.createElement('canvas');
  out.width = ow; out.height = oh;
  const g = out.getContext('2d');
  if (flip) { g.translate(ow, 0); g.scale(-1, 1); }
  g.drawImage(tmp, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}
