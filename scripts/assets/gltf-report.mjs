// glTF/GLB inspection shared by the asset pipeline: Khronos glTF-Validator result + structural statistics
// (geometry, skin, animations, materials, textures, bounds). No Blender needed.
// CLI: node scripts/assets/gltf-report.mjs <file.glb|.gltf> [...]   (prints one JSON report per file)
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import validator from 'gltf-validator';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
export const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** Khronos validator over the exact bytes (external .bin/.png resolved next to the file). */
export async function validate(path) {
  const bytes = new Uint8Array(await readFile(path));
  const result = await validator.validateBytes(bytes, {
    uri: path,
    maxIssues: 50,
    externalResourceFunction: (uri) =>
      readFile(join(dirname(path), decodeURIComponent(uri))).then(
        (b) => new Uint8Array(b),
        () => Promise.reject(new Error(`missing ${uri}`)),
      ),
  });
  const { numErrors, numWarnings, numInfos, numHints, messages } = result.issues;
  return {
    errors: numErrors,
    warnings: numWarnings,
    infos: numInfos,
    hints: numHints,
    messages: messages
      .filter((m) => m.severity <= 1)
      .slice(0, 10)
      .map((m) => `${m.severity === 0 ? 'E' : 'W'} ${m.code} ${m.pointer ?? ''} ${m.message}`.trim()),
  };
}

/** Structural statistics of a loaded document. */
export function stats(doc) {
  const root = doc.getRoot();
  let vertices = 0;
  let triangles = 0;
  let primitives = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      primitives++;
      const count = prim.getAttribute('POSITION')?.getCount() ?? 0;
      vertices += count;
      const idx = prim.getIndices();
      if (prim.getMode() === 4) triangles += (idx ? idx.getCount() : count) / 3;
    }
  }
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const b = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    meshes: root.listMeshes().length,
    primitives,
    vertices,
    triangles,
    skins: root.listSkins().map((s) => ({ name: s.getName(), joints: s.listJoints().length })),
    animations: root.listAnimations().map((a) => {
      let duration = 0;
      for (const s of a.listSamplers()) duration = Math.max(duration, s.getInput()?.getMax([])[0] ?? 0);
      return { name: a.getName(), duration: round(duration) };
    }),
    materials: root.listMaterials().map((m) => ({
      name: m.getName(),
      baseColorTexture: m.getBaseColorTexture()?.getName() || m.getBaseColorTexture()?.getURI() || null,
      metallic: m.getMetallicFactor(),
      roughness: m.getRoughnessFactor(),
      alpha: m.getAlphaMode(),
    })),
    textures: root.listTextures().map((t) => {
      const size = t.getSize();
      return { name: t.getName() || t.getURI(), mime: t.getMimeType(), size: size ? `${size[0]}x${size[1]}` : null };
    }),
    bounds: { min: b.min.map(round), max: b.max.map(round), height: round(b.max[1] - b.min[1]) },
  };
}

export async function report(path) {
  const validation = await validate(path);
  try {
    return { file: path, validation, ...stats(await io.read(path)) };
  } catch (err) {
    // e.g. a missing external texture: the validator already lists it; structure cannot be read.
    return { file: path, validation, readError: String(err.message ?? err).split('\n')[0] };
  }
}

if (process.argv[1] && /scripts[\\/]assets[\\/]gltf-report\.mjs$/.test(process.argv[1])) {
  for (const file of process.argv.slice(2)) console.log(JSON.stringify(await report(file), null, 2));
}
