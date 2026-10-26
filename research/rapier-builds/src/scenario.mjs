// Identical workload for both Rapier builds, runnable in Node and in browsers.
// Greybox room (floor, walls, stairs, ramp, props) + N kinematic character controllers walking a
// deterministic pattern at 60 Hz. Returns timings and an FNV-1a hash of the final positions (bit-exact).
export async function runScenario(RAPIER, { characters = 16, steps = 1200 } = {}) {
  const t0 = performance.now();
  await RAPIER.init();
  const initMs = performance.now() - t0;

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const box = (hx, hy, hz, x, y, z, rot) => {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
    if (rot) d.setRotation(rot);
    world.createCollider(d);
  };
  box(10, 0.1, 7, 0, -0.1, 0);
  box(0.1, 1.5, 7, -10, 1.5, 0);
  box(0.1, 1.5, 7, 10, 1.5, 0);
  box(10, 1.5, 0.1, 0, 1.5, -7);
  box(10, 1.5, 0.1, 0, 1.5, 7);
  for (let i = 0; i < 6; i++) box(0.6, 0.09 * (i + 1), 1, 4 + i * 0.35, 0.09 * (i + 1), -4);
  const s = Math.sin(0.17), c = Math.cos(0.17);
  box(1, 0.1, 2, -5, 0.3, 3, { x: s, y: 0, z: 0, w: c });
  for (let i = 0; i < 12; i++) box(0.3, 0.5, 0.3, -8 + (i % 6) * 3, 0.5, i < 6 ? -2 : 2);

  const ctrl = world.createCharacterController(0.01);
  ctrl.enableAutostep(0.35, 0.15, false);
  ctrl.enableSnapToGround(0.3);
  ctrl.setMaxSlopeClimbAngle((40 * Math.PI) / 180);
  ctrl.setSlideEnabled(true);
  const chars = [];
  for (let i = 0; i < characters; i++) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-8 + (i % 8) * 2, 1, -5 + Math.floor(i / 8) * 2),
    );
    const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.3), body);
    chars.push({ body, collider, vy: 0, grounded: false });
  }
  world.step();

  const dt = 1 / 60;
  const stepMs = [];
  for (let n = 0; n < steps; n++) {
    const a = performance.now();
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      // Direction changes every 2 s; pattern depends only on (n, i) so both builds get identical input.
      const phase = Math.floor(n / 120) + i;
      const dir = [[1, 0], [0, 1], [-1, 0], [0, -1]][phase % 4];
      ch.vy = ch.grounded ? -1 : Math.max(ch.vy - 9.81 * dt, -20);
      ctrl.computeColliderMovement(ch.collider, { x: dir[0] * 3 * dt, y: ch.vy * dt, z: dir[1] * 3 * dt });
      const m = ctrl.computedMovement();
      ch.grounded = ctrl.computedGrounded();
      const t = ch.body.translation();
      ch.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    }
    world.step();
    stepMs.push(performance.now() - a);
  }

  const f = new Float32Array(chars.length * 3);
  chars.forEach((ch, i) => {
    const t = ch.body.translation();
    f.set([t.x, t.y, t.z], i * 3);
  });
  let hash = 0x811c9dc5;
  for (const b of new Uint8Array(f.buffer)) hash = Math.imul(hash ^ b, 0x01000193) >>> 0;
  world.free();

  stepMs.sort((x, y) => x - y);
  const avg = stepMs.reduce((x, y) => x + y, 0) / stepMs.length;
  return {
    version: RAPIER.version(),
    initMs: +initMs.toFixed(1),
    stepAvgMs: +avg.toFixed(4),
    stepP95Ms: +stepMs[Math.floor(stepMs.length * 0.95)].toFixed(4),
    hash: hash.toString(16).padStart(8, '0'),
  };
}
