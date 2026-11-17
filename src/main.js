import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SPECIES, fishGeometry, fishTexture } from './fish.js';
import { loadToCanvas, cutout } from './cutout.js';

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

const WORLD_R = 40, SURFACE_Y = 11;
const floorY = (x, z) => Math.sin(x * 0.08) * Math.cos(z * 0.06) * 1.2 + Math.sin(x * 0.31 + z * 0.2) * 0.15;
const FOG = new THREE.Color(0x0a587c);
const FOG_DENSITY = 0.055;

// ---------- рендерер ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = FOG.clone();
scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);
const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 220);
camera.rotation.order = 'YXZ';
camera.position.set(0, 3.2, 6);

scene.add(new THREE.HemisphereLight(0x8fd6f5, 0x0b2f40, 1.0));
const sun = new THREE.DirectionalLight(0xdff6ff, 1.5);
sun.position.set(0.35, 1, 0.25);
scene.add(sun);

const U = { uTime: { value: 0 } };

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
    sh.uniforms.uTime = U.uTime;
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
        transformed.x += (sin(ph + hh * 3.0) * 0.5 + sin(ph * 0.63 + hh * 6.0) * 0.2) * hh * hh;
        transformed.z += cos(ph * 0.8 + hh * 4.0) * 0.25 * hh * hh;`;
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
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\n' + CAUSTIC_GLSL)
      .replace('#include <opaque_fragment>', `{
          vec3 wn = inverseTransformDirection(normal, viewMatrix);
          float ca = caustic(vWPos.xz * 0.07 + vec2(vWPos.y * 0.03), uTime * 0.5);
          float depthF = smoothstep(-2.0, 11.0, vWPos.y) * 0.6 + 0.4;
          outgoingLight += diffuseColor.rgb * ca * 1.7 * clamp(wn.y * 0.7 + 0.45, 0.0, 1.0) * depthF;
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

// ---------- дно ----------
function sandTextures() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#b5a37c'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(120,95,60,${0.1 + Math.random() * 0.25})` : `rgba(255,250,235,${0.1 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const b = document.createElement('canvas'); b.width = b.height = S;
  const h = b.getContext('2d');
  const img = h.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * Math.PI * 2, v = y / S * Math.PI * 2;
    const r = Math.sin(v * 9 + Math.sin(u * 2) * 1.6 + Math.sin(u * 5 + v) * 0.5) * 0.5 + 0.5;
    const val = r * 200 + Math.random() * 55;
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = val; img.data[i + 3] = 255;
  }
  h.putImageData(img, 0, 0);
  const bump = new THREE.CanvasTexture(b);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  map.repeat.set(60, 60); bump.repeat.set(22, 22);
  return { map, bump };
}
{
  const geo = new THREE.PlaneGeometry(320, 320, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, floorY(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const { map, bump } = sandTextures();
  scene.add(new THREE.Mesh(geo, patch(new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.2, roughness: 1, metalness: 0 }))));
}

// ---------- камни ----------
const bigRocks = [];
{
  const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  for (let v = 0; v < 3; v++) {
    let geo = new THREE.IcosahedronGeometry(1, 9);
    geo.deleteAttribute('uv'); geo.deleteAttribute('normal');
    geo = mergeVertices(geo, 1e-4);
    const p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), o = v * 17.3;
      const k = 0.7 + 0.75 * fbm(x * 1.4 + o, y * 1.4 + o, z * 1.4) + 0.08 * noise3(x * 9 + o, y * 9, z * 9);
      p.setXYZ(i, x * k, y * k * 0.8, z * k);
      const n = fbm(x * 5 + o, y * 5, z * 5), m = noise3(x * 2 + o, y * 2 + 5, z * 2);
      const alg = Math.max(0, y) * m;
      col.push(0.13 + n * 0.16 - alg * 0.05, 0.125 + n * 0.14 + alg * 0.07, 0.115 + n * 0.12 - alg * 0.02);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const N = 16, mesh = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D();
    for (let i = 0; i < N; i++) {
      const big = i < 3;
      const a = rr(0, Math.PI * 2), r = big ? rr(9, 32) : rr(3, 38);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, s = big ? rr(2.6, 4.8) : rr(0.3, 1.5);
      d.position.set(x, floorY(x, z) + s * 0.15, z);
      d.rotation.set(rr(-0.3, 0.3), rr(0, 6.28), rr(-0.3, 0.3));
      d.scale.set(s * rr(0.8, 1.4), s * rr(0.7, 1.1), s * rr(0.8, 1.4));
      d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      if (big) bigRocks.push({ pos: d.position.clone(), r: s * 1.35 });
    }
    scene.add(mesh);
  }
}

// ---------- кораллы ----------
{
  const geo = new THREE.CylinderGeometry(0.075, 0.04, 1, 8, 4);
  geo.translate(0, 0.5, 0);
  const clusters = 26, per = 16;
  const mesh = new THREE.InstancedMesh(geo, patch(new THREE.MeshStandardMaterial({ roughness: 0.7 })), clusters * per);
  const d = new THREE.Object3D(), c = new THREE.Color();
  const pal = [0xff5d8f, 0xff9e3d, 0xb46bff, 0xff4d4d, 0x3de0c8, 0xffd23d];
  let k = 0;
  for (let i = 0; i < clusters; i++) {
    const a = rr(0, 6.28), r = rr(4, 36), cx = Math.cos(a) * r, cz = Math.sin(a) * r, base = pal[i % pal.length];
    for (let j = 0; j < per; j++) {
      const x = cx + rr(-0.45, 0.45), z = cz + rr(-0.45, 0.45), s = rr(0.6, 1.8);
      d.position.set(x, floorY(x, z) - 0.05, z);
      d.rotation.set(rr(-0.45, 0.45), rr(0, 6.28), rr(-0.45, 0.45));
      d.scale.set(s, rr(0.5, 1.5), s);
      d.updateMatrix(); mesh.setMatrixAt(k, d.matrix);
      mesh.setColorAt(k++, c.setHex(base).offsetHSL(rr(-0.03, 0.03), 0, rr(-0.1, 0.1)));
    }
  }
  scene.add(mesh);
}

// ---------- водоросли ----------
{
  const geo = new THREE.PlaneGeometry(0.5, 1, 4, 20);
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
  gr.addColorStop(0, '#1d3b12'); gr.addColorStop(0.6, '#4f7a1c'); gr.addColorStop(1, '#a3b83a');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
  g.fillStyle = 'rgba(20,40,10,0.45)'; g.fillRect(29, 0, 6, 256);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const plants = 80, blades = 5;
  const mesh = new THREE.InstancedMesh(geo, patch(new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.6 }), 'kelp'), plants * blades);
  const d = new THREE.Object3D();
  let k = 0;
  for (let i = 0; i < plants; i++) {
    const a = rr(0, 6.28), r = rr(5, 39), cx = Math.cos(a) * r, cz = Math.sin(a) * r, hgt = rr(2.5, 8);
    for (let j = 0; j < blades; j++) {
      const x = cx + rr(-0.35, 0.35), z = cz + rr(-0.35, 0.35);
      d.position.set(x, floorY(x, z) - 0.1, z);
      d.rotation.set(0, rr(0, 6.28), 0);
      d.scale.set(rr(0.8, 1.5), hgt * rr(0.6, 1), 1);
      d.updateMatrix(); mesh.setMatrixAt(k++, d.matrix);
    }
  }
  mesh.frustumCulled = false;
  scene.add(mesh);
}

// ---------- поверхность воды (вид снизу) ----------
{
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFog: { value: FOG }, uDensity: { value: FOG_DENSITY * 0.55 } },
    side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uFog; uniform float uDensity; varying vec3 vW;
      ${CAUSTIC_GLSL}
      void main(){
        float c = caustic(vW.xz * 0.045, uTime * 0.35) + 0.5 * caustic(vW.xz * 0.11 + 3.0, uTime * 0.5);
        float d = length(vW.xz - cameraPosition.xz);
        float win = smoothstep(16.0, 0.0, d);
        vec3 col = mix(vec3(0.06, 0.42, 0.6), vec3(0.8, 0.97, 1.0), clamp(win * 0.75 + c * 0.9, 0.0, 1.0));
        col += vec3(1.0) * c * win * 1.5;
        float dist = length(vW - cameraPosition);
        float f = 1.0 - exp(-pow(dist * uDensity, 2.0));
        gl_FragColor = vec4(mix(col, uFog, f), 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat);
  m.rotation.x = Math.PI / 2; m.position.y = SURFACE_Y;
  scene.add(m);
}

// ---------- лучи света ----------
{
  const geo = new THREE.CylinderGeometry(0.25, 1.6, 13, 14, 1, true);
  const N = 70, seeds = new Float32Array(N);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
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
    fragmentShader: `uniform float uTime; varying float vY; varying float vF; varying float vSeed; varying float vDist;
      void main(){
        float flick = 0.55 + 0.45 * sin(uTime * (0.4 + vSeed) + vSeed * 40.0);
        float a = pow(vF, 2.5) * smoothstep(0.0, 0.9, vY) * flick * 0.11;
        a *= exp(-vDist * 0.035) * smoothstep(0.5, 3.0, vDist);
        gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N), d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const a = rr(0, 6.28), r = Math.sqrt(rnd()) * 46, s = rr(0.6, 2.2);
    d.position.set(Math.cos(a) * r, SURFACE_Y - 6.3, Math.sin(a) * r);
    d.rotation.set(0.16, 0, -0.22);
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
  const N = 2200, L = 28, pos = new Float32Array(N * 3), sd = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = Math.random() * L; pos[i * 3 + 1] = Math.random() * L; pos[i * 3 + 2] = Math.random() * L; sd[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uScale: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.2 + aSeed * 30.0) * 0.4, -uTime * 0.06 * (0.5 + aSeed), cos(uTime * 0.17 + aSeed * 20.0) * 0.4);
        p = mod(p - cameraPosition, ${L}.0) - ${L / 2}.0 + cameraPosition;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp(uScale * (5.0 + aSeed * 9.0) / d, 1.0, 14.0);
        vA = smoothstep(${L / 2}.0, 4.0, d) * smoothstep(0.2, 1.2, d) * (0.25 + 0.5 * aSeed);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.85, 0.95, 1.0, smoothstep(0.5, 0.1, r) * vA); }`,
  }));
  pts.frustumCulled = false; pts.renderOrder = 6;
  scene.add(pts);
  U.snow = pts.material.uniforms.uScale;
}
{
  const vents = 12, per = 34, N = vents * per;
  const pos = new Float32Array(N * 3), sd = new Float32Array(N * 3);
  for (let v = 0; v < vents; v++) {
    const a = rr(0, 6.28), r = rr(3, 34), x = Math.cos(a) * r, z = Math.sin(a) * r, y = floorY(x, z);
    for (let j = 0; j < per; j++) {
      const i = v * per + j;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      sd[i * 3] = Math.random(); sd[i * 3 + 1] = 0.7 + Math.random() * 0.9; sd[i * 3 + 2] = Math.random() * 12;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 3));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uScale: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime; uniform float uScale; attribute vec3 aSeed; varying float vA;
      void main(){
        float h = mod(aSeed.z + uTime * aSeed.y, 12.0);
        vec3 p = position + vec3(sin(h * 2.3 + aSeed.x * 20.0) * 0.12 * h * 0.4, h, cos(h * 1.9 + aSeed.x * 31.0) * 0.12 * h * 0.4);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp(uScale * (6.0 + aSeed.x * 11.0 + h * 0.8) / d, 1.0, 26.0);
        vA = smoothstep(0.0, 0.6, h) * smoothstep(${SURFACE_Y}.0 - position.y, ${SURFACE_Y - 1}.0 - position.y, h) * exp(-d * 0.05);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main(){
        vec2 q = gl_PointCoord - 0.5; float r = length(q);
        float ring = smoothstep(0.5, 0.44, r) * smoothstep(0.3, 0.47, r);
        float hl = smoothstep(0.14, 0.0, length(q - vec2(-0.16, -0.18)));
        float a = (ring * 0.75 + hl * 0.9 + smoothstep(0.5, 0.45, r) * 0.08) * vA;
        gl_FragColor = vec4(0.88, 0.97, 1.0, a); }`,
  }));
  pts.frustumCulled = false; pts.renderOrder = 7;
  scene.add(pts);
  U.bub = pts.material.uniforms.uScale;
}

// ---------- рыбки ----------
const groups = [];
const camPos = camera.position;
const _v = new THREE.Vector3(), _acc = new THREE.Vector3(), _avg = new THREE.Vector3(), _d = new THREE.Object3D();
_d.rotation.order = 'YZX';

function newTarget(sc, near) {
  if (near) return;
  const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 30;
  sc.target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  sc.target.y = floorY(sc.target.x, sc.target.z) + 1.2 + Math.random() * 6.5;
  sc.timer = 12 + Math.random() * 20;
}
function makeAgent(school, scale, spread) {
  const pos = school.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.5, (Math.random() - 0.5) * spread));
  pos.y = Math.max(pos.y, floorY(pos.x, pos.z) + 0.6);
  const a = Math.random() * 6.28;
  return { pos, vel: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), phase: Math.random() * 6.28, scale, school, f1: 0.3 + Math.random() * 0.5, p1: Math.random() * 6.28 };
}

for (const sp of SPECIES) {
  const mat = patch(new THREE.MeshStandardMaterial({ map: fishTexture(sp), roughness: 0.42, metalness: sp.metal, side: THREE.DoubleSide }), 'fish');
  const geo = fishGeometry(sp);
  const mesh = new THREE.InstancedMesh(geo, mat, sp.count);
  const phases = new THREE.InstancedBufferAttribute(new Float32Array(sp.count), 1);
  phases.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPhase', phases);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const nSchools = sp.count > 40 ? 2 : 1, schools = [];
  for (let s = 0; s < nSchools; s++) {
    const sc = { center: new THREE.Vector3(), target: new THREE.Vector3(), timer: 0 };
    newTarget(sc); sc.center.copy(sc.target); newTarget(sc);
    schools.push(sc);
  }
  if (sp.name === 'clown') schools[0].center.set(1, 2.6, -1);
  if (sp.name === 'tang') schools[0].center.set(-4, 4, -6);
  const agents = [];
  for (let i = 0; i < sp.count; i++) agents.push(makeAgent(schools[i % nSchools], sp.scale * (0.75 + Math.random() * 0.5), sp.count > 5 ? 5 : 14));
  groups.push({ agents, schools, mesh, phases, speed: sp.speed, sep: sp.scale * 2.6, solo: sp.count <= 5 });
}

// нарисованные рыбки
const kidSchool = { center: new THREE.Vector3(0, 3, 2), target: new THREE.Vector3(), timer: 0 };
const kids = { agents: [], schools: [kidSchool], speed: 0.9, sep: 1.3, solo: false, followCam: true };
groups.push(kids);

function addKidFish(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; tex.anisotropy = 4;
    const phase = { value: 0 };
    const mat = patch(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0x555555, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }), 'kid', phase);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2 * img.height / img.width, 28, 1), mat);
    mesh.rotation.order = 'YZX';
    mesh.frustumCulled = false;
    scene.add(mesh);
    const ag = makeAgent(kidSchool, 0.4 + Math.random() * 0.12, 3);
    ag.mesh = mesh; ag.phaseU = phase;
    kids.agents.push(ag);
    document.getElementById('clearBtn').hidden = false;
  };
  img.src = dataUrl;
}

function updateGroup(g, dt, t) {
  const A = g.agents;
  for (const sc of g.schools) {
    if (g.followCam) {
      camera.getWorldDirection(_v);
      sc.target.copy(camPos).addScaledVector(_v, 6);
      sc.target.y = Math.max(sc.target.y, floorY(sc.target.x, sc.target.z) + 1);
      sc.center.lerp(sc.target, Math.min(1, dt * 0.8));
    } else {
      sc.timer -= dt;
      _v.subVectors(sc.target, sc.center);
      const d = _v.length();
      if (d < 1.5 || sc.timer < 0) newTarget(sc);
      else sc.center.addScaledVector(_v, Math.min(1, (g.speed * 0.9 * dt) / d));
    }
  }
  const maxS = g.speed * 1.9, minS = g.speed * 0.45;
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    _acc.subVectors(a.school.center, a.pos);
    const dc = _acc.length();
    _acc.multiplyScalar((g.solo ? 0.05 : 0.22) * (dc > 6 ? 2.2 : 1));
    _acc.y *= 1.5;
    if (!g.solo) {
      _avg.set(0, 0, 0); let cnt = 0;
      for (let j = 0; j < A.length; j++) {
        if (j === i) continue;
        const b = A[j];
        const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 6.25) {
          _avg.add(b.vel); cnt++;
          if (d2 < g.sep * g.sep && d2 > 1e-6) { const d = Math.sqrt(d2), k = ((g.sep - d) / d) * 5; _acc.x += dx * k; _acc.y += dy * k; _acc.z += dz * k; }
        }
      }
      if (cnt) _acc.addScaledVector(_avg.multiplyScalar(1 / cnt).sub(a.vel), 0.7);
    }
    _acc.x += Math.sin(t * a.f1 + a.p1) * 0.7; _acc.z += Math.cos(t * a.f1 * 1.3 + a.p1 * 2) * 0.7; _acc.y += Math.sin(t * a.f1 * 0.7 + a.p1 * 3) * 0.3;
    // не врезаться в камеру и большие камни
    _v.subVectors(a.pos, camPos); let d = _v.length();
    const cr = 1.2 + a.scale * 2;
    if (d < cr && d > 1e-4) _acc.addScaledVector(_v, ((cr - d) / d) * 7);
    for (const rk of bigRocks) {
      _v.subVectors(a.pos, rk.pos); d = _v.length();
      const R = rk.r + 0.8;
      if (d < R) _acc.addScaledVector(_v, ((R - d) / d) * 9);
    }
    const fy = floorY(a.pos.x, a.pos.z) + 0.5 + a.scale * 0.5;
    if (a.pos.y < fy) _acc.y += (fy - a.pos.y) * 10;
    if (a.pos.y > SURFACE_Y - 1.5) _acc.y -= (a.pos.y - SURFACE_Y + 1.5) * 10;
    const rad = Math.hypot(a.pos.x, a.pos.z);
    if (rad > WORLD_R) { _acc.x -= a.pos.x / rad * (rad - WORLD_R) * 3; _acc.z -= a.pos.z / rad * (rad - WORLD_R) * 3; }

    a.vel.addScaledVector(_acc, dt);
    a.vel.y *= 1 - Math.min(1, dt * 1.2);
    const s = a.vel.length();
    if (s > maxS) a.vel.multiplyScalar(maxS / s); else if (s < minS) a.vel.multiplyScalar(minS / Math.max(s, 1e-4));
    a.pos.addScaledVector(a.vel, dt);
    a.phase += dt * (3 + a.vel.length() * 5) / Math.sqrt(a.scale * 4);
    _v.copy(a.vel).normalize();
    a.dir.lerp(_v, Math.min(1, dt * 5)).normalize();

    const yaw = Math.atan2(-a.dir.z, a.dir.x), pitch = Math.asin(THREE.MathUtils.clamp(a.dir.y, -1, 1)) * 0.8;
    if (a.mesh) {
      a.mesh.position.copy(a.pos); a.mesh.rotation.set(0, yaw, pitch); a.mesh.scale.setScalar(a.scale);
      a.phaseU.value = a.phase;
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
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.7, 0.82);
composer.addPass(bloom);
const water = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: U.uTime },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    void main(){
      vec2 uv = vUv + 0.0016 * vec2(sin(vUv.y * 17.0 + uTime * 1.1), cos(vUv.x * 13.0 + uTime * 0.9));
      vec2 c = uv - 0.5; float r2 = dot(c, c);
      vec3 col = vec3(texture2D(tDiffuse, uv + c * r2 * 0.012).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * r2 * 0.012).b);
      col *= mix(1.0, 0.42, smoothstep(0.12, 0.62, r2));
      col = mix(col, col * vec3(0.86, 1.0, 1.08), 0.5);
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
  U.snow.value = 10 * k; U.bub.value = 8 * k;
}
window.addEventListener('resize', resize);
resize();

// ---------- управление ----------
const input = { nx: 0, ny: 0, boost: false, keys: new Set(), last: -1e9 };
const hint = document.getElementById('hint'), bar = document.getElementById('bar');
const touch = () => { input.last = performance.now(); bar.classList.remove('idle'); };
canvas.addEventListener('pointermove', (e) => {
  input.nx = (e.clientX / window.innerWidth) * 2 - 1;
  input.ny = (e.clientY / window.innerHeight) * 2 - 1;
  touch();
});
canvas.addEventListener('pointerdown', (e) => {
  input.nx = (e.clientX / window.innerWidth) * 2 - 1;
  input.ny = (e.clientY / window.innerHeight) * 2 - 1;
  input.boost = true; touch(); hint.classList.add('hidden');
  canvas.setPointerCapture(e.pointerId);
});
const release = (e) => { input.boost = false; if (e.pointerType !== 'mouse') { input.nx = 0; input.ny = 0; } };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => { input.keys.add(e.code); touch(); });
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); input.boost = false; });
setTimeout(() => hint.classList.add('hidden'), 9000);

const cam = { yaw: 0, pitch: 0, roll: 0, speed: 1, yawRate: 0 };
const dz = (v) => { const a = Math.abs(v); return a < 0.12 ? 0 : Math.sign(v) * (a - 0.12) / 0.88; };
const _f = new THREE.Vector3();

function updateCamera(dt, t) {
  const idle = performance.now() - input.last > 10000;
  if (idle) bar.classList.add('idle');
  const K = input.keys;
  let yawT, pitchT, speedT;
  if (idle) {
    yawT = Math.sin(t * 0.13) * 0.22 + Math.sin(t * 0.31) * 0.08;
    pitchT = Math.sin(t * 0.09) * 0.14;
    speedT = 1.1;
  } else {
    let kx = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    yawT = -(dz(input.nx) + kx * 0.8) * 1.3;
    pitchT = -dz(input.ny) * 0.75;
    const fwd = input.boost || K.has('KeyW') || K.has('ArrowUp') || K.has('Space');
    speedT = K.has('KeyS') || K.has('ArrowDown') ? -1 : fwd ? 4.2 : 0.9;
  }
  // мягко разворачиваемся у границ
  const rad = Math.hypot(camPos.x, camPos.z);
  const edge = THREE.MathUtils.smoothstep(rad, idle ? 20 : 31, idle ? 32 : 38);
  if (edge > 0) {
    let diff = Math.atan2(camPos.x, camPos.z) - cam.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    yawT += THREE.MathUtils.clamp(diff, -1, 1) * edge * 1.2;
  }
  cam.yawRate += (yawT - cam.yawRate) * Math.min(1, dt * 3);
  cam.yaw += cam.yawRate * dt;
  cam.pitch += (pitchT - cam.pitch) * Math.min(1, dt * 2.5);
  cam.speed += (speedT - cam.speed) * Math.min(1, dt * 1.8);
  cam.roll += (-cam.yawRate * 0.12 - cam.roll) * Math.min(1, dt * 2);

  camera.rotation.set(cam.pitch + Math.sin(t * 0.7) * 0.012, cam.yaw, cam.roll + Math.sin(t * 0.5) * 0.01);
  camera.getWorldDirection(_f);
  camPos.addScaledVector(_f, cam.speed * dt);
  camPos.y += Math.sin(t * 0.9) * 0.05 * dt;

  if (rad > WORLD_R - 1) { const k = (WORLD_R - 1) / rad; camPos.x *= k; camPos.z *= k; }
  const minY = floorY(camPos.x, camPos.z) + 0.7;
  if (camPos.y < minY) camPos.y += (minY - camPos.y) * Math.min(1, dt * 8);
  if (camPos.y > SURFACE_Y - 1) camPos.y += (SURFACE_Y - 1 - camPos.y) * Math.min(1, dt * 8);
  for (const rk of bigRocks) {
    _v.subVectors(camPos, rk.pos); const d = _v.length(), R = rk.r + 0.6;
    if (d < R && d > 1e-4) camPos.addScaledVector(_v, ((R - d) / d) * Math.min(1, dt * 10));
  }
}

// ---------- добавление рисунков ----------
const STORE = 'aquarium.kidfish.v1';
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } };
let saved = loadSaved();
saved.forEach(addKidFish);

const $ = (id) => document.getElementById(id);
const modal = $('modal'), preview = $('preview'), fileInput = $('file');
let srcCanvas = null, flip = false, result = null;
function refreshPreview() {
  result = cutout(srcCanvas, +$('thr').value, flip);
  const g = preview.getContext('2d');
  if (!result) { preview.width = preview.height = 1; g.clearRect(0, 0, 1, 1); return; }
  preview.width = result.width; preview.height = result.height;
  g.drawImage(result, 0, 0);
}
$('addBtn').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files[0]; fileInput.value = '';
  if (!f) return;
  try { srcCanvas = await loadToCanvas(f); } catch (e) { alert(e.message); return; }
  flip = false; refreshPreview(); modal.classList.add('open');
};
$('thr').oninput = refreshPreview;
$('flipBtn').onclick = () => { flip = !flip; refreshPreview(); };
$('cancelBtn').onclick = () => modal.classList.remove('open');
$('okBtn').onclick = () => {
  if (!result) { alert('Рыбка не нашлась — подвигайте ползунок или переснимите фото.'); return; }
  const url = result.toDataURL('image/png');
  addKidFish(url);
  saved.push(url);
  try { localStorage.setItem(STORE, JSON.stringify(saved)); }
  catch { saved.pop(); alert('Память браузера заполнена: рыбка поплавает до перезагрузки страницы.'); }
  modal.classList.remove('open');
};
$('clearBtn').onclick = () => {
  if (!confirm('Убрать всех нарисованных рыбок?')) return;
  for (const a of kids.agents) { scene.remove(a.mesh); a.mesh.geometry.dispose(); a.mesh.material.map.dispose(); a.mesh.material.dispose(); }
  kids.agents.length = 0; saved = []; localStorage.removeItem(STORE);
  $('clearBtn').hidden = true;
};
$('fsBtn').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };

// ---------- цикл ----------
const clock = new THREE.Clock();
let time = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  U.uTime.value = time;
  updateCamera(dt, time);
  for (const g of groups) updateGroup(g, dt, time);
  composer.render();
}
renderer.setAnimationLoop(frame);
window.__aq = { camera, cam, input };
