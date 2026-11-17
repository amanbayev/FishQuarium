import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SPECIES, PRESETS, fishGeometry, fishTexture } from './fish.js';
import { initEditor, editFish } from './editor.js';
import { buildRoom } from './room.js';

// ---------- утилиты ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261117);
const rr = (a, b) => a + (b - a) * rnd();
const hash3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t) => t * t * (3 - 2 * t);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), L(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    L(L(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), L(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w);
}
const fbm = (x, y, z) => noise3(x, y, z) * 0.55 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.15;
const clamp = THREE.MathUtils.clamp;

// Аквариум: полуширина HX, полуглубина HZ, вода до SURFACE_Y, стекло до TOP.
const HX = 10, HZ = 5.5, SURFACE_Y = 7, TOP = 7.9;
const floorY = (x, z) => 0.35 - z * 0.05 + Math.sin(x * 0.55) * Math.cos(z * 0.7) * 0.16;
const FOG = new THREE.Color(0x2f8f9f);

// ---------- рендерер ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1b24);
scene.fog = new THREE.FogExp2(FOG, 0.03);
const camera = new THREE.PerspectiveCamera(64, 1, 0.06, 260);
camera.rotation.order = 'YXZ';
camera.position.set(6.5, 3.4, 2.2);

const hemi = new THREE.HemisphereLight(0xb8ecff, 0x25404a, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xeafaff, 1.5);
sun.position.set(0.15, 1, 0.3);
scene.add(sun);

const U = { uTime: { value: 0 }, uLight: { value: 1 } };

const CAUSTIC_GLSL = /* glsl */`
float caustic(vec2 uv, float time) {
  const float TAU = 6.28318530718;
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 5.0; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}`;

// Добавляет в стандартный материал каустику и (по желанию) покачивание.
function patch(mat, kind = 'static', phaseUniform = null) {
  mat.customProgramCacheKey = () => 'aq-' + kind;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uLight = U.uLight;
    if (phaseUniform) sh.uniforms.aPhase = phaseUniform;
    let head = 'varying vec3 vWPos;\nuniform float uTime;\n';
    let sway = '';
    if (kind === 'fish') head += 'attribute float aPhase;\n';
    if (kind === 'kid') head += 'uniform float aPhase;\n';
    if (kind === 'fish' || kind === 'kid') {
      sway = `float sf = clamp((0.7 - transformed.x) / 1.7, 0.0, 1.0);
        transformed.z += sin(aPhase - transformed.x * 2.5) * (0.03 + 0.24 * sf * sf);`;
    } else if (kind === 'kelp') {
      sway = `vec3 ip = instanceMatrix[3].xyz; float hh = transformed.y;
        float ph = uTime * 0.8 + ip.x * 0.7 + ip.z * 0.9;
        transformed.x += (sin(ph + hh * 3.0) * 0.3 + sin(ph * 0.63 + hh * 6.0) * 0.12) * hh * hh;
        transformed.z += cos(ph * 0.8 + hh * 4.0) * 0.15 * hh * hh;`;
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + head)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + sway)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 aqW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          aqW = instanceMatrix * aqW;
        #endif
        vWPos = (modelMatrix * aqW).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uLight;\n' + CAUSTIC_GLSL)
      .replace('#include <opaque_fragment>', `{
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          float ca = caustic(vWPos.xz * 0.16 + vec2(vWPos.y * 0.05), uTime * 0.5);
          outgoingLight += diffuseColor.rgb * ca * 1.5 * uLight * clamp(wn.y * 0.7 + 0.45, 0.0, 1.0);
        }
        #include <opaque_fragment>`);
  };
  return mat;
}
const wet = (o, kind) => patch(new THREE.MeshStandardMaterial({ roughness: 0.8, ...o }), kind);
function add(geo, mat, x, y, z, parent = scene) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; }

// ---------- комната ----------
buildRoom(scene, HX, HZ, TOP);

// ---------- стекло и каркас ----------
{
  const glass = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
      gl_FragColor = vec4(mix(vec3(0.55, 0.85, 0.9), vec3(0.92, 1.0, 1.0), f), 0.07 + 0.6 * f); }`,
  });
  const h = TOP, y = TOP / 2;
  const pane = (w, x, z, ry) => { const m = add(new THREE.PlaneGeometry(w, h), glass, x, y, z); m.rotation.y = ry; m.renderOrder = 4; };
  pane(HX * 2, 0, -HZ, 0); pane(HX * 2, 0, HZ, Math.PI); pane(HZ * 2, -HX, 0, Math.PI / 2); pane(HZ * 2, HX, 0, -Math.PI / 2);
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.5, fog: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.14, h, 0.14), dark, sx * HX, y, sz * HZ);
  for (const yy of [-0.1, TOP + 0.15]) {
    for (const sz of [-1, 1]) add(new THREE.BoxGeometry(HX * 2 + 0.3, 0.35, 0.22), dark, 0, yy, sz * HZ);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.22, 0.35, HZ * 2 + 0.3), dark, sx * HX, yy, 0);
  }
}

// ---------- грунт ----------
{
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#6d5f4a'; g.fillRect(0, 0, S, S);
  const cols = ['#c9b48a', '#a8916a', '#e3d6b8', '#8a7558', '#d8c39a', '#70665a', '#b9a27c', '#efe6d2', '#9c6b4a', '#5f7f8a'];
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 2.5 + Math.random() * 5;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + 1.5, y + 2, r, r * 0.8, 0, 0, 7); g.fill();
    g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.beginPath(); g.ellipse(x, y, r, r * 0.8, Math.random() * 3, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.3, 0, 7); g.fill();
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(c);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 3); t.anisotropy = 8; }
  const geo = new THREE.PlaneGeometry(HX * 2, HZ * 2, 80, 44);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, floorY(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  add(geo, wet({ map, bumpMap: bump, bumpScale: 2.5, roughness: 0.95 }), 0, 0, 0);
}

// Препятствия для рыбок и камеры (сферы).
const obstacles = [];
const obstacle = (x, y, z, r) => obstacles.push({ pos: new THREE.Vector3(x, y, z), r });

// ---------- камни ----------
{
  const mat = wet({ vertexColors: true, roughness: 0.95 });
  for (let v = 0; v < 3; v++) {
    let geo = new THREE.IcosahedronGeometry(1, 8);
    geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
    geo = mergeVertices(geo, 1e-4);
    const p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), o = v * 17.3;
      const k = 0.7 + 0.75 * fbm(x * 1.4 + o, y * 1.4 + o, z * 1.4) + 0.08 * noise3(x * 9 + o, y * 9, z * 9);
      p.setXYZ(i, x * k, y * k * 0.75, z * k);
      const n = fbm(x * 5 + o, y * 5, z * 5), m = noise3(x * 2 + o, y * 2 + 5, z * 2), alg = Math.max(0, y) * m;
      col.push(0.13 + n * 0.17 - alg * 0.05, 0.125 + n * 0.15 + alg * 0.07, 0.11 + n * 0.13 - alg * 0.02);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const N = 5, mesh = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const big = i === 0, s = big ? rr(0.9, 1.3) : rr(0.2, 0.55);
      const x = rr(-HX + 1.5, HX - 1.5), z = big ? rr(-HZ + 1.4, -1) : rr(-HZ + 1, HZ - 1);
      d.position.set(x, floorY(x, z) + s * 0.2, z);
      d.rotation.set(rr(-0.3, 0.3), rr(0, 6.28), rr(-0.3, 0.3));
      d.scale.set(s * rr(0.9, 1.4), s * rr(0.7, 1), s * rr(0.9, 1.3));
      d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      if (big) obstacle(x, d.position.y, z, s * 1.3);
    }
    scene.add(mesh);
  }
}

// ---------- растения ----------
{
  const geo = new THREE.PlaneGeometry(0.5, 1, 4, 18);
  geo.translate(0, 0.5, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), x = p.getX(i);
    p.setX(i, x * (1 - 0.75 * y * y) * (0.75 + 0.25 * Math.sin(y * 24)));
    p.setZ(i, Math.sin(y * 20 + x * 6) * 0.03);
  }
  geo.computeVertexNormals();
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, '#1f4a17'); gr.addColorStop(0.6, '#4f9a2a'); gr.addColorStop(1, '#b5d84a');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
  g.fillStyle = 'rgba(20,50,10,0.4)'; g.fillRect(29, 0, 6, 256);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const plants = 22, blades = 7;
  const mesh = new THREE.InstancedMesh(geo, wet({ map, side: THREE.DoubleSide, roughness: 0.55 }, 'kelp'), plants * blades);
  const d = new THREE.Object3D(), col = new THREE.Color();
  let k = 0;
  for (let i = 0; i < plants; i++) {
    const back = i < 14;
    const cx = rr(-HX + 0.8, HX - 0.8), cz = back ? rr(-HZ + 0.5, -HZ + 2) : rr(-1.5, HZ - 1);
    const hgt = back ? rr(3, 6.2) : rr(0.8, 2), red = rnd() < 0.2;
    for (let j = 0; j < blades; j++) {
      const x = cx + rr(-0.3, 0.3), z = cz + rr(-0.3, 0.3);
      d.position.set(x, floorY(x, z) - 0.05, z);
      d.rotation.set(0, rr(0, 6.28), 0);
      d.scale.set(rr(0.7, 1.3), hgt * rr(0.6, 1), 1);
      d.updateMatrix(); mesh.setMatrixAt(k, d.matrix);
      mesh.setColorAt(k++, red ? col.setRGB(1.5, 0.5, 0.45) : col.setRGB(1, 1, 1));
    }
  }
  mesh.frustumCulled = false;
  scene.add(mesh);
}

// ---------- декор и оборудование ----------
const vents = []; // источники пузырьков: [x, y, z, количество]
{
  const stone = wet({ color: 0x9a9c92, roughness: 1 }), roof = wet({ color: 0xb5533c, roughness: 0.9 }), hole = new THREE.MeshBasicMaterial({ color: 0x05080a });
  // замок
  const cx = -4.6, cz = -2.6, cy = floorY(cx, cz) - 0.05;
  const castle = new THREE.Group(); castle.position.set(cx, cy, cz); castle.rotation.y = 0.35; scene.add(castle);
  const tower = (x, z, r, h) => {
    add(new THREE.CylinderGeometry(r, r * 1.08, h, 16), stone, x, h / 2, z, castle);
    add(new THREE.CylinderGeometry(r * 1.2, r * 1.2, 0.18, 16), stone, x, h, z, castle);
    add(new THREE.ConeGeometry(r * 1.15, r * 1.9, 16), roof, x, h + 0.09 + r * 0.95, z, castle);
    add(new THREE.BoxGeometry(r * 0.5, r * 0.8, 0.05), hole, x, h * 0.7, z + r * 0.99, castle);
  };
  tower(0, 0, 0.6, 2.6); tower(-1.25, 0.1, 0.42, 1.7); tower(1.25, 0.1, 0.42, 1.7);
  add(new THREE.BoxGeometry(2.5, 1.1, 0.5), stone, 0, 0.55, 0.15, castle);
  for (let i = -3; i <= 3; i++) if (i % 2) add(new THREE.BoxGeometry(0.22, 0.22, 0.5), stone, i * 0.33, 1.2, 0.15, castle);
  add(new THREE.BoxGeometry(0.5, 0.75, 0.06), hole, 0.62, 0.38, 0.41, castle);
  add(new THREE.BoxGeometry(0.5, 0.75, 0.06), hole, -0.62, 0.38, 0.41, castle);
  obstacle(cx, cy + 1.2, cz, 1.7);

  // сундук с пузырьками
  const kx = 5.4, kz = -2.2, ky = floorY(kx, kz);
  const chest = new THREE.Group(); chest.position.set(kx, ky, kz); chest.rotation.y = -0.5; scene.add(chest);
  const woodM = wet({ color: 0x7a4a22, roughness: 0.8 }), gold = wet({ color: 0xffc933, roughness: 0.3, metalness: 0.8 });
  add(new THREE.BoxGeometry(1.5, 0.7, 0.9), woodM, 0, 0.35, 0, chest);
  for (const x of [-0.55, 0, 0.55]) add(new THREE.BoxGeometry(0.1, 0.74, 0.94), gold, x, 0.35, 0, chest);
  const lid = new THREE.Group(); lid.position.set(0, 0.7, -0.45); lid.rotation.x = -0.9; chest.add(lid);
  const lidG = new THREE.CylinderGeometry(0.45, 0.45, 1.5, 16, 1, false, 0, Math.PI); lidG.rotateZ(Math.PI / 2); lidG.rotateX(-Math.PI / 2);
  add(lidG, woodM, 0, 0, 0.45, lid);
  for (let i = 0; i < 16; i++) add(new THREE.SphereGeometry(0.09, 8, 6), gold, rr(-0.6, 0.6), 0.7 + rr(0, 0.08), rr(-0.3, 0.3), chest);
  obstacle(kx, ky + 0.5, kz, 1.0);
  vents.push([kx, ky + 0.8, kz, 14]);

  // коряга
  const curve = (pts) => new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const drift = wet({ color: 0x4a3222, roughness: 1 });
  const dx = 0.8, dz = -3.2, dy = floorY(dx, dz);
  add(new THREE.TubeGeometry(curve([[-1.6, 0, 0.3], [-0.6, 0.5, 0], [0.4, 0.9, -0.2], [1.6, 2.1, 0.2], [2.1, 3.2, 0]]), 24, 0.2, 8), drift, dx, dy, dz);
  add(new THREE.TubeGeometry(curve([[0.3, 0.85, -0.2], [0.2, 1.6, 0.5], [-0.5, 2.3, 0.9], [-0.7, 3.0, 0.8]]), 16, 0.12, 8), drift, dx, dy, dz);
  add(new THREE.TubeGeometry(curve([[1.2, 1.6, 0.1], [1.7, 1.7, 0.8], [2.4, 1.5, 1.3]]), 12, 0.09, 8), drift, dx, dy, dz);
  obstacle(dx + 0.3, dy + 0.7, dz, 0.9); obstacle(dx + 1.7, dy + 2.3, dz, 0.7);

  // внутренний фильтр в левом заднем углу
  const plastic = wet({ color: 0x1d2024, roughness: 0.45 });
  const fx = -HX + 0.75, fz = -HZ + 0.65;
  add(new THREE.BoxGeometry(1.0, 3.6, 0.8), plastic, fx, 4.6, fz);
  for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(0.75, 0.07, 0.04), wet({ color: 0x5c6770 }), fx, 3.2 + i * 0.17, fz + 0.41);
  const nozzle = add(new THREE.CylinderGeometry(0.11, 0.11, 0.9, 12), plastic, fx + 0.85, 6.1, fz); nozzle.rotation.z = Math.PI / 2;
  add(new THREE.BoxGeometry(0.12, 2, 0.12), plastic, fx - 0.2, 7.2, fz - 0.2);
  for (const y of [3.4, 5.8]) add(new THREE.SphereGeometry(0.14, 12, 8), wet({ color: 0x8fd3ff, roughness: 0.3 }), fx, y, fz - 0.5);
  obstacle(fx, 4.4, fz, 1.1); obstacle(fx, 5.9, fz, 1.1);
  vents.push([fx + 1.35, 5.9, fz, 16]);

  // нагреватель в правом заднем углу
  const hx = HX - 0.5, hz = -HZ + 0.5;
  add(new THREE.CylinderGeometry(0.13, 0.13, 2.8, 14), new THREE.MeshStandardMaterial({ color: 0xcfe8ef, transparent: true, opacity: 0.35, roughness: 0.1 }), hx, 4.4, hz);
  add(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 10), wet({ color: 0x8a8f94, roughness: 0.6 }), hx, 4.2, hz);
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 14), plastic, hx, 6.0, hz);
  add(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a1a }), hx, 5.6, hz + 0.1);
  // термометр на переднем стекле
  add(new THREE.BoxGeometry(0.16, 1.6, 0.05), new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.4 }), -HX + 2, 4.6, HZ - 0.05);
  add(new THREE.BoxGeometry(0.04, 0.9, 0.06), new THREE.MeshBasicMaterial({ color: 0xe03131 }), -HX + 2, 4.3, HZ - 0.06);

  // распылитель воздуха и трубка от компрессора
  const ax = HX - 2.2, az = -HZ + 1.3, ay = floorY(ax, az);
  add(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), wet({ color: 0x5d7f99, roughness: 1 }), ax, ay + 0.1, az).rotation.z = Math.PI / 2;
  add(new THREE.TubeGeometry(curve([[ax + 0.25, ay + 0.1, az], [HX - 1, ay + 0.2, az - 0.5], [HX - 0.25, ay + 0.6, -HZ + 0.25], [HX - 0.2, 4, -HZ + 0.2], [HX - 0.2, TOP + 0.3, -HZ + 0.2]]), 30, 0.035, 6), new THREE.MeshStandardMaterial({ color: 0xbfe9d8, transparent: true, opacity: 0.6 }), 0, 0, 0);
  vents.push([ax, ay + 0.3, az, 60]);
}

// ---------- поверхность воды (вид снизу) и лампа ----------
{
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uLight: U.uLight },
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform float uLight; varying vec3 vW;
      ${CAUSTIC_GLSL}
      void main(){
        float c = caustic(vW.xz * 0.12, uTime * 0.35) + 0.5 * caustic(vW.xz * 0.27 + 3.0, uTime * 0.5);
        float lamp = smoothstep(2.6, 0.0, abs(vW.z)) * smoothstep(${HX}.0, ${HX - 2}.0, abs(vW.x));
        float win = smoothstep(7.0, 0.0, length(vW.xz - cameraPosition.xz));
        vec3 col = mix(vec3(0.07, 0.3, 0.36), vec3(0.75, 0.95, 1.0), clamp(lamp * 0.7 + win * 0.2 + c * 0.6, 0.0, 1.0));
        col += vec3(1.0, 1.0, 0.95) * (lamp * lamp * 0.35 + c * lamp * 0.7);
        col = mix(vec3(0.02, 0.07, 0.1) + c * 0.05, col, uLight);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const m = add(new THREE.PlaneGeometry(HX * 2, HZ * 2), mat, 0, SURFACE_Y, 0);
  m.rotation.x = Math.PI / 2;
}

// ---------- лучи света ----------
{
  const geo = new THREE.CylinderGeometry(0.12, 0.8, 7.2, 12, 1, true);
  const N = 18, seeds = new Float32Array(N);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uLight: U.uLight },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute float aSeed; varying float vY; varying float vF; varying float vSeed; varying float vDist;
      void main(){
        mat4 mv = modelViewMatrix * instanceMatrix;
        vec4 p = mv * vec4(position, 1.0);
        vec3 n = normalize(mat3(mv) * normal);
        vF = abs(dot(n, normalize(-p.xyz)));
        vY = uv.y; vSeed = aSeed; vDist = -p.z;
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: `uniform float uTime; uniform float uLight; varying float vY; varying float vF; varying float vSeed; varying float vDist;
      void main(){
        float flick = 0.55 + 0.45 * sin(uTime * (0.4 + vSeed) + vSeed * 40.0);
        float a = pow(vF, 2.5) * smoothstep(0.0, 0.9, vY) * flick * 0.1 * uLight * smoothstep(0.4, 2.5, vDist);
        gl_FragColor = vec4(vec3(0.8, 0.97, 1.0) * a, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const s = rr(0.6, 1.6);
    d.position.set(rr(-HX + 1, HX - 1), SURFACE_Y - 3.5, rr(-2.4, 2.4));
    d.rotation.set(0.1, 0, -0.12);
    d.scale.set(s, 1, s);
    d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
    seeds[i] = rnd();
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  scene.add(mesh);
}

// ---------- взвесь и пузырьки ----------
{
  const N = 500, pos = new Float32Array(N * 3), sd = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); sd[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uScale: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
      void main(){
        vec3 q = fract(position + vec3(sin(uTime * 0.05 + aSeed * 30.0) * 0.02 + uTime * 0.004, -uTime * 0.006 * (0.5 + aSeed), 0.0));
        vec3 p = (q - vec3(0.5, 0.0, 0.5)) * vec3(${HX * 2 - 0.4}, ${SURFACE_Y - 0.4}, ${HZ * 2 - 0.4}) + vec3(0.0, 0.3, 0.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp(uScale * (3.0 + aSeed * 6.0) / d, 1.0, 10.0);
        vA = smoothstep(0.2, 1.0, d) * (0.2 + 0.4 * aSeed);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.9, 0.97, 1.0, smoothstep(0.5, 0.1, r) * vA); }`,
  }));
  pts.frustumCulled = false; pts.renderOrder = 6;
  scene.add(pts);
  U.snow = pts.material.uniforms.uScale;
}
{
  const N = vents.reduce((s, v) => s + v[3], 0);
  const pos = new Float32Array(N * 3), sd = new Float32Array(N * 4);
  let i = 0;
  for (const [x, y, z, n] of vents) for (let j = 0; j < n; j++, i++) {
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    sd[i * 4] = Math.random(); sd[i * 4 + 1] = 1.2 + Math.random() * 1.2; sd[i * 4 + 2] = Math.random() * 10; sd[i * 4 + 3] = SURFACE_Y - y;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uScale: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime; uniform float uScale; attribute vec4 aSeed; varying float vA;
      void main(){
        float h = mod(aSeed.z + uTime * aSeed.y, aSeed.w);
        vec3 p = position + vec3(sin(h * 2.3 + aSeed.x * 20.0) * (0.05 + 0.05 * h), h, cos(h * 1.9 + aSeed.x * 31.0) * (0.05 + 0.05 * h));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp(uScale * (3.0 + aSeed.x * 6.0 + h * 0.5) / d, 1.0, 30.0);
        vA = smoothstep(0.0, 0.3, h) * smoothstep(aSeed.w, aSeed.w - 0.3, h);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){
        vec2 q = gl_PointCoord - 0.5; float r = length(q);
        float ring = smoothstep(0.5, 0.44, r) * smoothstep(0.3, 0.47, r);
        float hl = smoothstep(0.14, 0.0, length(q - vec2(-0.16, -0.18)));
        gl_FragColor = vec4(0.9, 0.98, 1.0, (ring * 0.75 + hl * 0.9 + smoothstep(0.5, 0.45, r) * 0.1) * vA); }`,
  }));
  pts.frustumCulled = false; pts.renderOrder = 7;
  scene.add(pts);
  U.bub = pts.material.uniforms.uScale;
}

// ---------- корм ----------
const flakes = [];
const MAX_FLAKES = 90;
const flakeMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.07, 6), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 }), MAX_FLAKES);
flakeMesh.count = 0; flakeMesh.frustumCulled = false;
scene.add(flakeMesh);
{
  const c = new THREE.Color(), pal = [0xd9480f, 0xe8590c, 0xc92a2a, 0x8a5a14, 0x5c940d, 0xf08c00];
  for (let i = 0; i < MAX_FLAKES; i++) flakeMesh.setColorAt(i, c.setHex(pal[i % pal.length]));
}
function feed() {
  const _f2 = new THREE.Vector3(); camera.getWorldDirection(_f2);
  const cx = clamp(camera.position.x + _f2.x * 3, -HX + 2, HX - 2), cz = clamp(camera.position.z + _f2.z * 3, -HZ + 1.5, HZ - 1.5);
  for (let i = 0; i < 34 && flakes.length < MAX_FLAKES; i++) {
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 1.6;
    flakes.push({ pos: new THREE.Vector3(cx + Math.cos(a) * r, SURFACE_Y - 0.04, cz + Math.sin(a) * r), t: 0, floatT: 3 + Math.random() * 14, seed: Math.random() * 100, rest: 0 });
  }
}
const _fd = new THREE.Object3D();
function updateFlakes(dt, t) {
  for (let i = flakes.length - 1; i >= 0; i--) {
    const f = flakes[i]; f.t += dt;
    if (f.t > f.floatT) {
      const fy = floorY(f.pos.x, f.pos.z) + 0.05;
      if (f.pos.y > fy) {
        f.pos.y -= 0.3 * dt;
        f.pos.x = clamp(f.pos.x + Math.sin(t * 1.3 + f.seed) * 0.2 * dt, -HX + 0.3, HX - 0.3);
        f.pos.z = clamp(f.pos.z + Math.cos(t * 1.1 + f.seed) * 0.2 * dt, -HZ + 0.3, HZ - 0.3);
      } else if ((f.rest += dt) > 40) { flakes.splice(i, 1); continue; }
    }
  }
  flakeMesh.count = flakes.length;
  for (let i = 0; i < flakes.length; i++) {
    const f = flakes[i], sink = f.t > f.floatT && f.rest === 0;
    _fd.position.copy(f.pos);
    _fd.rotation.set(Math.PI / 2 + (sink ? Math.sin(t * 2 + f.seed) * 0.9 : 0), 0, f.seed + (sink ? t : 0));
    _fd.updateMatrix(); flakeMesh.setMatrixAt(i, _fd.matrix);
  }
  flakeMesh.instanceMatrix.needsUpdate = true;
}

// ---------- обитатели ----------
const groups = [];
const camPos = camera.position;
const _v = new THREE.Vector3(), _acc = new THREE.Vector3(), _avg = new THREE.Vector3(), _d = new THREE.Object3D();
_d.rotation.order = 'YZX';

function newTarget(sc, bottom) {
  sc.target.set((Math.random() * 2 - 1) * (HX - 2), 0, (Math.random() * 2 - 1) * (HZ - 1.5));
  sc.target.y = floorY(sc.target.x, sc.target.z) + (bottom ? 0.3 : 0.9 + Math.random() * (SURFACE_Y - 2.2));
  sc.timer = 10 + Math.random() * 16;
}
function makeSchool(bottom) {
  const sc = { center: new THREE.Vector3(), target: new THREE.Vector3(), timer: 0 };
  newTarget(sc, bottom); sc.center.copy(sc.target); newTarget(sc, bottom);
  return sc;
}
function makeAgent(school, scale, spread) {
  const pos = school.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.4, (Math.random() - 0.5) * spread));
  pos.x = clamp(pos.x, -HX + 1, HX - 1); pos.z = clamp(pos.z, -HZ + 1, HZ - 1);
  pos.y = clamp(pos.y, floorY(pos.x, pos.z) + 0.4, SURFACE_Y - 0.6);
  const a = Math.random() * 6.28;
  return { pos, vel: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), phase: Math.random() * 6.28, scale, school, f1: 0.3 + Math.random() * 0.5, p1: Math.random() * 6.28 };
}

for (const sp of SPECIES) {
  const mat = wet({ map: fishTexture(sp), roughness: 0.42, metalness: sp.metal, side: THREE.DoubleSide }, 'fish');
  const geo = fishGeometry(sp);
  const mesh = new THREE.InstancedMesh(geo, mat, sp.count);
  const phases = new THREE.InstancedBufferAttribute(new Float32Array(sp.count), 1);
  phases.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPhase', phases);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const solo = !!sp.bottom || sp.count <= 4;
  const schools = solo ? Array.from({ length: sp.count }, () => makeSchool(sp.bottom)) : [makeSchool(false)];
  const agents = [];
  for (let i = 0; i < sp.count; i++) agents.push(makeAgent(schools[solo ? i : 0], sp.scale * (0.8 + Math.random() * 0.4), solo ? 1 : 3));
  groups.push({ agents, schools, mesh, phases, speed: sp.speed, sep: sp.scale * 2.6, solo, bottom: !!sp.bottom });
}

// черепашки
function makeTurtle() {
  const g = new THREE.Group();
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e9c94a'; x.fillRect(0, 64, 256, 64);
  x.strokeStyle = '#6b5a1a'; x.lineWidth = 3; for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(i * 32, 64); x.lineTo(i * 32, 128); x.stroke(); }
  x.fillStyle = '#2f4a22'; x.fillRect(0, 0, 256, 64);
  for (let row = 0; row < 2; row++) for (let i = 0; i < 8; i++) {
    const px = i * 32 + (row ? 16 : 0), py = row * 30 + 4;
    x.fillStyle = row ? '#3d5c2a' : '#476b30'; x.fillRect(px + 3, py + 3, 26, 24);
    x.strokeStyle = '#c9b648'; x.lineWidth = 2; x.strokeRect(px + 3, py + 3, 26, 24);
    x.strokeStyle = 'rgba(20,30,10,0.5)'; x.strokeRect(px + 9, py + 9, 14, 12);
  }
  const shellT = new THREE.CanvasTexture(c); shellT.colorSpace = THREE.SRGBColorSpace; shellT.wrapS = THREE.RepeatWrapping;
  const skin = wet({ color: 0x4f6b2c, roughness: 0.7 }), shellM = wet({ map: shellT, roughness: 0.5 });
  const shell = add(new THREE.SphereGeometry(1, 28, 18), shellM, 0, 0, 0, g); shell.scale.set(1, 0.42, 0.82);
  const rim = add(new THREE.SphereGeometry(1, 24, 10), wet({ color: 0x39521f, roughness: 0.6 }), 0, -0.03, 0, g); rim.scale.set(1.06, 0.12, 0.88);
  const neck = add(new THREE.CylinderGeometry(0.15, 0.17, 0.5, 10), skin, 1.05, 0.02, 0, g); neck.rotation.z = Math.PI / 2;
  const head = add(new THREE.SphereGeometry(0.24, 16, 12), skin, 1.35, 0.05, 0, g); head.scale.set(1.3, 0.9, 1);
  for (const s of [1, -1]) {
    add(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }), 1.5, 0.11, s * 0.16, g);
    const ear = add(new THREE.SphereGeometry(0.07, 8, 6), wet({ color: 0xe03131 }), 1.33, 0.08, s * 0.22, g); ear.scale.set(1.8, 0.7, 0.5);
  }
  const tail = add(new THREE.ConeGeometry(0.08, 0.4, 8), skin, -1.1, -0.03, 0, g); tail.rotation.z = Math.PI / 2;
  const legs = [];
  for (const [lx, lz, front] of [[0.62, 0.62, 1], [0.62, -0.62, 1], [-0.62, 0.58, 0], [-0.62, -0.58, 0]]) {
    const piv = new THREE.Group(); piv.position.set(lx, -0.08, lz); g.add(piv);
    const leg = add(new THREE.SphereGeometry(1, 12, 8), skin, 0, 0, Math.sign(lz) * 0.34, piv); leg.scale.set(front ? 0.2 : 0.17, 0.07, front ? 0.42 : 0.34);
    legs.push({ piv, base: (front ? -0.5 : 0.6) * Math.sign(lz), sign: Math.sign(lz), off: front ? 0 : Math.PI });
  }
  g.rotation.order = 'YZX';
  scene.add(g);
  return { g, legs };
}
{
  const agents = [], schools = [];
  for (let i = 0; i < 2; i++) {
    const sc = makeSchool(false); schools.push(sc);
    const a = makeAgent(sc, i ? 0.42 : 0.55, 1), t = makeTurtle();
    a.mesh = t.g; a.legs = t.legs; agents.push(a);
  }
  groups.push({ agents, schools, speed: 0.4, sep: 2, solo: true, turtle: true });
}

// нарисованные рыбки
const kidSchool = { center: new THREE.Vector3(0, 3, 0), target: new THREE.Vector3(), timer: 0 };
const kids = { agents: [], schools: [kidSchool], speed: 0.8, sep: 1.3, solo: false, followCam: true };
groups.push(kids);

const presetGeo = [];
// entry — либо { preset, tex } (объёмная рыбка), либо строка (старый плоский рисунок).
function addKidFish(entry) {
  const flat = typeof entry === 'string';
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; tex.anisotropy = 4;
    const phase = { value: 0 };
    let mesh;
    if (flat) {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2 * img.height / img.width, 28, 1),
        wet({ map: tex, emissiveMap: tex, emissive: 0x555555, alphaTest: 0.5, side: THREE.DoubleSide }, 'kid', phase));
    } else {
      const i = entry.preset in PRESETS ? entry.preset : 0;
      presetGeo[i] ||= fishGeometry(PRESETS[i]);
      mesh = new THREE.Mesh(presetGeo[i], wet({ map: tex, emissiveMap: tex, emissive: 0x2a2a2a, roughness: 0.5, side: THREE.DoubleSide }, 'kid', phase));
    }
    mesh.rotation.order = 'YZX';
    mesh.frustumCulled = false;
    scene.add(mesh);
    const ag = makeAgent(kidSchool, 0.36 + Math.random() * 0.1, 2);
    ag.mesh = mesh; ag.phaseU = phase; ag.flat = flat;
    kids.agents.push(ag);
    document.getElementById('clearBtn').hidden = false;
  };
  img.src = flat ? entry : entry.tex;
}

function updateGroup(g, dt, t) {
  const A = g.agents;
  for (const sc of g.schools) {
    if (g.followCam) {
      camera.getWorldDirection(_v);
      sc.target.copy(camPos).addScaledVector(_v, 3.5);
      sc.target.set(clamp(sc.target.x, -HX + 1.5, HX - 1.5), clamp(sc.target.y, 1.2, SURFACE_Y - 1.2), clamp(sc.target.z, -HZ + 1.5, HZ - 1.5));
      sc.center.lerp(sc.target, Math.min(1, dt * 0.8));
    } else {
      sc.timer -= dt;
      _v.subVectors(sc.target, sc.center);
      const d = _v.length();
      if (d < 0.8 || sc.timer < 0) newTarget(sc, g.bottom);
      else sc.center.addScaledVector(_v, Math.min(1, (g.speed * 0.9 * dt) / d));
    }
  }
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    const fl = floorY(a.pos.x, a.pos.z);
    // ближайший кусочек корма
    let food = null, best = 1e9;
    for (let k = 0; k < flakes.length; k++) {
      const f = flakes[k];
      if (g.bottom ? f.pos.y > fl + 1.2 : f.pos.y < fl + 0.5) continue;
      const d2 = a.pos.distanceToSquared(f.pos);
      if (d2 < best) { best = d2; food = k; }
    }
    if (food !== null) {
      const f = flakes[food], d = Math.sqrt(best);
      if (d < 0.22 + a.scale * 0.9) { flakes.splice(food, 1); a.vel.multiplyScalar(0.5); _acc.set(0, 0, 0); }
      else _acc.subVectors(f.pos, a.pos).multiplyScalar((5 * g.speed + 1.5) / d);
    } else {
      _acc.subVectors(a.school.center, a.pos);
      const dc = _acc.length();
      _acc.multiplyScalar((g.solo ? 0.3 : 0.25) * (dc > 4 ? 2 : 1));
      _acc.y *= 1.5;
    }
    if (!g.solo) {
      _avg.set(0, 0, 0); let cnt = 0;
      for (let j = 0; j < A.length; j++) {
        if (j === i) continue;
        const b = A[j];
        const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 4) {
          _avg.add(b.vel); cnt++;
          if (d2 < g.sep * g.sep && d2 > 1e-6) { const d = Math.sqrt(d2), k = ((g.sep - d) / d) * 5; _acc.x += dx * k; _acc.y += dy * k; _acc.z += dz * k; }
        }
      }
      if (cnt && food === null) _acc.addScaledVector(_avg.multiplyScalar(1 / cnt).sub(a.vel), 0.7);
    }
    _acc.x += Math.sin(t * a.f1 + a.p1) * 0.5; _acc.z += Math.cos(t * a.f1 * 1.3 + a.p1 * 2) * 0.5; _acc.y += Math.sin(t * a.f1 * 0.7 + a.p1 * 3) * 0.2;
    // не врезаться в камеру, декор, дно, поверхность и стёкла
    _v.subVectors(a.pos, camPos); let d = _v.length();
    const cr = 0.7 + a.scale * 1.5;
    if (d < cr && d > 1e-4) _acc.addScaledVector(_v, ((cr - d) / d) * 7);
    for (const ob of obstacles) {
      _v.subVectors(a.pos, ob.pos); d = _v.length();
      const R = ob.r + 0.3 + a.scale;
      if (d < R && d > 1e-4) _acc.addScaledVector(_v, ((R - d) / d) * 9);
    }
    const low = fl + 0.12 + a.scale * (g.bottom ? 0.3 : 0.6);
    if (a.pos.y < low) _acc.y += (low - a.pos.y) * 14;
    if (g.bottom && a.pos.y > low + 0.25) _acc.y -= (a.pos.y - low - 0.25) * 3;
    const high = SURFACE_Y - 0.12 - a.scale * 0.35;
    if (a.pos.y > high) _acc.y -= (a.pos.y - high) * 14;
    const mx = HX - 0.5 - a.scale, mz = HZ - 0.5 - a.scale;
    if (a.pos.x > mx) _acc.x -= (a.pos.x - mx) * 14; else if (a.pos.x < -mx) _acc.x -= (a.pos.x + mx) * 14;
    if (a.pos.z > mz) _acc.z -= (a.pos.z - mz) * 14; else if (a.pos.z < -mz) _acc.z -= (a.pos.z + mz) * 14;

    const hungry = food !== null;
    const maxS = g.speed * (hungry ? 2.8 : 1.6), minS = g.speed * (g.solo ? 0.15 : 0.4);
    a.vel.addScaledVector(_acc, dt);
    if (!hungry) a.vel.y *= 1 - Math.min(1, dt * 1.2);
    const s = a.vel.length();
    if (s > maxS) a.vel.multiplyScalar(maxS / s); else if (s < minS) a.vel.multiplyScalar(minS / Math.max(s, 1e-4));
    a.pos.addScaledVector(a.vel, dt);
    a.pos.set(clamp(a.pos.x, -HX + 0.2, HX - 0.2), clamp(a.pos.y, fl + 0.05, SURFACE_Y - 0.05), clamp(a.pos.z, -HZ + 0.2, HZ - 0.2));
    a.phase += dt * (3 + a.vel.length() * 5) / Math.sqrt(a.scale * 4);
    _v.copy(a.vel).normalize();
    a.dir.lerp(_v, Math.min(1, dt * (g.turtle ? 2 : 5))).normalize();

    const yaw = Math.atan2(-a.dir.z, a.dir.x), pitch = Math.asin(clamp(a.dir.y, -1, 1)) * 0.8;
    if (a.mesh) {
      a.mesh.position.copy(a.pos); a.mesh.rotation.set(0, yaw, pitch); a.mesh.scale.setScalar(a.scale);
      if (a.phaseU) a.phaseU.value = a.phase;
      if (a.legs) for (const l of a.legs) { l.piv.rotation.y = l.base + Math.sin(a.phase * 0.45 + l.off) * 0.55 * l.sign; l.piv.rotation.x = Math.cos(a.phase * 0.45 + l.off) * 0.3 * l.sign; }
    } else {
      _d.position.copy(a.pos); _d.rotation.set(0, yaw, pitch); _d.scale.setScalar(a.scale); _d.updateMatrix();
      g.mesh.setMatrixAt(i, _d.matrix);
      g.phases.array[i] = a.phase;
    }
  }
  if (g.mesh) { g.mesh.instanceMatrix.needsUpdate = true; g.phases.needsUpdate = true; }
}

// ---------- постобработка ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.7, 0.85);
composer.addPass(bloom);
const water = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: U.uTime },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    void main(){
      vec2 uv = vUv + 0.0016 * vec2(sin(vUv.y * 17.0 + uTime * 1.1), cos(vUv.x * 13.0 + uTime * 0.9));
      vec2 c = uv - 0.5; float r2 = dot(c, c);
      vec3 col = vec3(texture2D(tDiffuse, uv + c * r2 * 0.012).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * r2 * 0.012).b);
      col *= mix(1.0, 0.5, smoothstep(0.14, 0.64, r2));
      col = mix(col, col * vec3(0.84, 1.0, 1.04), 0.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(water);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const k = (h * renderer.getPixelRatio()) / 900;
  U.snow.value = 10 * k; U.bub.value = 9 * k;
}
window.addEventListener('resize', resize);
resize();

// ---------- свет ----------
let lightOn = true;
function updateLight(dt) {
  const L = U.uLight;
  L.value += ((lightOn ? 1 : 0) - L.value) * Math.min(1, dt * 2.5);
  sun.intensity = 0.12 + 1.4 * L.value;
  hemi.intensity = 0.45 + 0.55 * L.value;
  renderer.toneMappingExposure = 0.8 + 0.25 * L.value;
}

// ---------- управление ----------
const $ = (id) => document.getElementById(id);
const modal = $('modal');
const input = { nx: 0, ny: 0, boost: false, keys: new Set(), last: -1e9 };
const hint = $('hint'), bar = $('bar');
const touch = () => { input.last = performance.now(); bar.classList.remove('idle'); };
// Мышь без нажатия ничего не делает; зажатие и перетаскивание работает как джойстик (удобно на планшете).
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  input.nx = 0; input.ny = 0; input.boost = true; touch(); hint.classList.add('hidden');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  touch();
  if (!drag || drag.id !== e.pointerId) return;
  const R = Math.min(window.innerWidth, window.innerHeight) * 0.3;
  input.nx = clamp((e.clientX - drag.x) / R, -1, 1);
  input.ny = clamp((e.clientY - drag.y) / R, -1, 1);
});
const release = () => { drag = null; input.boost = false; input.nx = 0; input.ny = 0; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => {
  if (modal.classList.contains('open')) return;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  input.keys.add(e.code); touch(); hint.classList.add('hidden');
});
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); input.boost = false; });
setTimeout(() => hint.classList.add('hidden'), 9000);

const cam = { yaw: Math.PI / 2, pitch: 0, roll: 0, speed: 0.5, yawRate: 0, vy: 0 };
const dz = (v) => { const a = Math.abs(v); return a < 0.12 ? 0 : Math.sign(v) * (a - 0.12) / 0.88; };
const _f = new THREE.Vector3();

function updateCamera(dt, t) {
  const idle = performance.now() - input.last > 10000;
  if (idle) bar.classList.add('idle');
  const K = input.keys;
  let yawT, pitchT, speedT;
  if (idle) {
    yawT = Math.sin(t * 0.13) * 0.2 + Math.sin(t * 0.31) * 0.08;
    pitchT = Math.sin(t * 0.09) * 0.12 + (3.4 - camPos.y) * 0.08;
    speedT = 0.55;
    // у стёкол плавно разворачиваемся к центру
    const edge = Math.max(THREE.MathUtils.smoothstep(Math.abs(camPos.x), HX - 5, HX - 2), THREE.MathUtils.smoothstep(Math.abs(camPos.z), HZ - 3, HZ - 1.5));
    if (edge > 0) {
      let diff = Math.atan2(camPos.x, camPos.z) - cam.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      yawT += clamp(diff, -1, 1) * edge * 1.1;
    }
  } else {
    const kx = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    yawT = -(dz(input.nx) + kx * 0.8) * 1.3;
    pitchT = -dz(input.ny) * 0.75;
    const fwd = input.boost || K.has('KeyW') || K.has('ArrowUp');
    speedT = K.has('KeyS') || K.has('ArrowDown') ? -1.2 : fwd ? 2.6 : 0;
    const vert = (K.has('Space') || K.has('KeyE') ? 1 : 0) - (K.has('ShiftLeft') || K.has('ShiftRight') || K.has('KeyQ') ? 1 : 0);
    cam.vy += (vert * 1.8 - cam.vy) * Math.min(1, dt * 3);
    camPos.y += cam.vy * dt;
  }
  cam.yawRate += (yawT - cam.yawRate) * Math.min(1, dt * 3);
  cam.yaw += cam.yawRate * dt;
  cam.pitch += (pitchT - cam.pitch) * Math.min(1, dt * 2.5);
  cam.speed += (speedT - cam.speed) * Math.min(1, dt * 1.8);
  cam.roll += (-cam.yawRate * 0.1 - cam.roll) * Math.min(1, dt * 2);

  camera.rotation.set(cam.pitch + Math.sin(t * 0.7) * 0.01, cam.yaw, cam.roll + Math.sin(t * 0.5) * 0.008);
  camera.getWorldDirection(_f);
  camPos.addScaledVector(_f, cam.speed * dt);

  for (const ob of obstacles) {
    _v.subVectors(camPos, ob.pos); const d = _v.length(), R = ob.r + 0.35;
    if (d < R && d > 1e-4) camPos.addScaledVector(_v, ((R - d) / d) * Math.min(1, dt * 10));
  }
  camPos.x = clamp(camPos.x, -HX + 0.35, HX - 0.35);
  camPos.z = clamp(camPos.z, -HZ + 0.35, HZ - 0.35);
  camPos.y = clamp(camPos.y, floorY(camPos.x, camPos.z) + 0.4, SURFACE_Y - 0.35);
}

// ---------- кнопки ----------
$('feedBtn').onclick = feed;
$('lightBtn').onclick = () => { lightOn = !lightOn; };
$('fsBtn').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };
window.addEventListener('keydown', (e) => {
  if (modal.classList.contains('open') || e.repeat) return;
  if (e.code === 'KeyF') feed();
  if (e.code === 'KeyL') lightOn = !lightOn;
});

// ---------- добавление рисунков ----------
const STORE = 'aquarium.kidfish.v1';
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };
let saved = loadSaved();
saved.forEach(addKidFish);

const fileInput = $('file');
initEditor();
$('addBtn').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files[0]; fileInput.value = '';
  if (!f) return;
  let entry;
  try { entry = await editFish(f); } catch (e) { alert(e.message); return; }
  if (!entry) return;
  addKidFish(entry);
  saved.push(entry);
  try { localStorage.setItem(STORE, JSON.stringify(saved)); }
  catch { saved.pop(); alert('Память браузера заполнена: рыбка поплавает до перезагрузки страницы.'); }
};
$('clearBtn').onclick = () => {
  if (!confirm('Убрать всех нарисованных рыбок?')) return;
  for (const a of kids.agents) { scene.remove(a.mesh); if (a.flat) a.mesh.geometry.dispose(); a.mesh.material.map.dispose(); a.mesh.material.dispose(); }
  kids.agents.length = 0; saved = []; localStorage.removeItem(STORE);
  $('clearBtn').hidden = true;
};

// ---------- цикл ----------
const clock = new THREE.Clock();
let time = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  U.uTime.value = time;
  updateLight(dt);
  updateCamera(dt, time);
  updateFlakes(dt, time);
  for (const g of groups) updateGroup(g, dt, time);
  composer.render();
}
renderer.setAnimationLoop(frame);
window.__aq = { camera, cam, input, flakes, groups, feed, kids };
