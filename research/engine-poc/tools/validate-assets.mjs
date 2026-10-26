// Validates generated GLBs with the Khronos glTF-Validator (library API; the npm package has no CLI).
import { readFileSync, writeFileSync } from 'node:fs';
import validator from 'gltf-validator';

const report = {};
let failed = false;
for (const name of ['bar-greybox.glb', 'avatar.glb']) {
  const r = await validator.validateBytes(new Uint8Array(readFileSync(`public/assets/${name}`)));
  const { numErrors, numWarnings, numInfos, numHints } = r.issues;
  report[name] = { validatorVersion: r.validatorVersion, numErrors, numWarnings, numInfos, numHints, messages: r.issues.messages.slice(0, 10).map((m) => `${m.severity}:${m.code} ${m.pointer ?? ''}`) };
  if (numErrors > 0) failed = true;
}
writeFileSync('results/gltf-validation.json', JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
process.exit(failed ? 1 : 0);
