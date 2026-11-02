/* Work a site can spread over frames while the camera moves
   One piece runs right after a frame that came on time, and the next one waits in proportion to what the last one cost, so the camera keeps its frames
   At rest several pieces share a frame, and with nothing queued a piece runs at once */

// on the move the next piece waits this many times as long as the last piece took
const MOVING_PACE = 2;
// a frame later than this was late, what follows waits for one on time
const LATE_FRAME_MS = 22;
// at rest pieces run until this much of the frame is used, nothing moves then and held content is not visible yet
const REST_SLICE_MS = 24;

export class Lazy {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    /** @type {{key: any, run: Function}[]} */
    this.queue = [];
    /** @type {Function[]} */
    this.waiting = [];
    this.frame = 0;
    this.nextAt = 0;
    this.started = 0;
    this.frameStart = 0;
    this.running = false;
    this.pieces = new MessageChannel();
    this.pieces.port1.onmessage = ({data}) => {
      if (data === 'measure') this.measured();
      else this.piece();
    };
    // a page that gets hidden gets no more frames, what waits for one goes on without it
    rostrum.listen(document, 'visibilitychange', () => {
      if (!document.hidden || !this.frame) return;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.wake();
    });
  }

  stop() {
    cancelAnimationFrame(this.frame);
    this.pieces.port1.close();
    this.queue = [];
  }

  get busy() {
    return this.running || this.queue.length > 0;
  }

  /* a promise for a turn, the code after the await runs as a piece and is measured the same way */
  turn() {
    if (this.rostrum.isCalm && !this.busy) return Promise.resolve();
    return new Promise(resolve => this.add(null, resolve));
  }

  /* queues a piece of drawing, new work for a waiting key keeps its place in the queue and replaces the old work */
  later(key, work) {
    if (this.rostrum.isCalm && !this.busy) {
      work();
      return;
    }
    const known = this.queue.find(item => item.key === key);
    if (known) known.run = work;
    else this.add(key, work);
  }

  /* a promise for the moment nothing is left to run */
  drained() {
    if (!this.busy) return Promise.resolve();
    return new Promise(resolve => this.waiting.push(resolve));
  }

  add(key, run) {
    this.queue.push({key: key === null ? {} : key, run});
    if (!this.running) this.wake();
  }

  /* a hidden page gets no frames and its answers must still land */
  wake() {
    if (this.frame) return;
    if (document.hidden) {
      this.pieces.port2.postMessage('piece');
      return;
    }
    const before = this.frameStart;
    this.frame = requestAnimationFrame(now => {
      this.frame = 0;
      this.frameStart = now;
      if (now - before > LATE_FRAME_MS && !this.rostrum.isCalm && before) this.waitFrame();
      else this.pieces.port2.postMessage('piece');
    });
  }

  /* the last frame was late or nothing ran for a while, so this frame only measures how long a frame takes now */
  waitFrame() {
    this.frame = requestAnimationFrame(now => {
      const gap = now - this.frameStart;
      this.frameStart = now;
      this.frame = 0;
      if (gap > LATE_FRAME_MS && !this.rostrum.isCalm) this.waitFrame();
      else this.pieces.port2.postMessage('piece');
    });
  }

  piece() {
    if (!this.queue.length) return;
    if (!this.rostrum.isCalm && performance.now() < this.nextAt) {
      this.wake();
      return;
    }
    const {run} = this.queue.shift();
    this.running = true;
    this.started = performance.now();
    try {
      run();
    } catch (error) {
      this.rostrum.report('lazy', error);
    }
    // the code after an awaited turn runs before this message comes
    this.pieces.port2.postMessage('measure');
  }

  measured() {
    this.running = false;
    const now = performance.now(), calm = this.rostrum.isCalm;
    this.nextAt = now + (now - this.started) * MOVING_PACE;
    if (this.queue.length) {
      if (calm && now - this.frameStart < REST_SLICE_MS) this.pieces.port2.postMessage('piece');
      else this.wake();
      return;
    }
    for (const done of this.waiting.splice(0)) done();
  }
}
