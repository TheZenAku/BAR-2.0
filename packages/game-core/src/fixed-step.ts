/**
 * Fixed-timestep accumulator. Simulation always advances in `step`-sized ticks regardless of frame rate;
 * the returned alpha (0..1) interpolates rendering between the last two ticks.
 * Long stalls (tab in background, debugger) are clamped to `maxSteps` to avoid a spiral of death.
 */
export class FixedStepper {
  readonly step: number;
  readonly maxSteps: number;
  private accumulator = 0;
  /** Ticks dropped because a frame exceeded `maxSteps` (visible in debug metrics). */
  droppedTicks = 0;

  constructor(step: number, maxSteps = 5) {
    if (!(step > 0)) throw new RangeError('step must be > 0');
    this.step = step;
    this.maxSteps = maxSteps;
  }

  /** Runs `tick` zero or more times for `frameSeconds` of real time; returns the interpolation alpha. */
  advance(frameSeconds: number, tick: () => void): number {
    if (Number.isFinite(frameSeconds) && frameSeconds > 0) this.accumulator += frameSeconds;
    let n = 0;
    while (this.accumulator >= this.step && n < this.maxSteps) {
      tick();
      this.accumulator -= this.step;
      n++;
    }
    if (this.accumulator >= this.step) {
      this.droppedTicks += Math.floor(this.accumulator / this.step);
      this.accumulator %= this.step;
    }
    return this.accumulator / this.step;
  }
}
