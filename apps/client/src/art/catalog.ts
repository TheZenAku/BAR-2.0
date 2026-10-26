// Shape of /art-assets/catalog.json, written by scripts/assets/build.mjs (one entry per generated GLB).

export interface CatalogItem {
  id: string;
  file: string;
  bytes: number;
  originalBytes: number;
  sha256: string;
  validation: { errors: number; warnings: number };
  triangles: number;
  vertices: number;
  joints: number;
  animations: { name: string; duration: number }[];
  materials: { name: string }[];
  textures: { name: string | null; mime: string; size: string | null }[];
  height: number;
  modifications: string[];
}

export interface Candidate {
  id: string;
  name: string;
  author: string;
  page: string;
  license: string;
  attribution: string;
  style: string;
  idle: string;
  walk: string;
  run: string;
  reference: string;
  /** License file read from inside each downloaded pack (one per pack the candidate combines). */
  licenseEvidence: { source: string; file: string; sha256: string; excerpt: string[] }[];
  originalHeight: number;
  scale: number;
  variants: CatalogItem[];
  /** Modular pieces on the same skeleton; `for` limits a piece to one variant (e.g. a male outfit). */
  parts: (CatalogItem & { slot: string; for: string | null })[];
  animationLibrary: CatalogItem | null;
}

export interface Catalog {
  targetHeight: number;
  candidates: Candidate[];
}

export async function loadCatalog(base: string): Promise<Catalog> {
  const res = await fetch(`${base}catalog.json`);
  if (!res.ok) throw new Error(`catálogo indisponível (${res.status}): rode npm run assets:build`);
  const catalog = (await res.json()) as Catalog;
  if (!Array.isArray(catalog.candidates) || catalog.candidates.some((c) => c.variants.length === 0)) {
    throw new Error('catálogo inválido');
  }
  return catalog;
}
