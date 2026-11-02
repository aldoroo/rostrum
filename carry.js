/* Moving and resizing an object, both started from its menu
   From there the object follows the pointer with no button held, the next press puts it down, Esc or the right button cancels
   Hovering or pressing on an object never moves it
   The camera drifts along when the pointer reaches the edge of the frame */
import {LEAST_SCALE, MOST_SCALE} from './object.js';
import {FINGER_CLICK_MS, swallowNextClick, targetOf} from './util.js';

const EDGE = 70;
const DRIFT_SPEED = 18;
// a width or height the pointer has not moved this far along stays free to follow the content
const SIZE_TOUCHED = 8;
const SCALE_SAVE_MS = 500;

export class Carry {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.moving = null;
    this.sizing = null;
    this.justEnded = false;
    this.scaleTimer = 0;
    this.eatMenu = false;
    this.aim = {object: null, z: 1};
    this.listen();
  }

  stop() {
    clearTimeout(this.scaleTimer);
    this.cancel();
    this.readout(null);
  }

  get active() {
    return !!(this.moving || this.sizing);
  }

  listen() {
    this.rostrum.listen(window, 'pointerdown', e => {
      if (!this.active) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // a finger cannot hover, so the object waits for it, follows the drag and stays where the finger lifts
      if (e.pointerType === 'touch') {
        this.takeWithFinger(e);
        return;
      }
      // the right button cancels, and the browser menu that comes with that press is suppressed
      if (e.button === 2) this.eatMenu = true;
      this.finish(e.button !== 0);
      this.justEnded = true;
    }, true);
    this.rostrum.listen(window, 'pointerup', e => {
      const carried = this.moving || this.sizing;
      if (carried && carried.finger === e.pointerId) {
        this.finish(false);
        this.justEnded = true;
      }
      if (!this.justEnded) return;
      this.justEnded = false;
      swallowNextClick(e.pointerType === 'touch' ? FINGER_CLICK_MS : 0);
    });
    this.rostrum.listen(window, 'contextmenu', e => {
      if (this.active || this.justEnded || this.eatMenu) e.preventDefault();
      this.eatMenu = false;
    });
    this.rostrum.listen(window, 'pointermove', e => {
      if (this.sizing) this.followSize(e);
      else if (this.moving) {
        this.moving.last = e;
        this.followMove(e);
      }
    });
    this.rostrum.listen(window, 'keydown', e => {
      if (e.key !== 'Escape' || !this.active) return;
      this.finish(true);
      swallowNextClick();
    });
    // Alt and the wheel over an object scale it, the object keeps its place on the table
    this.rostrum.listen(window, 'wheel', e => {
      if (!e.altKey || !targetOf(e).closest) return;
      const el = targetOf(e).closest('.rostrum-on-table');
      if (!el || !this.rostrum.keyOf(el)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.rostrum.adopt(this.rostrum.tabOf(el));
      const object = this.rostrum.objectOf(el);
      // a fine wheel sends small steps, their sum is kept apart from the rounded scale
      if (this.aim.object !== object) this.aim = {object, z: object.zoom};
      this.aim.z = Math.max(LEAST_SCALE, Math.min(MOST_SCALE, this.aim.z * Math.exp(-e.deltaY * 0.0012)));
      this.scale(object, this.aim.z);
      this.readout(object);
    }, {passive: false, capture: true});
  }

  takeWithFinger(e) {
    const {camera} = this.rostrum, at = {x: e.clientX, y: e.clientY};
    if (this.moving) {
      const m = this.moving, spot = m.object.spot, pin = m.object.pin;
      Object.assign(m, at, {finger: e.pointerId, camX: camera.x, camY: camera.y, left: spot ? spot.x : 0, top: spot ? spot.y : 0, pinX: pin ? pin.x : 0, pinY: pin ? pin.y : 0});
    } else {
      const s = this.sizing, world = s.object.world;
      Object.assign(s, at, {finger: e.pointerId, w: world.w, h: world.h});
    }
  }

  scale(object, wanted) {
    const {rostrum} = this, tab = rostrum.tab;
    object.writeScale(wanted);
    rostrum.collect();
    rostrum.tray.refresh(object);
    clearTimeout(this.scaleTimer);
    this.scaleTimer = setTimeout(() => {
      rostrum.arrangement(tab).save();
      this.readout(null);
      this.aim = {object: null, z: 1};
      rostrum.redraw(tab);
    }, SCALE_SAVE_MS);
  }

  startMove(object, x, y) {
    const {rostrum} = this, memory = object.memory(), onLens = !!object.pin;
    let left = 0, top = 0;
    if (!onLens) {
      // it starts from where it is seen, because a docked object is shown away from its place on the table
      const spot = object.liftToWhereSeen();
      left = spot.x;
      top = spot.y;
      object.pickUp();
    }
    const {camera} = rostrum, pin = object.pin;
    this.moving = {object, tab: rostrum.tab, onLens, x, y, left, top, camX: camera.x, camY: camera.y, last: null, pinX: pin ? pin.x : 0, pinY: pin ? pin.y : 0, memory, frame: 0, drift: 0};
    object.setLifted(true);
    rostrum.collect();
    document.documentElement.classList.add('rostrum-carrying');
    getSelection().removeAllRanges();
    camera.stop();
    this.moving.drift = requestAnimationFrame(() => this.drift());
  }

  drift() {
    const m = this.moving;
    if (!m) return;
    m.drift = requestAnimationFrame(() => this.drift());
    if (m.onLens || !m.last) return;
    const pull = (v, size) => (v < EDGE ? -(EDGE - v) / EDGE : v > size - EDGE ? (v - size + EDGE) / EDGE : 0);
    const vx = pull(m.last.clientX, innerWidth), vy = pull(m.last.clientY, innerHeight);
    if (!vx && !vy) return;
    const {camera} = this.rostrum;
    camera.jump(camera.x + vx * DRIFT_SPEED, camera.y + vy * DRIFT_SPEED);
    camera.apply();
    this.followMove(m.last);
  }

  followMove(e) {
    const m = this.moving, {rostrum} = this, {camera} = rostrum;
    if (m.onLens) {
      m.object.setPin(m.pinX + e.clientX - m.x, m.pinY + e.clientY - m.y);
      rostrum.holdFrame();
      return;
    }
    m.object.standAt(m.left + (e.clientX - m.x) * camera.scale + (camera.x - m.camX), m.top + (e.clientY - m.y) * camera.scale + (camera.y - m.camY));
    if (!m.frame) {
      m.frame = requestAnimationFrame(() => {
        m.frame = 0;
        rostrum.emitters.moved(m.object);
      });
    }
  }

  endMove(cancelled) {
    const m = this.moving, {rostrum} = this;
    cancelAnimationFrame(m.drift);
    cancelAnimationFrame(m.frame);
    this.moving = null;
    m.object.setLifted(false);
    document.documentElement.classList.remove('rostrum-carrying');
    if (cancelled) m.object.restore(m.memory);
    rostrum.arrangement(m.tab).save();
    rostrum.collect();
    rostrum.camera.apply();
    if (!cancelled) rostrum.emit('arranged', {tab: m.tab, object: m.object.key});
  }

  finish(cancelled) {
    if (this.moving) this.endMove(cancelled);
    else this.endSize(cancelled);
  }

  /* the tab is changing, so whatever is being carried goes back */
  cancel() {
    if (this.active) this.finish(true);
  }

  startSize(object, x, y) {
    const {rostrum} = this, memory = object.memory();
    object.claimSpot();
    const at = object.world;
    // what is held to the lens stands in the frame at the scale of the frame, so one pointer pixel is one object pixel
    this.sizing = {object, tab: rostrum.tab, x, y, w: at.w, h: at.h, k: object.pin ? 1 : rostrum.camera.scale, memory, frame: 0};
    document.documentElement.classList.add('rostrum-sizing');
    getSelection().removeAllRanges();
    this.readout(object);
  }

  followSize(e) {
    const s = this.sizing, size = s.object.size || {}, dx = e.clientX - s.x, dy = e.clientY - s.y;
    s.object.writeSize(
      size.w || Math.abs(dx) > SIZE_TOUCHED ? s.w + dx * s.k : undefined,
      size.h || Math.abs(dy) > SIZE_TOUCHED ? s.h + dy * s.k : undefined,
    );
    if (!s.frame) {
      s.frame = requestAnimationFrame(() => {
        s.frame = 0;
        this.rostrum.collect();
        this.readout(s.object);
      });
    }
  }

  endSize(cancelled) {
    const s = this.sizing, {rostrum} = this;
    this.sizing = null;
    cancelAnimationFrame(s.frame);
    document.documentElement.classList.remove('rostrum-sizing');
    if (cancelled) s.object.restore(s.memory);
    rostrum.arrangement(s.tab).save();
    this.readout(null);
    rostrum.collect();
    if (!cancelled) rostrum.emit('arranged', {tab: s.tab, object: s.object.key});
    // a chart draws to the width it finds, so it has to draw again at the new width
    rostrum.redraw(s.tab);
  }

  readout(object) {
    let box = document.getElementById('rostrumReadout');
    if (!object) {
      if (box) {
        this.rostrum.focus.close(box);
        box.remove();
      }
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.id = 'rostrumReadout';
      box.setAttribute('aria-hidden', 'true');
      document.body.append(box);
      this.rostrum.focus.open(box);
    }
    const r = object.el.getBoundingClientRect(), at = object.world;
    box.textContent = `${Math.round(at.w)} × ${Math.round(at.h)}  ${Math.round(object.zoom * 100)}%`;
    box.style.left = `${Math.max(8, Math.min(innerWidth - 170, r.right - 150))}px`;
    box.style.top = `${Math.max(8, Math.min(innerHeight - 30, r.bottom + 8))}px`;
    this.rostrum.focus.run();
  }
}
