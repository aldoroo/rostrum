/* Decides when the table should get more or fewer pixels, from the gaps between the draws of one movement
   Frames must be clearly fast for a long run before anything rises, frames between the two limits change nothing
   A rise that fails soon makes the next one wait twice as long, so the picture does not keep changing */

const SLOW_MS = 30;
const SLOW_MS_LITE = 50;
const SLOW_RUN = 12;
const FAST_MS = 20;
const FAST_MS_LITE = 38;
// about five seconds of movement at 60 frames a second
const FAST_RUN = 300;
const FAST_RUN_MOST = 4800;
// a drop within this many frames of a rise means that rise was wrong
const TRIAL_FRAMES = 240;
// longer than this is a pause between two movements
const PAUSE_MS = 500;

export class Pace {
  constructor() {
    this.slow = 0;
    this.fast = 0;
    this.needed = FAST_RUN;
    this.trial = 0;
  }

  /* the scene calls this when a rise has really been made, the trial counts from there */
  rose() {
    this.trial = TRIAL_FRAMES;
    this.fast = 0;
  }

  /* takes the gap before a draw and where the table stands, returns 'lower', 'lite', 'raise', 'full' or null
     busy means a long task ran just now, atFloor and atTop are the ends of the render scale, mayLeaveLite is false when lite comes from the device */
  frame(gap, {busy = false, lite = false, atFloor = false, atTop = false, mayLeaveLite = false} = {}) {
    if (gap <= 0) return null;
    if (gap >= PAUSE_MS || busy) {
      this.slow = 0;
      return null;
    }
    if (this.trial > 0 && --this.trial === 0) this.needed = Math.max(FAST_RUN, this.needed / 2);
    if (gap > (lite ? SLOW_MS_LITE : SLOW_MS)) {
      this.fast = 0;
      this.slow += 1;
      if (this.slow < SLOW_RUN) return null;
      this.slow = 0;
      if (this.trial > 0) this.needed = Math.min(FAST_RUN_MOST, this.needed * 2);
      this.trial = 0;
      return !atFloor ? 'lower' : lite ? null : 'lite';
    }
    this.slow = 0;
    this.fast = gap <= (lite ? FAST_MS_LITE : FAST_MS) ? this.fast + 1 : 0;
    if (this.fast < this.needed) return null;
    this.fast = 0;
    if (lite && mayLeaveLite) return 'full';
    return atTop ? null : 'raise';
  }
}
