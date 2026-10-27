// Cloudflare quick tunnel for scripts/demo-remote.mjs: outbound-only HTTPS (works behind NAT/CGNAT, no router or
// firewall change, no account). The binary is the official release, pinned by version and by the SHA-256 published
// in its release notes, kept in .cache/tools (no global install). The tunnel lives only while the process runs.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const VERSION = '2026.10.0';
const BUILDS = {
  'win32-x64': {
    file: 'cloudflared-windows-amd64.exe',
    sha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
  },
  'linux-x64': {
    file: 'cloudflared-linux-amd64',
    sha256: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db',
  },
};

/** Path of the verified binary, downloading it once. Throws on unsupported platforms or hash mismatch. */
export async function ensureCloudflared() {
  const build = BUILDS[`${process.platform}-${process.arch}`];
  if (!build) throw new Error(`cloudflared: plataforma ${process.platform}-${process.arch} sem binário fixado`);
  const dir = join(ROOT, '.cache/tools');
  const bin = join(dir, `${VERSION}-${build.file}`);
  const sha = (buf) => createHash('sha256').update(buf).digest('hex');
  if (existsSync(bin) && sha(readFileSync(bin)) === build.sha256) return bin;
  const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${build.file}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`cloudflared: HTTP ${res.status} em ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== build.sha256) throw new Error(`cloudflared: SHA-256 divergente do publicado para ${VERSION}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(bin, buf);
  if (process.platform !== 'win32') chmodSync(bin, 0o755);
  return bin;
}

/**
 * Starts a quick tunnel to `localUrl` and resolves with its public https origin.
 * `stop()` ends it (the URL stops working immediately).
 */
export async function startQuickTunnel(localUrl, timeoutMs = 60_000) {
  const bin = await ensureCloudflared();
  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', localUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
  };
  const origin = await new Promise((res, rej) => {
    let log = '';
    let found = false;
    const timer = setTimeout(
      () => rej(new Error(`túnel não abriu em ${timeoutMs / 1000} s: ${log.slice(-300)}`)),
      timeoutMs,
    );
    const onData = (d) => {
      if (found) return; // keep draining the pipes, stop buffering
      log += d;
      const m = log.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        found = true;
        clearTimeout(timer);
        res(m[0]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      rej(new Error(`cloudflared encerrou (código ${code}): ${log.slice(-300)}`));
    });
  }).catch(async (e) => {
    await stop();
    throw e;
  });
  return { origin, stop, process: child };
}
