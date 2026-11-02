/* When a person asks for data again objects step back and a point of light runs around the rim until the data land, then one pass of light goes down them
   A fast answer only gets the pass, background refreshes should not call this */
import {reducedMotion} from './util.js';

// an answer faster than this shows no waiting state
const WAIT_MS = 140;
const ROUND_MS = 1800;
const PASS_MS = 560;
const BACK_MS = 280;

export class Updates {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.waiting = new Map();
    this.passes = new Map();
    this.timers = new Set();
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    for (const el of this.waiting.keys()) el.classList.remove('rostrum-updating');
    this.waiting.clear();
    this.passes.clear();
  }

  objectsOf(target) {
    const {rostrum} = this;
    if (typeof target === 'string' && !rostrum.sectionOf(target)) {
      rostrum.warnOnce(`updating:${target}`, 'updating', new Error(`no tab is called "${target}", nothing shows that its data are on their way`));
      return [];
    }
    const found = typeof target === 'string' ? rostrum.options.surfaces(rostrum.sectionOf(target)) : [...target].map(el => el.closest('.rostrum-on-table')).filter(Boolean);
    return [...new Set(found)].filter(el => rostrum.fx.hasLit(el) && !rostrum.isDock(el));
  }

  begin(target, loaded) {
    if (reducedMotion()) {
      Promise.resolve(loaded).catch(error => this.rostrum.report('updating', error));
      return;
    }
    const round = {}, objects = this.objectsOf(target), now = performance.now();
    for (const el of objects) this.waiting.set(el, {round, at: now + WAIT_MS, shift: Math.random()});
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      for (const el of objects) if (this.waiting.get(el)?.round === round) el.classList.add('rostrum-updating');
      this.rostrum.scene.request();
    }, WAIT_MS);
    this.timers.add(timer);
    Promise.resolve(loaded).then(() => true, error => {
      this.rostrum.report('updating', error);
      return false;
    }).then(landed => this.finish(objects, round, landed));
  }

  finish(objects, round, landed) {
    const now = performance.now();
    for (const el of objects) {
      if (this.waiting.get(el)?.round !== round) continue;
      this.waiting.delete(el);
      if (el.classList.contains('rostrum-updating')) {
        el.classList.remove('rostrum-updating');
        if (el.animate) el.animate([{opacity: getComputedStyle(el).getPropertyValue('--rostrum-stale') || 0.62}, {opacity: 1}], {duration: BACK_MS, easing: 'ease-out'});
      }
      if (landed && el.isConnected) this.passes.set(el, now);
    }
    this.rostrum.scene.request();
  }

  /* what the table draws right now, a head from 0 to 1 is a point on the rim, a head from -1 to 0 is how far a pass has gone down */
  scans(clock) {
    const {rostrum} = this, out = [];
    const boxOf = el => {
      const at = rostrum.objectOf(el).world, zone = rostrum.zoneOf(rostrum.tabOf(el));
      return {x: zone.x + at.x, y: zone.y + at.y, w: at.w, h: at.h};
    };
    for (const [el, wait] of this.waiting) {
      if (clock >= wait.at && el.isConnected) out.push({...boxOf(el), head: ((clock - wait.at) / ROUND_MS + wait.shift) % 1});
    }
    for (const [el, at] of this.passes) {
      const gone = (clock - at) / PASS_MS;
      if (gone >= 1 || !el.isConnected) this.passes.delete(el);
      else out.push({...boxOf(el), head: -Math.max(gone, 0.0001)});
    }
    return out;
  }
}
