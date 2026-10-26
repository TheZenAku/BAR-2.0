import { z } from 'zod';

/** Incremented on any breaking change to client/server contracts. */
export const PROTOCOL_VERSION = 1;

/** Response of `GET /health`. Strict: unknown fields are rejected. */
export const HealthResponse = z.strictObject({
  status: z.literal('ok'),
  version: z.string().min(1),
  protocol: z.number().int().positive(),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
