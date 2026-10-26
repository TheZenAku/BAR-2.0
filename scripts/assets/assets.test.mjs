// Asset pipeline (M4) invariants that need no download: pinned official sources, license evidence per pack,
// manifest in sync with the configuration, and the archive path check used before extraction.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unsafeEntries } from './fetch.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(join(ROOT, 'assets/art-candidates.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/assets/MANIFEST.json'), 'utf8'));
const OFFICIAL = /^https:\/\/(kenney\.nl\/|raw\.githubusercontent\.com\/KayKit-Game-Assets\/|quaternius\.itch\.io\/)/;
const itemsOf = (c) => [...c.variants, ...(c.parts ?? []), ...(c.animationLibrary ? [c.animationLibrary] : [])];

describe('art-candidates.json', () => {
  it('pins every source to an official URL and a SHA-256', () => {
    for (const [id, src] of Object.entries(config.sources)) {
      expect(src.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(src.url ?? src.page, id).toMatch(OFFICIAL);
      if (src.url?.includes('githubusercontent'))
        expect(src.url, `${id}: commit, not a branch`).toMatch(/\/[0-9a-f]{40}\//);
      expect(['http', 'itch'], id).toContain(src.method);
    }
  });

  it('declares an accepted license with evidence from every downloaded pack it combines', () => {
    for (const c of config.candidates) {
      expect(c.license, c.id).toBe('CC0 1.0');
      const evidence = new Set(c.licenseEvidence.map((e) => e.source));
      for (const e of c.licenseEvidence) expect(config.sources[e.source], `${c.id}: ${e.source}`).toBeDefined();
      // Each zip carries its own license file; loose files (KayKit GLBs) are covered by their repository's LICENSE.
      for (const item of itemsOf(c)) {
        expect(config.sources[item.source], `${c.id}/${item.id}`).toBeDefined();
        if (config.sources[item.source].extract) expect(evidence.has(item.source), `${c.id}/${item.id}`).toBe(true);
      }
      expect(
        itemsOf(c).some((i) => i.id === c.reference),
        `${c.id}: reference variant`,
      ).toBe(true);
    }
  });
});

describe('docs/assets/MANIFEST.json', () => {
  const expected = config.candidates.flatMap((c) => itemsOf(c).map((i) => ({ id: `${c.id}/${i.id}`, c, i })));

  it('has exactly one entry per generated file, matching the configuration', () => {
    expect(manifest.assets.map((a) => a.id).sort()).toEqual(expected.map((e) => e.id).sort());
    for (const { id, c, i } of expected) {
      const a = manifest.assets.find((x) => x.id === id);
      expect(a.sha256Original, id).toBe(config.sources[i.source].sha256);
      expect(a.sha256Generated, id).toMatch(/^[0-9a-f]{64}$/);
      expect(a.license, id).toBe(c.license);
      expect(a.licenseEvidence, id).toMatch(/\(sha256 [0-9a-f]{16}…\)$/);
      expect(a.modifications.length, id).toBeGreaterThan(0);
      expect(a.commercialUse && a.redistribution, id).toBe(true);
    }
  });
});

describe('archive extraction', () => {
  it('rejects entries that escape the extraction directory', () => {
    expect(unsafeEntries(['../evil.txt', 'a/../../b', '/etc/passwd', 'C:/Windows/x', 'a\\..\\b'])).toHaveLength(5);
    expect(unsafeEntries(['Models/GLB format/character-male-a.glb', 'Pack[Standard]/License.txt', 'a..b/c'])).toEqual(
      [],
    );
  });
});
