import * as THREE from 'three';

// Детская комната вокруг аквариума. Аквариум стоит на тумбе у задней стены.
// Масштаб: 1 единица ≈ 7 см, поэтому комната для рыбок огромная.

function tex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export function buildRoom(scene, HX, HZ, TOP) {
  const room = new THREE.Group();
  scene.add(room);
  const FY = -13, CY = 27, X0 = -44, X1 = 44, Z0 = -HZ - 1.4, Z1 = 46;
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, fog: false, ...o });
  const box = (w, h, d, mat, x, y, z, parent = room) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof mat === 'number' ? std({ color: mat }) : mat);
    m.position.set(x, y, z); parent.add(m); return m;
  };
  const plane = (w, h, mat, x, y, z, rx, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m); return m;
  };

  // пол, потолок, стены
  const wood = tex(512, 512, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      const l = 52 + Math.random() * 14;
      g.fillStyle = `hsl(30, 45%, ${l}%)`; g.fillRect(0, i * 64, w, 64);
      g.strokeStyle = 'rgba(70,40,15,0.35)'; g.lineWidth = 2; g.strokeRect(-2, i * 64, w + 4, 64);
      for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(90,55,25,${0.05 + Math.random() * 0.12})`; g.beginPath(); const y = i * 64 + Math.random() * 64; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 2); g.stroke(); }
      const sx = Math.random() * w; g.fillStyle = 'rgba(70,40,15,0.5)'; g.fillRect(sx, i * 64, 2, 64);
    }
  }, [5, 5]);
  plane(X1 - X0, Z1 - Z0, std({ map: wood, roughness: 0.6 }), 0, FY, (Z0 + Z1) / 2, -Math.PI / 2, 0);
  plane(X1 - X0, Z1 - Z0, std({ color: 0xf7f4ec }), 0, CY, (Z0 + Z1) / 2, Math.PI / 2, 0);

  const paper = tex(512, 512, (g, w, h) => {
    g.fillStyle = '#bfe3f2'; g.fillRect(0, 0, w, h);
    const cloud = (x, y, s) => { g.fillStyle = 'rgba(255,255,255,0.9)'; for (const [dx, dy, r] of [[0, 0, 26], [28, 6, 20], [-28, 8, 18], [10, -14, 20]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, 7); g.fill(); } };
    cloud(110, 110, 1); cloud(370, 250, 1.2); cloud(170, 400, 0.9);
    g.fillStyle = '#ffd43b';
    for (const [x, y] of [[300, 80], [60, 260], [440, 430], [250, 330]]) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 6 : 14; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.fill(); }
  });
  const wall = (rep) => { const t = paper.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, 2); t.needsUpdate = true; return std({ map: t }); };
  const H = CY - FY, yc = (CY + FY) / 2;
  plane(X1 - X0, H, wall(4), 0, yc, Z0, 0, 0);
  plane(X1 - X0, H, wall(4), 0, yc, Z1, 0, Math.PI);
  plane(Z1 - Z0, H, wall(3), X0, yc, (Z0 + Z1) / 2, 0, Math.PI / 2);
  plane(Z1 - Z0, H, wall(3), X1, yc, (Z0 + Z1) / 2, 0, -Math.PI / 2);
  // плинтус
  box(X1 - X0, 1.2, 0.4, 0xffffff, 0, FY + 0.6, Z0 + 0.2); box(X1 - X0, 1.2, 0.4, 0xffffff, 0, FY + 0.6, Z1 - 0.2);
  box(0.4, 1.2, Z1 - Z0, 0xffffff, X0 + 0.2, FY + 0.6, (Z0 + Z1) / 2); box(0.4, 1.2, Z1 - Z0, 0xffffff, X1 - 0.2, FY + 0.6, (Z0 + Z1) / 2);

  // окно на левой стене
  const sky = tex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6fb8ff'); gr.addColorStop(0.75, '#d6efff'); gr.addColorStop(1, '#9bd08a');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.95)'; for (const [x, y, r] of [[60, 70, 22], [85, 62, 28], [112, 72, 20], [180, 120, 18], [200, 114, 24]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    g.fillStyle = '#4c9a4a'; g.beginPath(); g.arc(215, 215, 55, 0, 7); g.fill(); g.fillStyle = '#6b4a2b'; g.fillRect(208, 215, 14, 41);
  });
  const win = { emissive: 0xffffff, emissiveMap: sky, emissiveIntensity: 1.6, color: 0x000000 };
  const wz = 20, wy = 9;
  plane(24, 20, std(win), X0 + 0.15, wy, wz, 0, Math.PI / 2);
  for (const [w, h, y, z] of [[26, 1.2, wy + 10.3, wz], [26, 1.6, wy - 10.5, wz], [1.2, 20, wy, wz - 12.4], [1.2, 20, wy, wz + 12.4], [0.7, 20, wy, wz], [24, 0.7, wy + 2, wz]]) box(0.8, h, w, 0xffffff, X0 + 0.5, y, z);
  const curt = std({ color: 0xff9ec4, roughness: 1 });
  box(1, 25, 6, curt, X0 + 1.2, wy - 1, wz - 15.5); box(1, 25, 6, curt, X0 + 1.2, wy - 1, wz + 15.5);
  box(0.6, 0.6, 40, 0xc9a26b, X0 + 1.2, wy + 12, wz);

  // тумба под аквариумом и крышка с лампой
  box(HX * 2 + 2, 12.6, HZ * 2 + 1.6, std({ color: 0xf2efe6, roughness: 0.5 }), 0, FY + 6.3, 0);
  box(HX * 2 + 2.4, 0.5, HZ * 2 + 2, 0xd9c7a3, 0, -0.45, 0);
  box(HX * 2 + 0.5, 1.2, HZ * 2 + 0.5, std({ color: 0x1b1d21, roughness: 0.4 }), 0, TOP + 1.5, 0);

  // ковёр
  const rug = tex(256, 256, (g, w) => { const cols = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2', '#fff3bf']; cols.forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(w / 2, w / 2, w / 2 * (1 - i / cols.length), 0, 7); g.fill(); }); });
  const rugM = new THREE.Mesh(new THREE.CircleGeometry(15, 48), std({ map: rug, roughness: 1 }));
  rugM.rotation.x = -Math.PI / 2; rugM.position.set(-4, FY + 0.06, 24); room.add(rugM);

  // кровать справа
  const bx = X1 - 9.5, bz = 20;
  box(17, 3, 32, 0xc9a26b, bx, FY + 3, bz);
  box(16, 2.4, 31, 0xffffff, bx, FY + 5.6, bz);
  const quilt = tex(256, 256, (g, w, h) => { g.fillStyle = '#4263eb'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffe066'; for (let i = 0; i < 24; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 5 + Math.random() * 6, 0, 7); g.fill(); } }, [1, 2]);
  box(16.6, 2.2, 22, std({ map: quilt, roughness: 1 }), bx, FY + 6.2, bz - 4.6);
  box(11, 1.6, 6, 0xfff0f6, bx, FY + 7.4, bz + 11.5);
  box(17, 10, 1.2, 0xc9a26b, bx, FY + 7, bz + 16.4);
  // плакат над кроватью
  const poster = tex(256, 320, (g, w, h) => {
    g.fillStyle = '#1b2a6b'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    g.fillStyle = '#f1f3f5'; g.beginPath(); g.moveTo(128, 50); g.quadraticCurveTo(175, 130, 160, 230); g.lineTo(96, 230); g.quadraticCurveTo(81, 130, 128, 50); g.fill();
    g.fillStyle = '#fa5252'; g.beginPath(); g.moveTo(96, 190); g.lineTo(60, 250); g.lineTo(96, 230); g.fill(); g.beginPath(); g.moveTo(160, 190); g.lineTo(196, 250); g.lineTo(160, 230); g.fill();
    g.fillStyle = '#4dabf7'; g.beginPath(); g.arc(128, 130, 18, 0, 7); g.fill();
    g.fillStyle = '#ffa94d'; g.beginPath(); g.moveTo(108, 232); g.lineTo(128, 290); g.lineTo(148, 232); g.fill();
  });
  plane(11, 14, std({ map: poster }), X1 - 0.15, 12, bz, 0, -Math.PI / 2);

  // стеллаж с книгами и игрушками у дальней стены
  const sx = 14, sz = Z1 - 2.2;
  box(26, 30, 0.6, 0xe8d5b0, sx, FY + 15, sz + 1.7);
  for (const dx of [-13, 13]) box(0.8, 30, 4, 0xe8d5b0, sx + dx, FY + 15, sz);
  const bookCols = [0xff6b6b, 0x4dabf7, 0x69db7c, 0xffd43b, 0xda77f2, 0xff922b, 0x20c997, 0xf06595];
  for (let r = 0; r < 4; r++) {
    const y = FY + 0.4 + r * 7.4;
    box(26, 0.8, 4, 0xe8d5b0, sx, y, sz);
    let x = sx - 12;
    while (x < sx + 11) {
      if (Math.random() < 0.12) { x += 3; continue; }
      const w = 0.7 + Math.random() * 0.9, h = 3.6 + Math.random() * 2;
      box(w, h, 2.8, bookCols[(Math.random() * bookCols.length) | 0], x + w / 2, y + 0.4 + h / 2, sz);
      x += w + 0.08;
    }
  }
  box(26, 0.8, 4, 0xe8d5b0, sx, FY + 30, sz);
  // дверь
  box(13, 28, 0.6, 0xfdf6e3, -26, FY + 14, Z1 - 0.3); box(1, 1, 1.6, 0xd4a017, -21, FY + 13, Z1 - 1);

  // игрушки: кубики, мяч, мишка
  const cube = (c, x, z, y = 0, ry = 0) => { const m = box(3.2, 3.2, 3.2, std({ color: c, roughness: 0.5 }), x, FY + 1.6 + y, z); m.rotation.y = ry; };
  cube(0xff6b6b, -14, 14, 0, 0.3); cube(0x4dabf7, -10.4, 15, 0, -0.2); cube(0xffd43b, -12.3, 14.6, 3.2, 0.6); cube(0x69db7c, 8, 30, 0, 0.9);
  const ballT = tex(128, 64, (g, w, h) => { ['#ff6b6b', '#ffffff', '#4dabf7', '#ffffff', '#ffd43b', '#ffffff'].forEach((c, i) => { g.fillStyle = c; g.fillRect(i * w / 6, 0, w / 6 + 1, h); }); });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(3.2, 32, 20), std({ map: ballT, roughness: 0.35 }));
  ball.position.set(6, FY + 3.2, 17); ball.rotation.set(0.5, 0.3, 0.4); room.add(ball);
  const bear = new THREE.Group(); bear.position.set(-22, FY, 22); bear.rotation.y = 2.4; room.add(bear);
  const fur = std({ color: 0xb07a45, roughness: 1 }), fur2 = std({ color: 0xe6c79c, roughness: 1 }), blk = std({ color: 0x1a1a1a, roughness: 0.3 });
  const ball3 = (r, m, x, y, z, sx = 1, sy = 1, sz2 = 1) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m); s.position.set(x, y, z); s.scale.set(sx, sy, sz2); bear.add(s); };
  ball3(3.6, fur, 0, 3.6, 0, 1, 1.05, 0.9); ball3(2.6, fur, 0, 8.6, 0); ball3(2.2, fur2, 0, 3.4, 1.7, 1, 1, 0.5);
  ball3(1.1, fur2, 0, 8, 2.1, 1, 0.8, 0.8); ball3(0.35, blk, 0, 8.3, 3); ball3(0.3, blk, -0.9, 9.3, 2.25); ball3(0.3, blk, 0.9, 9.3, 2.25);
  ball3(1, fur, -2, 10.7, 0, 1, 1, 0.5); ball3(1, fur, 2, 10.7, 0, 1, 1, 0.5);
  ball3(1.3, fur, -3.6, 5, 0.8, 0.8, 1.5, 0.8); ball3(1.3, fur, 3.6, 5, 0.8, 0.8, 1.5, 0.8);
  ball3(1.6, fur, -2.2, 1.2, 2.6, 0.9, 0.8, 1.5); ball3(1.6, fur, 2.2, 1.2, 2.6, 0.9, 0.8, 1.5);

  // столик со стулом у окна
  box(14, 0.8, 9, 0xf8f0dc, X0 + 9, FY + 8, 40); for (const [dx, dz] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) box(0.8, 8, 0.8, 0xf8f0dc, X0 + 9 + dx, FY + 4, 40 + dz);
  box(5, 0.7, 5, 0x74c0fc, X0 + 10, FY + 5, 33); box(5, 6, 0.7, 0x74c0fc, X0 + 10, FY + 8, 30.8); for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) box(0.6, 5, 0.6, 0x74c0fc, X0 + 10 + dx, FY + 2.5, 33 + dz);

  // люстра
  box(0.2, 6, 0.2, 0x555555, 0, CY - 3, 22);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), std({ color: 0x000000, emissive: 0xfff1c9, emissiveIntensity: 1.4 }));
  lamp.position.set(0, CY - 7, 22); room.add(lamp);
  return room;
}
