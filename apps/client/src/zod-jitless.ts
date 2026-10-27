// Imported first by main.ts: Zod probes `new Function` when a schema is *created* (at import of @bar/shared), so
// jitless must be set before any schema module runs. Keeps the client compatible with a CSP without 'unsafe-eval'
// (the remote demo gateway sends one).
import { config } from 'zod';

config({ jitless: true });
