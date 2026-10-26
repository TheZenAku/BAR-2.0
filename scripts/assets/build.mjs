// Asset pipeline (M4): original → license check → import → normalize → optimize → validate → GLB → manifest.
// Reads assets/art-candidates.json, uses the verified originals from assets:fetch (never modified), writes
// .cache/assets/generated/<candidate>/<file>.glb + catalog.json (gallery) + report.json, and
// docs/assets/MANIFEST.json (provenance, committed). Exit code 1 if any output has validator errors.
// Normalization: meters, +Y up, model faces +Z, feet at y = 0, pack scaled so its reference variant measures
// `targetHeight` (relative heights inside a pack are preserved). Optimization: dedup, prune, resample, textures ≤ 1024²
// in WebP (normal maps lossless), Meshopt geometry/animation compression.
// Usage: npm run assets:build
//        npm run assets:build -- --check[=<candidateId>,…]  (reproducibility: rebuilds into .cache/assets/check,
//        validates and compares every SHA-256 with docs/assets/MANIFEST.json; writes nothing else; used by CI)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { dedup, getBounds, meshopt, prune, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { fetchSource } from './fetch.mjs';
import { io, stats, validate } from './gltf-report.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const checkArg = process.argv.find((a) => a === '--check' || a.startsWith('--check='));
const CHECK = checkArg !== undefined;
const checkIds = checkArg?.includes('=') ? checkArg.slice(8).split(',') : null;
const OUT = join(ROOT, CHECK ? '.cache/assets/check' : '.cache/assets/generated');
const config = JSON.parse(readFileSync(join(ROOT, 'assets/art-candidates.json'), 'utf8'));
/** Text a pack's own license file must contain for the license declared in the config. Anything else: no build. */
const LICENSE_TEXT = { 'CC0 1.0': /\bCC0\b|Creative Commons Zero/i };
/** Largest texture side shipped to the browser (VRAM per character; 2048² PBR sets cost ~16 MB each). */
const MAX_TEXTURE = 1024;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
await MeshoptEncoder.ready;

/** Loads an original. Broken image references are repaired only when a same-named file exists (logged). */
async function load(path, fixUris, modifications) {
  if (!path.endsWith('.gltf')) return { doc: await io.read(path), bytes: statSync(path).size };
  const dir = dirname(path);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const resources = {};
  let bytes = statSync(path).size;
  const add = (uri) => {
    const data = readFileSync(join(dir, decodeURIComponent(uri)));
    bytes += data.byteLength;
    resources[uri] = data;
  };
  for (const b of json.buffers ?? []) if (b.uri) add(b.uri);
  for (const img of json.images ?? []) {
    if (!img.uri) continue;
    if (fixUris && !existsSync(join(dir, decodeURIComponent(img.uri)))) {
      const alt = img.uri.replace(/_png\.png$/, '.png');
      if (!existsSync(join(dir, alt))) throw new Error(`missing image ${img.uri}`);
      modifications.add(`referência de imagem quebrada no original corrigida: ${img.uri} → ${alt}`);
      img.uri = alt;
    }
    if (!(img.uri in resources)) add(img.uri);
  }
  return { doc: await io.readJSON({ json, resources }), bytes };
}

function bodyHeight(doc) {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  return b.max[1] - b.min[1];
}

/** Applies pack rules; returns a list of human-readable modifications. */
function normalize(doc, c, { scale, stripMeshes }, modifications) {
  const root = doc.getRoot();
  if (c.removeNodes) {
    const re = new RegExp(c.removeNodes);
    const removed = root.listNodes().filter((n) => n.getMesh() && re.test(n.getName()));
    for (const n of removed) n.dispose();
    if (removed.length) modifications.add(`acessórios removidos (armas/escudos): /${c.removeNodes}/`);
  }
  if (c.keepAnimations) {
    const re = new RegExp(c.keepAnimations);
    const drop = root.listAnimations().filter((a) => !re.test(a.getName()));
    for (const a of drop) a.dispose();
    if (drop.length) modifications.add(`animações de combate removidas; mantidas: /${c.keepAnimations}/`);
  }
  if (stripMeshes) {
    for (const n of root.listNodes()) n.setMesh(null).setSkin(null);
    modifications.add('biblioteca de animações: malha de demonstração removida, mantidos esqueleto e clipes');
  }
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const wrapper = doc.createNode('BAR_Normalized').setScale([scale, scale, scale]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
  if (Math.abs(scale - 1) > 1e-6)
    modifications.add(`escala uniforme ×${scale.toFixed(4)} (altura de referência ${config.targetHeight} m)`);
}

async function buildItem(c, item, opts) {
  const modifications = new Set();
  const srcDir = await fetchSource(item.source);
  const { doc, bytes: originalBytes } = await load(join(srcDir, item.path), c.fixTextureUris, modifications);
  normalize(doc, c, opts, modifications);
  // Measured before quantization: Meshopt moves skinned-mesh dequantization into the inverse bind matrices.
  const height = opts.stripMeshes ? 0 : Math.round(bodyHeight(doc) * 1000) / 1000;
  await doc.transform(
    dedup(),
    prune(),
    resample(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [MAX_TEXTURE, MAX_TEXTURE],
      slots: /^normalTexture$/,
      lossless: true,
    }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [MAX_TEXTURE, MAX_TEXTURE], quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  modifications.add(`texturas ≤ ${MAX_TEXTURE}² em WebP (EXT_texture_webp; normal maps sem perdas)`);
  modifications.add('dedup, prune, resample (animação) e compressão Meshopt (EXT_meshopt_compression)');
  const file = `${c.id}/${item.id}.glb`;
  const out = join(OUT, file);
  mkdirSync(dirname(out), { recursive: true });
  const glb = await io.writeBinary(doc);
  writeFileSync(out, glb);
  const validation = await validate(out);
  const s = stats(await io.read(out));
  return {
    id: item.id,
    file,
    bytes: glb.byteLength,
    originalBytes,
    sha256: sha256(glb),
    validation,
    triangles: s.triangles,
    vertices: s.vertices,
    joints: s.skins[0]?.joints ?? 0,
    animations: s.animations,
    materials: s.materials,
    textures: s.textures,
    height,
    modifications: [...modifications],
  };
}

/** Reads the license file inside each pack and fails unless it states the license declared for the candidate. */
async function licenseOf(c) {
  const expected = LICENSE_TEXT[c.license];
  if (!expected) throw new Error(`${c.id}: license "${c.license}" is not accepted for public distribution`);
  const evidence = [];
  for (const ev of c.licenseEvidence) {
    const text = readFileSync(join(await fetchSource(ev.source), ev.path), 'utf8');
    if (!expected.test(text)) throw new Error(`${c.id}: ${ev.source}/${ev.path} does not state ${c.license}`);
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /licen|cc0|creative commons|commercial|free to use/i.test(l));
    evidence.push({ source: ev.source, file: ev.path, sha256: sha256(Buffer.from(text)), excerpt: lines.slice(0, 4) });
  }
  return evidence;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const catalog = { targetHeight: config.targetHeight, candidates: [] };
let errors = 0;
for (const c of config.candidates.filter((x) => !checkIds || checkIds.includes(x.id))) {
  // Pack scale from the reference variant, measured after the same pruning (accessories off).
  const ref = c.variants.find((v) => v.id === c.reference);
  const probe = await load(join(await fetchSource(ref.source), ref.path), c.fixTextureUris, new Set());
  normalize(probe.doc, c, { scale: 1 }, new Set());
  const originalHeight = bodyHeight(probe.doc);
  const scale = config.targetHeight / originalHeight;
  const entry = {
    ...Object.fromEntries(
      ['id', 'name', 'author', 'page', 'license', 'attribution', 'style', 'reference', 'idle', 'walk', 'run'].map(
        (k) => [k, c[k]],
      ),
    ),
    licenseEvidence: await licenseOf(c),
    originalHeight: Math.round(originalHeight * 1000) / 1000,
    scale,
    variants: [],
    parts: [],
    animationLibrary: null,
  };
  for (const v of c.variants) entry.variants.push(await buildItem(c, v, { scale }));
  for (const p of c.parts ?? [])
    entry.parts.push({ ...(await buildItem(c, p, { scale })), slot: p.slot, for: p.for ?? null });
  if (c.animationLibrary) entry.animationLibrary = await buildItem(c, c.animationLibrary, { scale, stripMeshes: true });
  for (const item of [...entry.variants, ...entry.parts, ...(entry.animationLibrary ? [entry.animationLibrary] : [])]) {
    errors += item.validation.errors;
    console.log(
      `[assets] ${c.id}/${item.id}: ${(item.originalBytes / 1024).toFixed(0)} KB → ${(item.bytes / 1024).toFixed(0)} KB, ` +
        `${item.triangles} tris, ${item.joints} joints, ${item.animations.length} clips, altura ${item.height} m, ` +
        `validador ${item.validation.errors}E/${item.validation.warnings}W`,
    );
  }
  catalog.candidates.push(entry);
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/assets/MANIFEST.json'), 'utf8'));
if (CHECK) {
  // Same inputs + same tool versions must give byte-identical GLBs (the committed hashes).
  const pinned = new Map(manifest.assets.map((a) => [a.id, a.sha256Generated]));
  let drift = 0;
  for (const c of catalog.candidates) {
    for (const item of [...c.variants, ...c.parts, ...(c.animationLibrary ? [c.animationLibrary] : [])]) {
      if (pinned.get(`${c.id}/${item.id}`) === item.sha256) continue;
      drift++;
      console.error(
        `[assets] ${c.id}/${item.id}: SHA-256 ${item.sha256} ≠ manifest ${pinned.get(`${c.id}/${item.id}`) ?? '(ausente)'}`,
      );
    }
  }
  const total = catalog.candidates.reduce(
    (n, c) => n + c.variants.length + c.parts.length + (c.animationLibrary ? 1 : 0),
    0,
  );
  console.log(`[assets] check: ${total} GLBs, ${errors} erro(s) do validador, ${drift} divergência(s) com o manifest`);
  rmSync(OUT, { recursive: true, force: true });
  process.exit(errors + drift > 0 ? 1 : 0);
}
writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

// Provenance manifest (committed): one entry per generated file.
manifest.assets = catalog.candidates.flatMap((c) => {
  const cfg = config.candidates.find((x) => x.id === c.id);
  const items = [...c.variants, ...c.parts, ...(c.animationLibrary ? [c.animationLibrary] : [])];
  const srcOf = (id) =>
    [...cfg.variants, ...(cfg.parts ?? []), ...(cfg.animationLibrary ? [cfg.animationLibrary] : [])].find(
      (x) => x.id === id,
    );
  return items.map((item) => {
    const s = srcOf(item.id);
    const src = config.sources[s.source];
    // The pack's own license file; single-license candidates (KayKit: repository LICENSE) cover every file.
    const ev = c.licenseEvidence.find((e) => e.source === s.source) ?? c.licenseEvidence[0];
    return {
      id: `${c.id}/${item.id}`,
      status: 'candidato M4 (aguarda escolha humana)',
      source: s.source,
      author: c.author,
      url: src.url ?? src.page,
      originalPath: s.path,
      license: c.license,
      licenseEvidence: `${ev.source}/${ev.file} (sha256 ${ev.sha256.slice(0, 16)}…)`,
      version: c.name,
      retrievedAt: config.retrievedAt,
      sha256Original: src.sha256,
      sha256Generated: item.sha256,
      modifications: item.modifications,
      attribution: c.attribution,
      commercialUse: true,
      redistribution: true,
    };
  });
});
writeFileSync(join(ROOT, 'docs/assets/MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify({ errors, catalog }, null, 2)}\n`);
console.log(`[assets] catálogo: ${join(OUT, 'catalog.json')} · erros do validador: ${errors}`);
if (errors > 0) process.exit(1);
