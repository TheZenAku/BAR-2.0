// Architecture gate (no dependencies):
//  1. Workspace graph: packages/* may not depend on apps/*; no cycles.
//  2. Every `@bar/*` import must be declared in the importing workspace's package.json.
//  3. No relative import may escape its workspace.
//  4. No import cycles between source modules.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const errors = [];

const workspaces = ['packages', 'apps'].flatMap((group) =>
  existsSync(join(ROOT, group))
    ? readdirSync(join(ROOT, group))
        .map((name) => join(ROOT, group, name))
        .filter((dir) => existsSync(join(dir, 'package.json')))
        .map((dir) => ({ dir, group, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
    : [],
);
const byName = new Map(workspaces.map((w) => [w.pkg.name, w]));

function findCycles(graph) {
  const cycles = [];
  const state = new Map(); // 1 = visiting, 2 = done
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 1) cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

// 1. Workspace graph
const wsGraph = new Map();
for (const w of workspaces) {
  const deps = Object.keys({ ...w.pkg.dependencies, ...w.pkg.devDependencies }).filter((d) => byName.has(d));
  wsGraph.set(w.pkg.name, deps);
  for (const d of deps) {
    if (w.group === 'packages' && byName.get(d).group === 'apps')
      errors.push(`${w.pkg.name} (package) depends on app ${d}`);
  }
}
for (const c of findCycles(wsGraph)) errors.push(`workspace cycle: ${c.join(' -> ')}`);

// 2-4. Module graph
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === 'dist' ? [] : files(p);
    return /\.(ts|tsx|mts)$/.test(f) && !f.endsWith('.d.ts') ? [p] : [];
  });
const modGraph = new Map();
for (const w of workspaces) {
  const src = join(w.dir, 'src');
  if (!existsSync(src)) continue;
  const declared = new Set(Object.keys({ ...w.pkg.dependencies, ...w.pkg.devDependencies }));
  for (const file of files(src)) {
    const edges = [];
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const where = relative(ROOT, file);
      if (spec.startsWith('@bar/')) {
        const name = spec.split('/').slice(0, 2).join('/');
        if (!declared.has(name)) errors.push(`${where}: imports ${name} without declaring it in package.json`);
      } else if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(w.dir + sep)) errors.push(`${where}: relative import escapes workspace (${spec})`);
        else edges.push(target);
      }
    }
    modGraph.set(file, edges);
  }
}
for (const c of findCycles(modGraph)) errors.push(`module cycle: ${c.map((f) => relative(ROOT, f)).join(' -> ')}`);

if (errors.length) {
  console.error(`check-architecture: ${errors.length} problem(s)\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`check-architecture: OK (${workspaces.length} workspaces, ${modGraph.size} modules, 0 cycles)`);
