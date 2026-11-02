/* The wheel, keys and a drag on the table move the camera, a press on a control or a letter stays with the page so text can be selected
   Page scrolling is redirected to the camera so code written for a page keeps working */
import {CAMERA_F, MAX_H, MIN_H} from './camera.js';
import {FINGER_CLICK_MS, isTyping, swallowNextClick, targetOf} from './util.js';

const WORKING_START = 4;
const FINGER_START = 10;
const SWIPE_TAB = 70;
// how much of its speed a gliding camera keeps every 16 ms
const GLIDE = 0.95;
// wheel events closer together than this belong to one turn, including the inertia of a touchpad or a free wheel
const WHEEL_TURN_MS = 220;

/* the nearest ancestor that can still scroll in this direction, null when all are at their end */
function scrollsItself(el, dy, dx) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (dy && /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1 && (dy > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0)) return n;
    if (dx && /(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1 && (dx > 0 ? n.scrollLeft + n.clientWidth < n.scrollWidth - 1 : n.scrollLeft > 0)) return n;
  }
  return null;
}

function onLetter(x, y) {
  const at = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
  if (!at || at.startContainer.nodeType !== 3) return false;
  const glyph = at.cloneRange(), size = /** @type {Text} */ (at.startContainer).length;
  glyph.setStart(at.startContainer, Math.max(0, at.startOffset - 1));
  glyph.setEnd(at.startContainer, Math.min(size, at.startOffset + 1));
  const r = glyph.getBoundingClientRect();
  return r.width > 0 && x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1 && /\S/.test(glyph.toString());
}

function onScrollbar(el, x, y, frame) {
  for (let n = el; n && n !== frame; n = n.parentElement) {
    const style = getComputedStyle(n), r = n.getBoundingClientRect();
    if (/auto|scroll/.test(style.overflowY) && n.scrollHeight > n.clientHeight && x > r.left + n.clientLeft + n.clientWidth) return true;
    if (/auto|scroll/.test(style.overflowX) && n.scrollWidth > n.clientWidth && y > r.top + n.clientTop + n.clientHeight) return true;
  }
  return false;
}

export class Input {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.hand = null;
    this.pressed = false;
    this.fingers = new Map();
    this.pinch = null;
    this.gliding = 0;
    /** @type {any} */
    this.wheelOwner = null;
    this.wheelAt = 0;
    // shown during a drag to set the cursor by changing one element, which avoids a page style recalculation
    this.grip = document.createElement('div');
    this.grip.id = 'rostrumGrab';
    this.grip.setAttribute('aria-hidden', 'true');
    document.body.append(this.grip);
    this.takeOverScrolling();
    this.listenWheel();
    this.listenHand();
    this.listenKeys();
  }

  stop() {
    if (this.gliding) cancelAnimationFrame(this.gliding);
    if (this.hand && this.hand.frame) cancelAnimationFrame(this.hand.frame);
    this.grip.remove();
    this.restore();
  }

  /* code written for a page learns of a camera move through a scroll event */
  cameraMoved() {
    document.dispatchEvent(new Event('scroll', {bubbles: true}));
  }

  get handBusy() {
    return !!this.hand;
  }

  takeOverScrolling() {
    const {rostrum} = this, {camera, frame, plane} = rostrum;
    const native = Element.prototype.scrollIntoView, nativeTo = window.scrollTo, nativeY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    this.restore = () => {
      Element.prototype.scrollIntoView = native;
      /** @type {any} */ (window).scrollTo = nativeTo;
      Object.defineProperty(window, 'scrollY', nativeY);
    };
    Element.prototype.scrollIntoView = function intoView(options) {
      if (!plane.contains(this)) {
        native.call(this, options);
        return;
      }
      const r = this.getBoundingClientRect(), k = camera.scale;
      if (options && options.block === 'nearest' && r.top >= camera.top && r.bottom <= innerHeight - rostrum.options.bottom && r.left >= 0 && r.right <= innerWidth) return;
      camera.moveTo(camera.x + (r.left - camera.left) * k, camera.y + (r.top - (rostrum.isDock(this) ? camera.top : rostrum.headroom())) * k);
    };
    // the browser scrolls a clipped box to show what gets the focus, that becomes a camera move
    rostrum.listen(frame, 'scroll', () => {
      const k = camera.goalScale, dx = frame.scrollLeft, dy = frame.scrollTop;
      if (!dx && !dy) return;
      frame.scrollLeft = 0;
      frame.scrollTop = 0;
      // while a mouse button is held this is the autoscroll of a text selection, the camera does not jump after it
      if (!this.pressed) camera.moveTo(camera.goalX + dx * k, camera.goalY + dy * k);
    });
    /** @type {any} */ (window).scrollTo = (/** @type {any} */ a, /** @type {any} */ b) => {
      if (camera.switching) return;
      const top = typeof a === 'object' ? a.top : b;
      camera.moveTo(undefined, rostrum.zoneOf(rostrum.tab).y + (top || 0) + innerHeight / 2 - camera.top);
    };
    Object.defineProperty(window, 'scrollY', {configurable: true, get: () => camera.y - rostrum.zoneOf(rostrum.tab).y - innerHeight / 2 + camera.top});
  }

  /* the table was rearranged during a drag of the camera */
  shift(dx, dy) {
    if (!this.hand) return;
    this.hand.cx += dx;
    this.hand.cy += dy;
  }

  listenWheel() {
    const {rostrum} = this, {camera, options} = rostrum;
    rostrum.listen(window, 'wheel', e => {
      const k = camera.goalScale, unit = e.deltaMode === 1 ? 36 : e.deltaMode === 2 ? innerHeight : 1;
      if (e.ctrlKey) {
        e.preventDefault();
        camera.zoomAt(e.clientX, e.clientY, camera.goalH * Math.exp(e.deltaY * unit * 0.0016));
        return;
      }
      const dy = e.shiftKey ? 0 : e.deltaY * unit, dx = e.shiftKey ? e.deltaY * unit : e.deltaX * unit;
      if (options.wheelIgnore && targetOf(e).closest(options.wheelIgnore)) return;
      const scroller = scrollsItself(targetOf(e), dy, dx);
      if (scroller) {
        this.wheelOwner = scroller;
        // an event handled late carries its earlier time, that must not shorten the turn
        this.wheelAt = Math.max(this.wheelAt, e.timeStamp);
        return;
      }
      e.preventDefault();
      // the turn that scrolled a list to its end stays with the list, the camera moves on the next turn
      if (this.wheelOwner && e.timeStamp - this.wheelAt < WHEEL_TURN_MS && this.wheelOwner.contains(targetOf(e))) {
        this.wheelAt = Math.max(this.wheelAt, e.timeStamp);
        return;
      }
      this.wheelOwner = null;
      camera.moveTo(camera.goalX + dx * k, camera.goalY + dy * k);
    }, {passive: false});
  }

  listenHand() {
    const {rostrum} = this, {camera, frame, options} = rostrum;
    rostrum.listen(window, 'pointerdown', e => {
      this.pressed = true;
      if (this.gliding) {
        cancelAnimationFrame(this.gliding);
        this.gliding = 0;
      }
      if (e.button !== 0) return;
      const t = targetOf(e), finger = e.pointerType === 'touch';
      if (finger) {
        this.fingers.set(e.pointerId, {x: e.clientX, y: e.clientY});
        if (this.fingers.size === 2) {
          this.startPinch();
          return;
        }
      }
      // a finger cannot aim at a letter or hover, so a tap stays a tap and any drag moves the camera unless it starts on a field
      if (!t.closest || !frame.contains(t) || t.closest(finger ? 'input,select,textarea,[data-rostrum-hands-off]' : `${options.handIgnore},[data-rostrum-hands-off]`)) return;
      if (!finger && (onScrollbar(t, e.clientX, e.clientY, frame) || onLetter(e.clientX, e.clientY))) return;
      this.hand = {id: e.pointerId, x: e.clientX, y: e.clientY, cx: camera.goalX, cy: camera.goalY, going: false, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, vx: 0, vy: 0, frame: 0, finger, axis: null};
    }, true);
    rostrum.listen(window, 'pointermove', e => {
      if (this.fingers.has(e.pointerId)) {
        this.fingers.set(e.pointerId, {x: e.clientX, y: e.clientY});
        if (this.pinch) {
          this.followPinch();
          return;
        }
      }
      const hand = this.hand;
      if (!hand || e.pointerId !== hand.id) return;
      // the button went up where this page could not see it, another window or a menu
      if (!hand.finger && !e.buttons) {
        this.hand = null;
        this.letGo();
        return;
      }
      if (!hand.going) {
        if (Math.hypot(e.clientX - hand.x, e.clientY - hand.y) < (hand.finger ? FINGER_START : WORKING_START)) return;
        hand.going = true;
        // on a narrow screen a drag goes along one axis, down the column or across to the next tab
        if (rostrum.compact && camera.goalH === CAMERA_F) hand.axis = Math.abs(e.clientX - hand.x) > Math.abs(e.clientY - hand.y) ? 'x' : 'y';
        if (hand.finger) frame.setPointerCapture(e.pointerId);
        else {
          this.grip.classList.add('rostrum-held');
          this.grip.setPointerCapture(e.pointerId);
        }
        getSelection().removeAllRanges();
        camera.stop();
      }
      const k = camera.goalScale, dt = Math.max(1, e.timeStamp - hand.lastT);
      hand.vx = hand.vx * 0.6 + (e.clientX - hand.lastX) / dt * 0.4;
      hand.vy = hand.vy * 0.6 + (e.clientY - hand.lastY) / dt * 0.4;
      hand.lastX = e.clientX;
      hand.lastY = e.clientY;
      hand.lastT = e.timeStamp;
      if (hand.axis === 'x') camera.jump(hand.cx - (e.clientX - hand.x) * 0.5 * k, camera.y, camera.h, {free: true});
      else if (!hand.finger) {
        camera.follow(hand.cx - (e.clientX - hand.x) * k, hand.cy - (e.clientY - hand.y) * k);
        return;
      } else camera.jump(hand.cx - (e.clientX - hand.x) * k, hand.cy - (e.clientY - hand.y) * k);
      if (!hand.frame) {
        hand.frame = requestAnimationFrame(now => {
          if (this.hand) this.hand.frame = 0;
          camera.apply();
          rostrum.scene.flush(now);
        });
      }
    });
    const release = e => {
      this.pressed = false;
      this.fingers.delete(e.pointerId);
      if (this.pinch && this.fingers.size < 2) {
        this.pinch = null;
        // lifting the fingers of a pinch is not a click on anything
        swallowNextClick(FINGER_CLICK_MS);
      }
      const hand = this.hand;
      if (!hand || (e.pointerId !== undefined && e.pointerId !== hand.id)) return;
      this.hand = null;
      if (!hand.going) return;
      this.letGo();
      swallowNextClick(hand.finger ? FINGER_CLICK_MS : 0);
      const k = camera.goalScale, resting = e.timeStamp - hand.lastT > 70;
      if (hand.axis === 'x') {
        this.swipe(e.type === 'pointercancel' ? 0 : e.clientX - hand.x);
        return;
      }
      if (hand.finger) {
        if (!resting) this.glide(hand.vx, hand.vy);
        return;
      }
      // the camera keeps the speed of the pointer for a moment
      camera.release(resting ? 0 : hand.vx * k, resting ? 0 : hand.vy * k);
    };
    rostrum.listen(window, 'pointerup', release);
    rostrum.listen(window, 'pointercancel', release);
    rostrum.listen(window, 'blur', () => {
      this.pressed = false;
      this.hand = null;
      this.pinch = null;
      this.fingers.clear();
      this.letGo();
    });
    // stops the browser from dragging a ghost of a picture or a selection
    rostrum.listen(frame, 'dragstart', e => e.preventDefault());
  }

  letGo() {
    this.grip.classList.remove('rostrum-held');
  }

  /* a swipe across the column goes to the next tab, a short one falls back */
  swipe(dx) {
    const {rostrum} = this, {camera, options} = rostrum, at = options.tabs.indexOf(rostrum.tab), next = options.tabs[at + (dx < 0 ? 1 : -1)];
    // the camera remembers this tab where it stood before the finger took it sideways
    camera.goalX = camera.home(rostrum.tab).x;
    if (Math.abs(dx) >= SWIPE_TAB && next) rostrum.navigate(next);
    else camera.moveTo();
  }

  /* the camera goes on after the finger and slows down the way a flicked page does */
  glide(vx, vy) {
    const {camera} = this.rostrum;
    let last = performance.now();
    const step = now => {
      const dt = Math.max(1, now - last), keep = GLIDE ** (dt / 16), k = camera.scale;
      last = now;
      vx *= keep;
      vy *= keep;
      const {x, y} = camera;
      camera.jump(x - vx * dt * k, y - vy * dt * k);
      const stopped = camera.x === x && camera.y === y;
      camera.apply();
      this.gliding = stopped || Math.hypot(vx, vy) < 0.02 ? 0 : requestAnimationFrame(step);
    };
    this.gliding = requestAnimationFrame(step);
  }

  /* two fingers bring the table closer or take it further, the point between them stays under them */
  startPinch() {
    const {camera} = this.rostrum, [a, b] = [...this.fingers.values()];
    const at = camera.worldOf((a.x + b.x) / 2, (a.y + b.y) / 2);
    this.letGo();
    this.hand = null;
    camera.stop();
    this.pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      h: camera.h,
      worldX: at.x,
      worldY: at.y,
    };
  }

  followPinch() {
    const {camera} = this.rostrum, [a, b] = [...this.fingers.values()], {pinch} = this;
    const h = Math.max(MIN_H, Math.min(MAX_H, pinch.h * pinch.distance / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))));
    const k = h / CAMERA_F, midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
    camera.jump(pinch.worldX - (midX - innerWidth / 2) * k, pinch.worldY - (midY - innerHeight / 2) * k, h, {free: true});
    camera.apply();
  }

  listenKeys() {
    const {rostrum} = this, {camera} = rostrum;
    rostrum.listen(window, 'keydown', e => {
      const t = targetOf(e);
      if (isTyping(t) || t.matches('[role="slider"],[data-rostrum-hands-off]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const step = 220 * camera.goalScale;
      const keys = {ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0], PageUp: [0, -innerHeight * 0.8], PageDown: [0, innerHeight * 0.8]}[e.key];
      if (!keys) return;
      e.preventDefault();
      camera.moveTo(camera.goalX + keys[0], camera.goalY + keys[1]);
    });
  }
}
