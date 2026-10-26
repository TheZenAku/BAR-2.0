// License gate for installed production dependencies (shipped to players or run on the server).
// Uses `npm query .prod` so the dependency set is exactly what npm considers production.
// Anything outside the allowlist fails and must be reviewed (and recorded in an ADR) before use.
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
]);

// Fixed command string (no interpolated arguments); a shell is needed to resolve npm on Windows.
const out = execSync('npm query .prod', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// Exclude the root workspace (location '') and our own workspaces; only third-party packages are gated.
const pkgs = JSON.parse(out).filter((p) => p.location !== '' && !p.name?.startsWith('@bar/'));

const licenseOf = (p) => (typeof p.license === 'string' ? p.license : (p.license?.type ?? 'UNKNOWN'));
const isAllowed = (expr) =>
  expr
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((alt) => alt.split(/\s+AND\s+/).every((id) => ALLOWED.has(id.trim())));

const seen = new Map();
for (const p of pkgs) seen.set(`${p.name}@${p.version}`, licenseOf(p));
const bad = [...seen].filter(([, lic]) => !isAllowed(lic));
const summary = {};
for (const lic of seen.values()) summary[lic] = (summary[lic] ?? 0) + 1;

if (bad.length) {
  console.error(
    `check-licenses: ${bad.length} package(s) need review:\n- ${bad.map(([n, l]) => `${n}: ${l}`).join('\n- ')}`,
  );
  process.exit(1);
}
console.log(`check-licenses: OK (${seen.size} production packages) ${JSON.stringify(summary)}`);
