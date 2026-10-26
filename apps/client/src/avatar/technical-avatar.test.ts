import { describe, expect, it } from 'vitest';
import { buildClip, TechnicalAvatar } from './technical-avatar.ts';

describe('TechnicalAvatar', () => {
  it('builds valid looping clips whose tracks bind to existing joints', () => {
    const avatar = new TechnicalAvatar();
    for (const name of ['idle', 'walk', 'run'] as const) {
      const clip = buildClip(name);
      expect(clip.validate()).toBe(true);
      for (const track of clip.tracks) {
        const node = track.name.split('.')[0]!;
        expect(avatar.object.getObjectByName(node), node).toBeDefined();
      }
    }
    avatar.dispose();
  });

  it('crossfades to the requested locomotion and animates joints', () => {
    const avatar = new TechnicalAvatar();
    const leg = avatar.object.getObjectByName('legL')!;
    avatar.setLocomotion('walk', 2.2);
    for (let i = 0; i < 20; i++) avatar.update(1 / 60);
    expect(avatar.activeAnimation).toBe('walk');
    expect(Math.abs(leg.quaternion.x)).toBeGreaterThan(0.01);
    avatar.setLocomotion('run', 5);
    avatar.update(1 / 60);
    expect(avatar.activeAnimation).toBe('run');
    avatar.dispose();
    expect(avatar.object.children.length).toBe(0);
  });
});
