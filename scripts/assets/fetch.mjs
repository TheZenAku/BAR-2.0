// Downloads the original files listed in assets/art-candidates.json from their official sources into
// .cache/assets/originals/<source>/ and verifies each against its pinned SHA-256. Originals are never modified;
// zips are extracted next to them (x/). Idempotent: verified files are not downloaded again.
// itch.io packs only expose the free download through the page flow, so that flow is driven with Playwright
// (Edge locally, bundled Chromium where Edge is absent, e.g. CI).
// Usage: npm run assets:fetch [-- --only=<sourceId>]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
export const ORIGINALS = join(ROOT, '.cache/assets/originals');
const config = JSON.parse(readFileSync(join(ROOT, 'assets/art-candidates.json'), 'utf8'));
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

async function httpDownload(src, out) {
  const res = await fetch(src.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src.url}`);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

async function itchDownload(src, out) {
  const { chromium } = await import('playwright');
  const browser = await chromium
    .launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
    .catch(() => chromium.launch());
  try {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page.goto(src.page);
    await page.click('a.download_btn, .buy_btn'); // "Download Now"
    const skip = page.locator('a.direct_download_btn'); // "No thanks, just take me to the downloads"
    await skip.waitFor({ timeout: 30000 });
    await skip.click();
    await page.waitForSelector('.upload', { timeout: 30000 });
    const row = page.locator('.upload', { hasText: src.upload });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 600000 }),
      row.locator('a.download_btn').click(),
    ]);
    await download.saveAs(out);
  } finally {
    await browser.close();
  }
}

/** Archive entries that would land outside the extraction directory (absolute, drive letter or `..`). */
export const unsafeEntries = (names) =>
  names.filter((n) => isAbsolute(n) || /^[a-z]:/i.test(n) || n.split(/[\\/]/).includes('..'));

function extract(zip, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // bsdtar (Windows 10+) reads zip; Linux runners ship unzip.
  // (Explicit path: Git Bash puts GNU tar, which cannot read zip, first on PATH.)
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const run = (win, unix) =>
    process.platform === 'win32'
      ? execFileSync(tar, win, { maxBuffer: 64 << 20 })
      : execFileSync(unix[0], unix.slice(1), { maxBuffer: 64 << 20 });
  const names = run(['-tf', zip], ['unzip', '-Z1', zip]).toString('utf8').split(/\r?\n/).filter(Boolean);
  const bad = unsafeEntries(names);
  if (bad.length) throw new Error(`${zip}: entries outside the extraction directory: ${bad.slice(0, 3).join(', ')}`);
  run(['-xf', zip, '-C', dir], ['unzip', '-q', zip, '-d', dir]);
  // A link could point outside the cache; the pinned packs contain none, so one means a different archive.
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (lstatSync(p).isSymbolicLink()) throw new Error(`${zip}: archive contains a link (${p})`);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  writeFileSync(join(dir, '.extracted'), ''); // marker: a failed extraction is redone next time
}

const fetched = new Map();
/** Verified local directory of a source; hashed/downloaded/extracted at most once per process. */
export function fetchSource(id) {
  if (!fetched.has(id)) fetched.set(id, fetchOnce(id));
  return fetched.get(id);
}

async function fetchOnce(id) {
  const src = config.sources[id];
  if (!src) throw new Error(`unknown source ${id}`);
  const dir = join(ORIGINALS, id);
  const out = join(dir, src.file);
  mkdirSync(dir, { recursive: true });
  const verified = existsSync(out) && sha256(out) === src.sha256;
  if (!verified) {
    console.log(`[assets] ${id}: downloading (${src.method}) ${src.url ?? src.page}`);
    await (src.method === 'itch' ? itchDownload(src, out) : httpDownload(src, out));
    const got = sha256(out);
    if (got !== src.sha256) {
      throw new Error(
        `${id}: SHA-256 mismatch (got ${got}, pinned ${src.sha256}). The upstream file changed: review its license and contents before updating the pin.`,
      );
    }
  }
  if (src.extract && (!verified || !existsSync(join(dir, 'x', '.extracted')))) extract(out, join(dir, 'x'));
  console.log(`[assets] ${id}: ok (${src.sha256.slice(0, 12)}…)`);
  return src.extract ? join(dir, 'x') : dir;
}

if (process.argv[1] && /scripts[\\/]assets[\\/]fetch\.mjs$/.test(process.argv[1])) {
  const ids = Object.keys(config.sources).filter((id) => !only || id === only);
  let failed = 0;
  for (const id of ids) {
    try {
      await fetchSource(id);
    } catch (e) {
      failed++;
      console.error(`[assets] ${id}: FALHA — ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}
