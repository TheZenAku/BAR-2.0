// Initial graphics profiles. Chosen at boot (`?gfx=low|medium|high`); antialias needs a new WebGL context,
// so switching requires a reload. Defaults to `medium`. Values are starting points, to be tuned with
// measurements on physical hardware (M12) — VM numbers do not transfer.

export type ProfileName = 'low' | 'medium' | 'high';

export interface GraphicsProfile {
  readonly name: ProfileName;
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
}

export const PROFILES: Readonly<Record<ProfileName, GraphicsProfile>> = {
  low: { name: 'low', maxPixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 0 },
  medium: { name: 'medium', maxPixelRatio: 1.5, antialias: true, shadows: true, shadowMapSize: 1024 },
  high: { name: 'high', maxPixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048 },
};

export function resolveProfile(search: string): GraphicsProfile {
  const requested = new URLSearchParams(search).get('gfx');
  return requested && Object.hasOwn(PROFILES, requested) ? PROFILES[requested as ProfileName] : PROFILES.medium;
}

export function pixelRatioFor(profile: GraphicsProfile, devicePixelRatio: number): number {
  return Math.min(Math.max(devicePixelRatio || 1, 1), profile.maxPixelRatio);
}
