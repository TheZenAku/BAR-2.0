// One cold run per process: `node src/node-run.mjs <package>` prints JSON.
import { runScenario } from './scenario.mjs';

const RAPIER = (await import(process.argv[2])).default;
console.log(JSON.stringify(await runScenario(RAPIER)));
