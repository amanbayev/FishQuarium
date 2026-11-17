import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Модель рыбки: нос смотрит в +X, длина 2 (x от -1 до 1), текстура — вид сбоку.

export const SPECIES = [
  { name: 'clown', h: 0.34, w: 0.46, skew: 1.25, pow: 0.75, dorsal: 0.16, back: '#d9480f', mid: '#ff7a1a', belly: '#ffb066', fin: '#f76707', pattern: 'bands', scale: 0.24, count: 9, speed: 0.8, metal: 0.1 },
  { name: 'tang', h: 0.5, w: 0.26, skew: 1.3, pow: 0.6, dorsal: 0.14, back: '#e0ac00', mid: '#ffd21a', belly: '#ffe873', fin: '#f2c200', pattern: 'plain', scale: 0.3, count: 7, speed: 0.9, metal: 0.1 },
  { name: 'blue', h: 0.4, w: 0.3, skew: 1.35, pow: 0.7, dorsal: 0.12, back: '#0a2f8f', mid: '#1c6fe0', belly: '#3d9bff', fin: '#ffd43b', pattern: 'swoosh', scale: 0.3, count: 7, speed: 1.0, metal: 0.15 },
  { name: 'neon', h: 0.2, w: 0.5, skew: 1.2, pow: 0.8, dorsal: 0.1, back: '#3f5560', mid: '#b9c9d1', belly: '#f4f7f8', fin: '#e03131', pattern: 'silver', scale: 0.15, count: 24, speed: 1.2, metal: 0.6 },
  { name: 'angel', h: 0.5, w: 0.24, skew: 1.4, pow: 0.55, dorsal: 0.3, back: '#e9ecef', mid: '#ffffff', belly: '#ffffff', fin: '#ffe066', pattern: 'bars', scale: 0.38, count: 4, speed: 0.6, metal: 0.1 },
  { name: 'catfish', h: 0.27, w: 0.72, skew: 1.5, pow: 0.7, dorsal: 0.2, back: '#5b4a33', mid: '#b59a6a', belly: '#efe2c0', fin: '#9c845a', pattern: 'spots', scale: 0.3, count: 5, speed: 0.45, metal: 0.05, barbels: true, bottom: true },
];

const bodyX = (s) => -0.6 + 1.6 * s;

function profile(s, sp) {
  s = Math.min(1, Math.max(0, s));
  const base = Math.pow(Math.sin(Math.PI * Math.pow(s, sp.skew)), sp.pow);
  const v = sp.h * (0.15 + 0.85 * base);
  return v * Math.sqrt(Math.min(1, s / 0.04)) * Math.sqrt(Math.min(1, (1 - s) / 0.1));
}
const Hx = (x, sp) => profile((x + 0.6) / 1.6, sp);

const UV = (x, y) => [(x + 1) / 2, (y + 0.8) / 1.6];

function flatGeo(tris) {
  // tris: массив [x,y,z] по три на треугольник
  const pos = [], uv = [];
  for (const p of tris) { pos.push(p[0], p[1], p[2]); uv.push(...UV(p[0], p[1])); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// Плоские плавники (хвост, спинной, анальный) в плоскости z = 0.
function flatFins(sp) {
  const tris = [];
  // хвост
  const th = Math.min(0.5, sp.h * 1.15);
  tris.push([-0.52, 0.07, 0], [-1, th, 0], [-0.84, 0, 0]);
  tris.push([-0.52, -0.07, 0], [-0.84, 0, 0], [-1, -th, 0]);
  tris.push([-0.52, 0.07, 0], [-0.84, 0, 0], [-0.52, -0.07, 0]);
  // спинной и анальный плавники
  const strip = (xa, xb, sign, height) => {
    const n = 10;
    const pt = (i) => {
      const t = i / n, x = xa + (xb - xa) * t, hb = Hx(x, sp);
      const lift = height * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.6);
      return [[x, sign * hb * 0.8, 0], [x - lift * 0.5, sign * (hb + lift), 0]];
    };
    for (let i = 0; i < n; i++) {
      const [b0, t0] = pt(i), [b1, t1] = pt(i + 1);
      tris.push(b0, t0, b1, t0, t1, b1);
    }
  };
  strip(0.5, -0.4, 1, sp.dorsal);
  strip(0.05, -0.42, -1, sp.dorsal * 0.8);
  return tris;
}

export function fishGeometry(sp) {
  const NS = 30, NR = 16;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, x = bodyX(s), H = profile(s, sp), W = H * sp.w * (0.85 + 0.5 * s);
    for (let j = 0; j <= NR; j++) {
      const th = (j / NR) * Math.PI * 2, y = H * Math.cos(th);
      pos.push(x, y, W * Math.sin(th));
      uv.push(...UV(x, y));
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * (NR + 1) + j, b = a + NR + 1, c = a + 1, d = b + 1;
    idx.push(a, c, b, c, d, b);
  }
  let body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setIndex(idx);
  body.computeVertexNormals();
  body = body.toNonIndexed();

  const tris = flatFins(sp);
  // грудные плавники
  for (const sgn of [1, -1]) {
    const W = Hx(0.4, sp) * sp.w * 1.2;
    tris.push([0.45, -0.08, sgn * W * 0.9], [0.08, -0.26, sgn * (W + 0.22)], [0.12, 0.02, sgn * (W + 0.1)]);
  }
  // усики сомика
  if (sp.barbels) for (const sgn of [1, -1]) {
    tris.push([0.97, -0.03, sgn * 0.03], [0.93, -0.06, sgn * 0.05], [0.7, -0.22, sgn * 0.3]);
    tris.push([0.95, -0.05, sgn * 0.02], [0.9, -0.07, sgn * 0.03], [0.78, -0.3, sgn * 0.12]);
  }
  const fins = flatGeo(tris);
  const geo = mergeGeometries([body, fins]);
  geo.computeBoundingSphere();
  geo.boundingSphere.radius *= 1.3;
  return geo;
}

export function fishTexture(sp) {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const px = (x) => ((x + 1) / 2) * S;
  const py = (y) => (1 - (y + 0.8) / 1.6) * S;
  const U = S / 2; // пикселей на единицу модели по X
  const V = S / 1.6;

  // плавники
  g.fillStyle = sp.fin; g.fillRect(0, 0, S, S);
  g.lineWidth = 1.2;
  for (let k = 0; k < 140; k++) {
    const a = (k / 140) * Math.PI * 2;
    g.strokeStyle = k % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.14)';
    g.beginPath(); g.moveTo(px(0.1), py(0)); g.lineTo(px(0.1) + Math.cos(a) * S, py(0) + Math.sin(a) * S); g.stroke();
  }
  const tg = g.createLinearGradient(px(-1), 0, px(-0.5), 0);
  tg.addColorStop(0, 'rgba(255,255,255,0.25)'); tg.addColorStop(1, 'rgba(0,0,0,0.15)');
  g.fillStyle = tg; g.fillRect(0, 0, px(-0.5), S);

  // тело
  g.save();
  g.beginPath();
  const N = 60;
  for (let i = 0; i <= N; i++) { const s = i / N; g.lineTo(px(bodyX(s)), py(profile(s, sp) * 1.06)); }
  for (let i = N; i >= 0; i--) { const s = i / N; g.lineTo(px(bodyX(s)), py(-profile(s, sp) * 1.06)); }
  g.closePath(); g.clip();

  const bg = g.createLinearGradient(0, py(sp.h), 0, py(-sp.h));
  bg.addColorStop(0, sp.back); bg.addColorStop(0.45, sp.mid); bg.addColorStop(1, sp.belly);
  g.fillStyle = bg; g.fillRect(0, 0, S, S);

  if (sp.pattern === 'bands') {
    for (const [x, wd] of [[0.42, 0.1], [-0.08, 0.13], [-0.5, 0.08]]) {
      g.fillStyle = '#16100c'; g.fillRect(px(x - wd / 2) - 5, 0, wd * U + 10, S);
      g.fillStyle = '#fdfdfd'; g.fillRect(px(x - wd / 2), 0, wd * U, S);
    }
  } else if (sp.pattern === 'bars') {
    g.fillStyle = '#15171a';
    for (const x of [0.72, 0.38, 0.05, -0.28]) g.fillRect(px(x) - 0.045 * U, 0, 0.09 * U, S);
    g.fillStyle = 'rgba(255,214,60,0.55)'; g.fillRect(0, 0, px(-0.42), S);
  } else if (sp.pattern === 'swoosh') {
    g.strokeStyle = '#06103a'; g.lineWidth = 0.13 * V; g.lineCap = 'round';
    g.beginPath(); g.moveTo(px(0.6), py(0.1)); g.bezierCurveTo(px(0.3), py(sp.h * 0.9), px(-0.2), py(sp.h * 0.5), px(-0.55), py(0.02)); g.stroke();
    g.beginPath(); g.moveTo(px(0.25), py(0.12)); g.quadraticCurveTo(px(0), py(-0.06), px(-0.2), py(0.12)); g.stroke();
    g.fillStyle = sp.fin; g.fillRect(0, 0, px(-0.48), S);
  } else if (sp.pattern === 'silver') {
    g.fillStyle = 'rgba(20,40,55,0.55)'; g.fillRect(0, py(0.035), S, 0.03 * V);
    const ig = g.createLinearGradient(0, py(0.1), 0, py(-0.02));
    ig.addColorStop(0, 'rgba(90,200,255,0)'); ig.addColorStop(0.5, 'rgba(90,220,255,0.45)'); ig.addColorStop(1, 'rgba(90,200,255,0)');
    g.fillStyle = ig; g.fillRect(0, 0, S, S);
  } else if (sp.pattern === 'spots') {
    for (let k = 0; k < 160; k++) {
      const x = Math.random() * S, y = Math.random() * S, r = 3 + Math.random() * 7;
      g.fillStyle = Math.random() < 0.6 ? 'rgba(30,22,15,0.45)' : 'rgba(230,215,190,0.3)';
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  } else {
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(px(-0.5), py(0), 0.05 * U, 0.02 * V, 0, 0, 7); g.fill();
  }

  // чешуя
  g.lineWidth = 1;
  const r = 9;
  for (let row = 0, y = 0; y < S; y += r * 0.9, row++) {
    for (let x = (row % 2) * r; x < px(0.5); x += r * 2) {
      g.strokeStyle = 'rgba(0,0,0,0.13)';
      g.beginPath(); g.arc(x, y, r, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.beginPath(); g.arc(x - 1.5, y, r, -Math.PI / 2, Math.PI / 2); g.stroke();
    }
  }
  // жаберная крышка и объёмная тень
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2.5;
  g.beginPath(); g.ellipse(px(0.5), py(0), 0.07 * U, sp.h * 0.7 * V, 0, -1.2, 1.2); g.stroke();
  const sh = g.createLinearGradient(0, py(sp.h), 0, py(-sp.h));
  sh.addColorStop(0, 'rgba(0,0,0,0.28)'); sh.addColorStop(0.3, 'rgba(0,0,0,0)'); sh.addColorStop(0.75, 'rgba(255,255,255,0.08)'); sh.addColorStop(1, 'rgba(255,255,255,0.2)');
  g.fillStyle = sh; g.fillRect(0, 0, S, S);

  // глаз и рот
  const ex = px(0.74), ey = py(Hx(0.74, sp) * 0.3), er = Math.max(9, Hx(0.74, sp) * 0.34 * V);
  g.fillStyle = '#f3e9c8'; g.beginPath(); g.arc(ex, ey, er, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(ex + er * 0.1, ey, er * 0.62, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(ex - er * 0.15, ey - er * 0.25, er * 0.2, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(px(0.99), py(-0.02)); g.lineTo(px(0.9), py(-0.045)); g.stroke();
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Формы для детских рыбок: рисунок натягивается на одну из них.
export const PRESETS = [
  { label: 'Обычная', h: 0.34, w: 0.45, skew: 1.3, pow: 0.7, dorsal: 0.16 },
  { label: 'Высокая', h: 0.5, w: 0.27, skew: 1.35, pow: 0.58, dorsal: 0.2 },
  { label: 'Длинная', h: 0.2, w: 0.55, skew: 1.2, pow: 0.8, dorsal: 0.1 },
  { label: 'Круглая', h: 0.46, w: 0.62, skew: 1.15, pow: 0.5, dorsal: 0.1 },
  { label: 'Сомик', h: 0.27, w: 0.72, skew: 1.5, pow: 0.7, dorsal: 0.2, barbels: true },
];

export const TEX_SIZE = 512;

// Маска силуэта (вид сбоку) в раскладке текстуры: белое там, где рыбка.
export function silhouetteMask(sp) {
  const S = TEX_SIZE, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const px = (x) => ((x + 1) / 2) * S, py = (y) => (1 - (y + 0.8) / 1.6) * S;
  g.fillStyle = '#fff';
  g.beginPath();
  const N = 60;
  for (let i = 0; i <= N; i++) { const s = i / N; g.lineTo(px(bodyX(s)), py(profile(s, sp))); }
  for (let i = N; i >= 0; i--) { const s = i / N; g.lineTo(px(bodyX(s)), py(-profile(s, sp))); }
  g.fill();
  const t = flatFins(sp);
  for (let i = 0; i < t.length; i += 3) {
    g.beginPath(); g.moveTo(px(t[i][0]), py(t[i][1])); g.lineTo(px(t[i + 1][0]), py(t[i + 1][1])); g.lineTo(px(t[i + 2][0]), py(t[i + 2][1])); g.closePath(); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
  }
  const d = g.getImageData(0, 0, S, S).data;
  let x0 = S, y0 = S, x1 = 0, y1 = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { canvas: c, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}
