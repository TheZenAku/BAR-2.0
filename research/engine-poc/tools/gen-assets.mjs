// Generates the POC assets procedurally (100% original, no external licenses):
//   public/assets/bar-greybox.glb      static greybox bar (shared meshes for repeated props)
//   public/assets/bar-colliders.json   axis-aligned box colliders + spawn area (engine-independent)
//   public/assets/avatar.glb           skinned technical avatar (18 joints, 4 materials, Idle/Walk/Sit)
// Conventions: glTF 2.0, meters, +Y up, avatar faces +Z, origin at feet.
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
mkdirSync(OUT, { recursive: true });

// ---------- geometry helpers ----------
class Geo {
  pos = []; nrm = []; uv = []; idx = []; joints = []; weights = [];
  get count() { return this.pos.length / 3; }
  vert(p, n, uv, j = [0, 0, 0, 0], w = [1, 0, 0, 0]) {
    this.pos.push(...p); this.nrm.push(...n); this.uv.push(...uv); this.joints.push(...j); this.weights.push(...w);
    return this.count - 1;
  }
  // Axis-aligned box centered at c with size s.
  box(c, s, j, w) {
    const h = s.map((v) => v / 2);
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    ];
    for (const [n, u, v] of faces) {
      const base = this.count;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 1, 2].map((k) => c[k] + n[k] * h[k] + u[k] * a * h[k] + v[k] * b * h[k]);
        this.vert(p, n, [(a + 1) / 2, (b + 1) / 2], j, w);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // Vertical cylinder from y0 to y1 (y1 > y0 or not), weighted by a per-ring callback.
  cylinder(cx, cz, y0, y1, r, seg, rings, weightFn) {
    const base = this.count;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, y = y0 + (y1 - y0) * t;
      const { j, w } = weightFn(t);
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2, nx = Math.sin(a), nz = Math.cos(a);
        this.vert([cx + nx * r, y, cz + nz * r], [nx, 0, nz], [s / seg, t], j, w);
      }
    }
    const row = seg + 1;
    for (let i = 0; i < rings; i++) for (let s = 0; s < seg; s++) {
      const a = base + i * row + s, b = a + row;
      if (y1 > y0) this.idx.push(a, a + 1, b, a + 1, b + 1, b); else this.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    for (const [y, ny, t] of [[y0, y1 > y0 ? -1 : 1, 0], [y1, y1 > y0 ? 1 : -1, 1]]) {
      const { j, w } = weightFn(t);
      const center = this.vert([cx, y, cz], [0, ny, 0], [0.5, 0.5], j, w);
      const ring = this.count;
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        this.vert([cx + Math.sin(a) * r, y, cz + Math.cos(a) * r], [0, ny, 0], [0.5, 0.5], j, w);
      }
      for (let s = 0; s < seg; s++) {
        if (ny > 0) this.idx.push(center, ring + s, ring + s + 1); else this.idx.push(center, ring + s + 1, ring + s);
      }
    }
  }
  sphere(c, r, seg, rings, j, w) {
    const base = this.count;
    for (let i = 0; i <= rings; i++) {
      const phi = (i / rings) * Math.PI;
      for (let s = 0; s <= seg; s++) {
        const th = (s / seg) * Math.PI * 2;
        const n = [Math.sin(phi) * Math.sin(th), Math.cos(phi), Math.sin(phi) * Math.cos(th)];
        this.vert(n.map((v, k) => c[k] + v * r), n, [s / seg, i / rings], j, w);
      }
    }
    const row = seg + 1;
    for (let i = 0; i < rings; i++) for (let s = 0; s < seg; s++) {
      const a = base + i * row + s, b = a + row;
      this.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

function makePrimitive(doc, buffer, geo, material, skinned) {
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(geo.pos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(geo.nrm)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(geo.uv)))
    .setIndices(acc('SCALAR', geo.count > 65535 ? new Uint32Array(geo.idx) : new Uint16Array(geo.idx)))
    .setMaterial(material);
  if (skinned) {
    prim.setAttribute('JOINTS_0', acc('VEC4', new Uint16Array(geo.joints)));
    prim.setAttribute('WEIGHTS_0', acc('VEC4', new Float32Array(geo.weights)));
  }
  return prim;
}

const mat = (doc, name, rgb, { rough = 0.8, metal = 0, emissive } = {}) => {
  const m = doc.createMaterial(name).setBaseColorFactor([...rgb, 1]).setRoughnessFactor(rough).setMetallicFactor(metal);
  if (emissive) m.setEmissiveFactor(emissive);
  return m;
};

let triangles = 0;
const countTris = (geo, instances = 1) => { triangles += (geo.idx.length / 3) * instances; };

// ---------- bar greybox ----------
async function buildBar() {
  triangles = 0;
  const doc = new Document();
  doc.createBuffer();
  const buffer = doc.getRoot().listBuffers()[0];
  const scene = doc.createScene('Bar');
  const M = {
    floor: mat(doc, 'floor_tiles', [0.35, 0.22, 0.14]),
    wall: mat(doc, 'wall_plaster', [0.62, 0.55, 0.42]),
    wood: mat(doc, 'wood_dark', [0.30, 0.17, 0.08], { rough: 0.6 }),
    top: mat(doc, 'counter_top', [0.75, 0.73, 0.70], { rough: 0.3, metal: 0.2 }),
    metal: mat(doc, 'metal_legs', [0.6, 0.6, 0.62], { rough: 0.35, metal: 0.9 }),
    glass: mat(doc, 'bottle_glass', [0.15, 0.45, 0.2], { rough: 0.15 }),
    neon: mat(doc, 'neon_sign', [1, 0.2, 0.6], { emissive: [1, 0.15, 0.55] }),
  };
  const colliders = [];
  const addCollider = (c, s, tag) => colliders.push({ tag, min: c.map((v, k) => v - s[k] / 2), max: c.map((v, k) => v + s[k] / 2) });

  const unique = (name, material, build, collider) => {
    const g = new Geo(); build(g); countTris(g);
    const mesh = doc.createMesh(name).addPrimitive(makePrimitive(doc, buffer, g, material, false));
    scene.addChild(doc.createNode(name).setMesh(mesh));
    if (collider) for (const [c, s] of collider) addCollider(c, s, name);
  };
  const W = 20, D = 14, H = 3.2, T = 0.2; // interior width (x), depth (z), height, wall thickness
  unique('floor', M.floor, (g) => g.box([0, -0.05, 0], [W + 2 * T, 0.1, D + 2 * T]), [[[0, -0.05, 0], [W + 2 * T, 0.1, D + 2 * T]]]);
  // Walls; front wall (z = +D/2) has a 2.4 m door gap centered at x = 0.
  const walls = [
    [[0, H / 2, -D / 2 - T / 2], [W + 2 * T, H, T]],
    [[-W / 2 - T / 2, H / 2, 0], [T, H, D]],
    [[W / 2 + T / 2, H / 2, 0], [T, H, D]],
    [[-(W / 4 + 0.6), H / 2, D / 2 + T / 2], [W / 2 - 1.2 + 2 * T, H, T]],
    [[W / 4 + 0.6, H / 2, D / 2 + T / 2], [W / 2 - 1.2 + 2 * T, H, T]],
  ];
  unique('walls', M.wall, (g) => walls.forEach(([c, s]) => g.box(c, s)), walls);
  // Counter along the back wall.
  const counterBody = [[-2, 0.5, -D / 2 + 1.6], [10, 1.0, 0.7]];
  unique('counter_body', M.wood, (g) => g.box(...counterBody), [counterBody]);
  unique('counter_top', M.top, (g) => g.box([-2, 1.04, -D / 2 + 1.6], [10.3, 0.08, 0.9]));
  const shelf = [[-2, 1.6, -D / 2 + 0.2], [10, 0.05, 0.35]];
  unique('back_shelf', M.wood, (g) => { g.box(...shelf); g.box([-2, 2.2, -D / 2 + 0.2], [10, 0.05, 0.35]); });
  unique('neon_sign', M.neon, (g) => { g.box([6, 2.4, -D / 2 + 0.06], [2.4, 0.5, 0.06]); });

  // Repeated props: one mesh, many nodes (glTF mesh reuse).
  const shared = (name, material, build) => {
    const g = new Geo(); build(g);
    return { mesh: doc.createMesh(name).addPrimitive(makePrimitive(doc, buffer, g, material, false)), geo: g, uses: 0 };
  };
  const tableMesh = shared('table', M.wood, (g) => { g.box([0, 0.74, 0], [1.0, 0.05, 1.0]); g.box([0, 0.37, 0], [0.1, 0.72, 0.1]); g.box([0, 0.02, 0], [0.6, 0.04, 0.6]); });
  const chairMesh = shared('chair', M.wood, (g) => {
    g.box([0, 0.45, 0], [0.45, 0.05, 0.45]); g.box([0, 0.75, -0.2], [0.45, 0.55, 0.05]);
    for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) g.box([x, 0.22, z], [0.04, 0.44, 0.04]);
  });
  const stoolMesh = shared('stool', M.metal, (g) => { g.cylinder(0, 0, 0.74, 0.78, 0.18, 16, 1, () => ({ j: [0, 0, 0, 0], w: [1, 0, 0, 0] })); g.cylinder(0, 0, 0, 0.74, 0.03, 8, 1, () => ({ j: [0, 0, 0, 0], w: [1, 0, 0, 0] })); });
  const bottleMesh = shared('bottle', M.glass, (g) => { g.cylinder(0, 0, 0, 0.22, 0.04, 10, 1, () => ({ j: [0, 0, 0, 0], w: [1, 0, 0, 0] })); g.cylinder(0, 0, 0.22, 0.3, 0.012, 8, 1, () => ({ j: [0, 0, 0, 0], w: [1, 0, 0, 0] })); });
  const place = (sh, name, t, yaw = 0) => {
    sh.uses++;
    const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    scene.addChild(doc.createNode(`${name}_${sh.uses}`).setMesh(sh.mesh).setTranslation(t).setRotation(q));
  };
  // 3 x 3 grid of tables with 4 chairs each.
  for (const x of [-6, -1, 4]) for (const z of [-1.5, 1.5, 4.5]) {
    place(tableMesh, 'table', [x, 0, z]);
    addCollider([x, 0.38, z], [1.0, 0.76, 1.0], 'table');
    [[0, -0.8, 0], [0, 0.8, Math.PI], [-0.8, 0, Math.PI / 2], [0.8, 0, -Math.PI / 2]].forEach(([dx, dz, yaw]) => place(chairMesh, 'chair', [x + dx, 0, z + dz], yaw));
  }
  for (let i = 0; i < 8; i++) { const x = -6.5 + i * 1.2; place(stoolMesh, 'stool', [x, 0, -D / 2 + 2.4]); addCollider([x, 0.39, -D / 2 + 2.4], [0.36, 0.78, 0.36], 'stool'); }
  for (let row = 0; row < 2; row++) for (let i = 0; i < 30; i++) place(bottleMesh, 'bottle', [-6.8 + i * 0.32, 1.625 + row * 0.6, -D / 2 + 0.2]);
  for (const sh of [tableMesh, chairMesh, stoolMesh, bottleMesh]) countTris(sh.geo, sh.uses);

  await new NodeIO().write(join(OUT, 'bar-greybox.glb'), doc);
  writeFileSync(join(OUT, 'bar-colliders.json'), JSON.stringify({
    version: 1,
    walkable: { min: [-W / 2 + 0.6, -D / 2 + 3.2], max: [W / 2 - 0.6, D / 2 - 0.6] },
    spawn: [0, 0.1, D / 2 - 1.2],
    colliders,
  }, null, 1));
  return { nodes: scene.listChildren().length, triangles, colliders: colliders.length };
}

// ---------- skinned avatar ----------
async function buildAvatar() {
  triangles = 0;
  const doc = new Document();
  doc.createBuffer();
  const buffer = doc.getRoot().listBuffers()[0];
  // name, parent, world position (bind pose, no rotations)
  const J = [
    ['root', null, [0, 0, 0]], ['hips', 'root', [0, 0.95, 0]], ['spine', 'hips', [0, 1.1, 0]], ['chest', 'spine', [0, 1.3, 0]],
    ['neck', 'chest', [0, 1.52, 0]], ['head', 'neck', [0, 1.6, 0]],
    ['upperarm.L', 'chest', [0.25, 1.47, 0]], ['forearm.L', 'upperarm.L', [0.25, 1.18, 0]], ['hand.L', 'forearm.L', [0.25, 0.94, 0]],
    ['upperarm.R', 'chest', [-0.25, 1.47, 0]], ['forearm.R', 'upperarm.R', [-0.25, 1.18, 0]], ['hand.R', 'forearm.R', [-0.25, 0.94, 0]],
    ['upperleg.L', 'hips', [0.1, 0.92, 0]], ['lowerleg.L', 'upperleg.L', [0.1, 0.5, 0]], ['foot.L', 'lowerleg.L', [0.1, 0.08, 0]],
    ['upperleg.R', 'hips', [-0.1, 0.92, 0]], ['lowerleg.R', 'upperleg.R', [-0.1, 0.5, 0]], ['foot.R', 'lowerleg.R', [-0.1, 0.08, 0]],
  ];
  const ji = Object.fromEntries(J.map(([n], i) => [n, i]));
  const wpos = Object.fromEntries(J.map(([n, , p]) => [n, p]));
  const nodes = {};
  for (const [name, parent, p] of J) {
    const local = parent ? p.map((v, k) => v - wpos[parent][k]) : p;
    nodes[name] = doc.createNode(name).setTranslation(local);
    if (parent) nodes[parent].addChild(nodes[name]);
  }
  // Rigid weights plus a 50/50 blend on the ring closest to the parent joint.
  const wf = (bone) => (t) => {
    const parent = J[ji[bone]][1];
    return t === 0 && parent && parent !== 'root' ? { j: [ji[bone], ji[parent], 0, 0], w: [0.5, 0.5, 0, 0] } : { j: [ji[bone], 0, 0, 0], w: [1, 0, 0, 0] };
  };
  const rigid = (bone) => [[ji[bone], 0, 0, 0], [1, 0, 0, 0]];
  const skin = new Geo(), shirt = new Geo(), pants = new Geo(), shoes = new Geo();
  const S = 16, R = 6;
  for (const side of ['L', 'R']) {
    const x = side === 'L' ? 0.25 : -0.25, lx = side === 'L' ? 0.1 : -0.1;
    shirt.cylinder(x, 0, 1.47, 1.18, 0.055, S, R, wf(`upperarm.${side}`));
    shirt.cylinder(x, 0, 1.18, 0.95, 0.045, S, R, wf(`forearm.${side}`));
    skin.sphere([x, 0.89, 0], 0.05, 12, 8, ...rigid(`hand.${side}`));
    pants.cylinder(lx, 0, 0.92, 0.5, 0.08, S, R, wf(`upperleg.${side}`));
    pants.cylinder(lx, 0, 0.5, 0.1, 0.06, S, R, wf(`lowerleg.${side}`));
    shoes.box([lx, 0.05, 0.05], [0.1, 0.1, 0.26], ...rigid(`foot.${side}`));
  }
  pants.cylinder(0, 0, 0.85, 1.1, 0.17, S, R, wf('hips'));
  shirt.cylinder(0, 0, 1.1, 1.3, 0.16, S, R, wf('spine'));
  shirt.cylinder(0, 0, 1.3, 1.52, 0.2, S, R, wf('chest'));
  skin.cylinder(0, 0, 1.52, 1.62, 0.06, S, 2, wf('neck'));
  skin.sphere([0, 1.73, 0.01], 0.13, 24, 16, ...rigid('head'));
  skin.box([0, 1.72, 0.14], [0.04, 0.05, 0.04], ...rigid('head')); // nose: shows facing direction

  const ibm = new Float32Array(J.length * 16);
  J.forEach(([n], i) => { const p = wpos[n]; ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16); });
  const skinDef = doc.createSkin('avatar_skin').setSkeleton(nodes.root)
    .setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));
  J.forEach(([n]) => skinDef.addJoint(nodes[n]));
  const mesh = doc.createMesh('avatar_body');
  for (const [geo, m] of [[skin, mat(doc, 'skin', [0.78, 0.55, 0.4])], [shirt, mat(doc, 'shirt', [0.1, 0.45, 0.7])], [pants, mat(doc, 'pants', [0.18, 0.18, 0.22])], [shoes, mat(doc, 'shoes', [0.08, 0.06, 0.05])]]) {
    countTris(geo);
    mesh.addPrimitive(makePrimitive(doc, buffer, geo, m, true));
  }
  const top = doc.createNode('Avatar').addChild(nodes.root).addChild(doc.createNode('avatar_body').setMesh(mesh).setSkin(skinDef));
  doc.createScene('Avatar').addChild(top);

  // Animations: rotations about X (and Y for sway), sampled densely, LINEAR.
  const qx = (deg) => { const a = (deg * Math.PI) / 360; return [Math.sin(a), 0, 0, Math.cos(a)]; };
  const qy = (deg) => { const a = (deg * Math.PI) / 360; return [0, Math.sin(a), 0, Math.cos(a)]; };
  const clip = (name, duration, frames, tracks) => {
    const anim = doc.createAnimation(name);
    const times = new Float32Array(frames + 1).map((_, i) => (i / frames) * duration);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
    for (const [bone, path, fn] of tracks) {
      const out = new Float32Array((frames + 1) * (path === 'rotation' ? 4 : 3));
      for (let i = 0; i <= frames; i++) out.set(fn(i / frames), i * (path === 'rotation' ? 4 : 3));
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType(path === 'rotation' ? 'VEC4' : 'VEC3').setArray(out).setBuffer(buffer)).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes[bone]).setTargetPath(path).setSampler(sampler));
    }
  };
  const TAU = Math.PI * 2;
  const hipsT = wpos.hips;
  clip('Idle', 2, 20, [
    ['chest', 'rotation', (t) => qx(2 * Math.sin(t * TAU))],
    ['upperarm.L', 'rotation', (t) => qx(3 * Math.sin(t * TAU))],
    ['upperarm.R', 'rotation', (t) => qx(-3 * Math.sin(t * TAU))],
    ['head', 'rotation', (t) => qy(6 * Math.sin(t * TAU))],
  ]);
  clip('Walk', 1, 16, [
    ['upperleg.L', 'rotation', (t) => qx(-30 * Math.sin(t * TAU))],
    ['upperleg.R', 'rotation', (t) => qx(30 * Math.sin(t * TAU))],
    ['lowerleg.L', 'rotation', (t) => qx(35 * Math.max(0, Math.sin(t * TAU + Math.PI)))],
    ['lowerleg.R', 'rotation', (t) => qx(35 * Math.max(0, Math.sin(t * TAU)))],
    ['upperarm.L', 'rotation', (t) => qx(25 * Math.sin(t * TAU))],
    ['upperarm.R', 'rotation', (t) => qx(-25 * Math.sin(t * TAU))],
    ['hips', 'translation', (t) => [0, hipsT[1] + 0.03 * Math.abs(Math.cos(t * TAU)), 0]],
  ]);
  clip('Sit', 1, 1, [
    ['hips', 'translation', () => [0, 0.5, 0]],
    ['upperleg.L', 'rotation', () => qx(-90)], ['upperleg.R', 'rotation', () => qx(-90)],
    ['lowerleg.L', 'rotation', () => qx(90)], ['lowerleg.R', 'rotation', () => qx(90)],
  ]);
  await new NodeIO().write(join(OUT, 'avatar.glb'), doc);
  return { joints: J.length, triangles, primitives: 4, clips: ['Idle', 'Walk', 'Sit'] };
}

const bar = await buildBar();
const avatar = await buildAvatar();
console.log(JSON.stringify({ bar, avatar }));
