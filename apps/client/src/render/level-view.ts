// Renders a LevelDef as greybox geometry: one merged mesh per surface type (a handful of draw calls
// regardless of box count). Visual placeholder only; physics reads the same LevelDef.
import type { LevelDef, Surface } from '@bar/game-core';
import type { BufferGeometry } from 'three';
import { BoxGeometry, Euler, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COLORS: Record<Surface, number> = {
  floor: 0x5b4a3c,
  wall: 0x8a7a6a,
  wood: 0x7a4a2a,
  stage: 0x4a5a6a,
  prop: 0xa0603a,
};

export class LevelView {
  readonly root = new Group();

  constructor(level: LevelDef, shadows: boolean) {
    this.root.name = `level:${level.name}`;
    const bySurface = new Map<Surface, BufferGeometry[]>();
    const m = new Matrix4();
    for (const b of level.boxes) {
      const g = new BoxGeometry(b.half.x * 2, b.half.y * 2, b.half.z * 2);
      const r = b.rotation ?? { x: 0, y: 0, z: 0 };
      m.compose(
        new Vector3(b.center.x, b.center.y, b.center.z),
        new Quaternion().setFromEuler(new Euler(r.x, r.y, r.z, 'XYZ')),
        new Vector3(1, 1, 1),
      );
      g.applyMatrix4(m);
      bySurface.set(b.surface, [...(bySurface.get(b.surface) ?? []), g]);
    }
    for (const [surface, parts] of bySurface) {
      const merged = mergeGeometries(parts);
      for (const p of parts) p.dispose();
      if (!merged) throw new Error(`could not merge greybox surface ${surface}`);
      const mesh = new Mesh(merged, new MeshStandardMaterial({ color: COLORS[surface], roughness: 0.85 }));
      mesh.name = surface;
      mesh.receiveShadow = shadows;
      mesh.castShadow = shadows && surface !== 'floor';
      this.root.add(mesh);
    }
  }

  dispose(): void {
    for (const child of this.root.children) {
      const mesh = child as Mesh<BufferGeometry, MeshStandardMaterial>;
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.root.removeFromParent();
    this.root.clear();
  }
}
