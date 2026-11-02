/* One object on the table
   It knows its name, place, size, scale and whether it is held to the lens, and it writes all that to its element
   Menus, carrying and the docking of an instrument go through it
   The scale is CSS zoom and the browser scales even the left and top of the element by it, so written values are divided by the zoom and read values multiplied */
import {reducedMotion} from './util.js';

const MIN_WIDTH = 240;
const MIN_HEIGHT = 70;
// a figure may step over the rim of its object by this much before the object scrolls
const FIGURE_OVER_RIM = 20;
export const LEAST_SCALE = 0.5;
export const MOST_SCALE = 2;
export const SLIDE_MS = 340;

/* clears the temporary state of an element when it goes to a workbench, into a copy or back to its place */
export function loosen(el) {
  el.style.transform = '';
  el.classList.remove('rostrum-docked', 'rostrum-pinned', 'rostrum-lifted', 'rostrum-menu-open');
}

/* removes everything the engine wrote to an element, used when the engine is destroyed */
export function release(el) {
  loosen(el);
  el.classList.remove('rostrum-on-table', 'rostrum-over', 'rostrum-lit');
  for (const name of ['left', 'top', 'width', 'height', 'zoom', 'overflow-x', 'overflow-y', 'touch-action', '--rostrum-order']) el.style.removeProperty(name);
}

export class RostrumObject {
  /** @param {import('./index.js').Rostrum} rostrum @param {HTMLElement} el */
  constructor(rostrum, el) {
    this.rostrum = rostrum;
    this.el = el;
    this.slot = null;
    this.widenedAt = 0;
    this.placedAt = null;
    this.slide = null;
  }

  get key() {
    return this.rostrum.keyOf(this.el);
  }

  get arrangement() {
    return this.rostrum.arrangement(this.rostrum.tabOf(this.el));
  }

  get zoom() {
    return parseFloat(this.el.style.zoom) || 1;
  }

  /* place and size in table units */
  get world() {
    const z = this.zoom, {style, offsetWidth, offsetHeight} = this.el;
    return {x: parseFloat(style.left) * z, y: parseFloat(style.top) * z, w: offsetWidth * z, h: offsetHeight * z};
  }

  get spot() {
    return this.arrangement.spots[this.key];
  }

  get size() {
    return this.arrangement.sizes[this.key];
  }

  get pin() {
    return this.arrangement.pins[this.key];
  }

  /* the instrument of a tab goes along with the camera until the user says otherwise or puts it somewhere */
  get goesAlong() {
    return this.rostrum.isDock(this.el) && !this.spot && !this.pin && !this.arrangement.loose[this.key];
  }

  toggleAlong() {
    const {loose} = this.arrangement, key = this.key;
    if (loose[key]) delete loose[key];
    else loose[key] = true;
    this.arrangement.save();
    this.rostrum.holdFrame();
    this.rostrum.collect();
  }

  get title() {
    const head = this.el.querySelector(':scope>h1,:scope>h2,:scope>h3,:scope>summary');
    const first = head && [...head.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    return first ? first.textContent.trim() : '';
  }

  /* from the first move or resize the object stands at its own spot at the width it has, and goes on holding its slot in the lanes */
  claimSpot() {
    const spots = this.arrangement.spots, key = this.key;
    if (!spots[key]) {
      const at = this.world, slot = this.slot || {columns: 2, height: at.h};
      spots[key] = {x: Math.round(at.x), y: Math.round(at.y), w: Math.round(at.w), n: slot.columns, h: slot.height};
    }
    return spots[key];
  }

  /* wherever it is seen right now becomes its place, and it lies on top */
  liftToWhereSeen() {
    const r = this.el.getBoundingClientRect(), at = this.rostrum.camera.worldAt(r.left, r.top), spot = this.claimSpot();
    spot.x = Math.round(at.x);
    spot.y = Math.round(at.y);
    spot.o = this.arrangement.topOrder();
    return spot;
  }

  /* the call for a site, it moves the object, saves it and lays everything out */
  moveTo(x, y) {
    this.claimSpot();
    this.standAt(x, y);
    this.settled();
  }

  setSize(width, height) {
    this.writeSize(width, height);
    this.settled();
  }

  setScale(wanted) {
    this.writeScale(wanted);
    this.settled();
  }

  settled() {
    const {rostrum} = this;
    this.arrangement.save();
    rostrum.collect();
    rostrum.redraw(rostrum.tabOf(this.el));
  }

  /* runs on every frame of a move and writes only the place, the rest happens on release */
  standAt(x, y) {
    const spot = this.spot, z = this.zoom;
    spot.x = Math.round(x);
    spot.y = Math.round(y);
    this.el.style.left = `${spot.x / z}px`;
    this.el.style.top = `${spot.y / z}px`;
  }

  setPin(x, y) {
    const pin = this.pin;
    pin.x = Math.round(x);
    pin.y = Math.round(y);
  }

  togglePin() {
    const arrangement = this.arrangement, r = this.el.getBoundingClientRect(), key = this.key, pin = this.pin;
    if (pin) {
      if (pin.from) arrangement.spots[key] = pin.from;
      else if (pin.from === null) delete arrangement.spots[key];
      delete arrangement.pins[key];
      this.el.style.transform = '';
      this.el.classList.remove('rostrum-pinned');
    } else {
      this.el.classList.remove('rostrum-docked');
      arrangement.pins[key] = {x: Math.round(r.left), y: Math.round(r.top), from: this.spot ? {...this.spot} : null};
    }
    arrangement.save();
    this.rostrum.collect();
    if (pin) this.flyFrom(r);
  }

  /* animates from where it was held to its place, only transform moves */
  flyFrom(was) {
    const {el} = this, now = el.getBoundingClientRect();
    if (!el.animate || reducedMotion() || !now.width) return;
    const k = this.rostrum.camera.scale / this.zoom, moved = `translate(${(was.left - now.left) * k}px,${(was.top - now.top) * k}px) scale(${was.width / now.width})`;
    el.animate([{transform: moved, transformOrigin: '0 0'}, {transform: 'none', transformOrigin: '0 0'}], {duration: SLIDE_MS, easing: 'cubic-bezier(.2,.8,.2,1)'});
  }

  writeSize(width, height) {
    const sizes = this.arrangement.sizes, key = this.key;
    sizes[key] = sizes[key] || {};
    if (width !== undefined) sizes[key].w = Math.round(Math.max(MIN_WIDTH, width));
    if (height !== undefined) sizes[key].h = Math.round(Math.max(MIN_HEIGHT, height));
  }

  writeScale(wanted) {
    const sizes = this.arrangement.sizes, key = this.key, z = Math.max(LEAST_SCALE, Math.min(MOST_SCALE, wanted));
    this.claimSpot();
    sizes[key] = sizes[key] || {};
    sizes[key].z = Math.abs(z - 1) < 0.015 ? 1 : Math.round(z * 100) / 100;
  }

  reset() {
    const {sizes, pins, spots, loose} = this.arrangement, key = this.key;
    delete sizes[key];
    delete pins[key];
    delete spots[key];
    delete loose[key];
    this.el.style.transform = '';
    this.el.classList.remove('rostrum-pinned');
    this.settled();
    this.rostrum.camera.apply();
  }

  dockBy(dy) {
    this.el.classList.toggle('rostrum-docked', dy > 0);
    const moved = dy > 0 ? `translate(0px,${dy}px)` : '';
    if (this.el.style.transform !== moved) this.el.style.transform = moved;
  }

  /* while carried it stands where it is seen and lies over everything */
  pickUp() {
    this.el.style.transform = '';
    this.el.classList.remove('rostrum-docked');
  }

  setLifted(on) {
    this.el.classList.toggle('rostrum-lifted', on);
  }

  setMenuOpen(on) {
    this.el.classList.toggle('rostrum-menu-open', on);
  }

  /* what the object remembers before an act that can be taken back */
  memory() {
    const {spot, size, pin} = this;
    return {spot: spot ? {...spot} : null, size: size ? {...size} : null, pin: pin ? {...pin} : null};
  }

  restore(memory) {
    const {spots, sizes, pins} = this.arrangement, key = this.key;
    for (const [part, value] of [[spots, memory.spot], [sizes, memory.size], [pins, memory.pin]]) {
      if (value) part[key] = value;
      else delete part[key];
    }
  }

  /* A tab lays its objects out in passes, each pass only writes or only reads, so the browser lays the page out once per pass
     This first pass writes what depends on no measurement */
  write({lane, span}, lanes) {
    const {el} = this, key = this.key, spot = key && this.spot, size = key && this.size, pin = key && this.pin;
    el.classList.add('rostrum-on-table');
    el.classList.toggle('rostrum-pinned', !!pin);
    const order = spot && spot.o ? String(spot.o) : '';
    if (el.style.getPropertyValue('--rostrum-order') !== order) el.style.setProperty('--rostrum-order', order);
    const z = (size && size.z) || 1, zoom = z === 1 ? '' : String(z);
    if (el.style.zoom !== zoom) el.style.zoom = zoom;
    let columns = spot ? spot.n : Math.max(1, Math.min(2, span || 2)), width = spot ? spot.w : lanes.width(columns);
    if (size && size.w) {
      width = Math.max(MIN_WIDTH, size.w);
      if (!spot) columns = width > lanes.width(1) + 1 ? 2 : 1;
    }
    // content that overflowed one column at this width keeps two, otherwise the width would flip on every layout
    const free = !spot && !(size && size.w);
    if (free && columns === 1 && this.widenedAt === lanes.unit) {
      columns = 2;
      width = lanes.width(2);
    }
    const css = `${width / z}px`;
    if (el.style.width !== css) el.style.width = css;
    const height = size && size.h ? `${size.h / z}px` : '';
    if (el.style.height !== height) {
      el.style.height = height;
      el.style.overflowY = height ? 'auto' : '';
    }
    return {lane, columns, z, spot, free};
  }

  /* true when a popup or its blur stands over the object, those reach past its edge without being its content */
  overlaid() {
    return [...this.el.querySelectorAll(this.rostrum.popups.selector)].some((/** @type {HTMLElement} */ overlay) => overlay.offsetWidth > 0);
  }

  /* second pass, a read, content wider than one column asks for two */
  wantsWider(state) {
    const {el} = this;
    return state.free && state.columns === 1 && el.scrollWidth > el.clientWidth + 4 && !this.overlaid();
  }

  widen(state, lanes) {
    state.columns = 2;
    this.widenedAt = lanes.unit;
    this.el.style.width = `${lanes.width(2) / state.z}px`;
  }

  /* third pass, a read of the final size */
  measure(state) {
    const {el} = this;
    state.wide = el.scrollWidth > el.clientWidth + FIGURE_OVER_RIM && (el.style.overflowX === 'auto' || !this.overlaid());
    state.w = el.offsetWidth * state.z;
    state.h = el.offsetHeight * state.z;
  }

  /* last pass, the object takes its slot in the lanes and is written to its place */
  place(state, lanes) {
    const {el} = this, {spot, z, columns, h} = state;
    // content that is still too wide scrolls inside the object, a smaller overflow may step over the rim
    if (el.style.overflowX !== (state.wide ? 'auto' : '')) {
      el.style.overflowX = state.wide ? 'auto' : '';
      // sideways a finger scrolls what is wider than the object, down it still moves the camera
      el.style.touchAction = state.wide ? 'pan-x' : '';
    }
    const slotH = spot ? spot.h : h, slot = lanes.take(state.lane, columns, slotH);
    const x = spot ? spot.x : slot.x, y = spot ? spot.y : slot.y, left = `${x / z}px`, top = `${y / z}px`;
    if (el.style.left !== left) el.style.left = left;
    if (el.style.top !== top) el.style.top = top;
    if (!spot) this.slot = {columns, height: slotH};
    this.slideFrom(x, y, h, !!spot);
    return {object: this, x, y, w: state.w, h, o: (spot && spot.o) || 0};
  }

  /* content above pushed it down or it grew, so it slides there, what the hand placed stays put */
  slideFrom(x, y, h, placedByHand) {
    const was = this.placedAt, {el} = this;
    this.placedAt = {x, y, h};
    if (!was || placedByHand || was.x !== x || (was.y === y && was.h === h) || el.matches('.rostrum-docked,.rostrum-pinned,.rostrum-lifted') || !this.rostrum.fx.struck(el)) return;
    const dy = was.y - y;
    this.slide = {dy, dh: was.h - h, at: performance.now()};
    if (dy && el.animate && !reducedMotion()) {
      el.animate([{transform: `translateY(${dy / this.zoom}px)`}, {transform: 'translateY(0)'}], {duration: SLIDE_MS, easing: 'cubic-bezier(.2,.8,.2,1)'});
    }
  }

  /* held to the lens it stands at its place in the frame at any height of the camera */
  holdToLens() {
    const pin = this.pin;
    if (!pin) return;
    const {x, y} = this.rostrum.camera.screenOrigin(), k = this.rostrum.camera.scale, at = this.world, z = this.zoom;
    const dx = ((pin.x - x) * k - at.x) / z, dy = ((pin.y - y) * k - at.y) / z, moved = `translate(${dx}px,${dy}px) scale(${k})`;
    if (this.el.style.transform !== moved) this.el.style.transform = moved;
  }
}
