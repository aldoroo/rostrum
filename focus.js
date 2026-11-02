/* Focus pull for menus and tips, what is near the words goes out of focus and what is further stays sharp, with no outline and no background
   The field is a few layers of backdrop blur with feathered edges, each larger and weaker than the one inside it
   A layer sits next to its overlay so it moves and scales with it inside the camera frame */
import {coarse, reducedMotion} from './util.js';
import {writtenItems} from './writing.js';

const PAD = 10;
const QUICK_EDGE = 12;
const OPEN_MS = 180;
const CLOSE_MS = 100;
const IDLE_FRAMES = 30;
const FIELD = [
  {reach: 190, blur: 1, dim: 0.99},
  {reach: 130, blur: 3, dim: 0.95},
  {reach: 80, blur: 6, dim: 0.86},
  {reach: 36, blur: 12, dim: 0.68},
];
const STRONGEST = FIELD[FIELD.length - 1];
// a phone has a small GPU, so it skips the outer layers, and a finger hides most of the field anyway
const FIELD_LITE = FIELD.slice(-2);
// a tip is a line or two, so its field stays close above and below it and rises gently toward the point it is about
const TIP_SHAPE = {across: 0.55, down: 0.3, quick: 24};
const WHOLE_SHAPE = {across: 1, down: 1, quick: QUICK_EDGE};

/* the box of the words of an overlay, up to the point writing has reached */
function wordsBox(root, head) {
  const range = document.createRange(), box = {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity};
  const take = r => {
    if (r.width <= 0 || r.height <= 0) return;
    box.left = Math.min(box.left, r.left);
    box.top = Math.min(box.top, r.top);
    box.right = Math.max(box.right, r.right);
    box.bottom = Math.max(box.bottom, r.bottom);
  };
  for (const {node, mark} of writtenItems(root)) {
    if (mark) take(mark.getBoundingClientRect());
    else {
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) take(r);
    }
    if (head && (node || mark) === head) return box.left === Infinity ? null : box;
  }
  for (const el of root.querySelectorAll('input')) take(el.getBoundingClientRect());
  return box.left === Infinity ? null : box;
}

/* One layer of the field in the coordinates of its parent, scale is the scale the parent is shown at
   sharp is the box the words are about, the field stops at its edge on the side of the words */
export function layerStyle(box, reach, origin = {left: 0, top: 0}, scale = 1, sharp = null, shape = WHOLE_SHAPE) {
  const fix = n => Math.round(n * 10) / 10, wide = reach * shape.across, tall = reach * shape.down;
  let x0 = box.left - PAD - wide, x1 = box.right + PAD + wide, y0 = box.top - PAD - tall, y1 = box.bottom + PAD + tall;
  const cut = {left: false, right: false, top: false, bottom: false};
  if (sharp) {
    if (box.left >= sharp.right) {
      cut.left = x0 < sharp.right;
      x0 = Math.max(x0, sharp.right);
    } else if (box.right <= sharp.left) {
      cut.right = x1 > sharp.left;
      x1 = Math.min(x1, sharp.left);
    } else if (box.top >= sharp.bottom) {
      cut.top = y0 < sharp.bottom;
      y0 = Math.max(y0, sharp.bottom);
    } else if (box.bottom <= sharp.top) {
      cut.bottom = y1 > sharp.top;
      y1 = Math.min(y1, sharp.top);
    }
  }
  // the mask is eased because a straight ramp shows where it starts and ends
  // toward the sharp box it rises quickly, text right beside that box must already be blurred or it reads together with the words
  const fullAcross = fix((wide + PAD) / scale), fullDown = fix((tall + PAD) / scale), quick = fix(shape.quick / scale);
  const ramp = (near, far) => {
    const at = (feather, share, from) => (from === 'start' ? `${fix(feather * share)}px` : `calc(100% - ${fix(feather * share)}px)`);
    return `transparent,rgba(0,0,0,.08) ${at(near, 0.25, 'start')},rgba(0,0,0,.5) ${at(near, 0.6, 'start')},#000 ${near}px,#000 calc(100% - ${far}px),rgba(0,0,0,.5) ${at(far, 0.6, 'end')},rgba(0,0,0,.08) ${at(far, 0.25, 'end')},transparent`;
  };
  const across = ramp(cut.left ? Math.min(fullAcross, quick) : fullAcross, cut.right ? Math.min(fullAcross, quick) : fullAcross);
  const down = ramp(cut.top ? Math.min(fullDown, quick) : fullDown, cut.bottom ? Math.min(fullDown, quick) : fullDown);
  return {
    left: `${fix((x0 - origin.left) / scale)}px`,
    top: `${fix((y0 - origin.top) / scale)}px`,
    width: `${fix((x1 - x0) / scale)}px`,
    height: `${fix((y1 - y0) / scale)}px`,
    maskImage: `linear-gradient(to right,${across}),linear-gradient(to bottom,${down})`,
  };
}

export {TIP_SHAPE};

export class Focus {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.fields = new Map();
    this.frame = 0;
    this.idle = 0;
    this.lite = coarse();
    this.warmUp();
  }

  /* the first blur stalls the GPU while its program is built, so one is drawn during page load */
  warmUp() {
    const el = document.createElement('div');
    el.className = 'rostrum-focus';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = `left:0;top:0;width:48px;height:48px;opacity:.01;backdrop-filter:blur(${STRONGEST.blur}px) brightness(${STRONGEST.dim})`;
    document.body.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.remove()));
  }

  /* starts the field around an overlay, it fades in over the time the words take to appear */
  open(overlay, span = OPEN_MS, sharpBox = null, shape = WHOLE_SHAPE) {
    let field = this.fields.get(overlay);
    if (field) Object.assign(field, {sharpBox, shape});
    if (!field) {
      const inside = this.rostrum.frame.contains(overlay);
      const layers = (this.lite ? FIELD_LITE : FIELD).map(step => {
        const el = document.createElement('div');
        el.className = inside ? 'rostrum-focus rostrum-focus-inside' : 'rostrum-focus';
        if (inside && overlay.matches('[data-rostrum-popup]')) el.classList.add('rostrum-focus-menu');
        el.setAttribute('aria-hidden', 'true');
        el.style.backdropFilter = `blur(${step.blur}px) brightness(${step.dim})`;
        el.style.setProperty('-webkit-backdrop-filter', `blur(${step.blur}px) brightness(${step.dim})`);
        if (inside) overlay.before(el);
        else document.body.append(el);
        if (!reducedMotion()) el.animate([{opacity: 0}, {opacity: 1}], {duration: span, easing: 'linear', fill: 'backwards'});
        return {el, reach: step.reach};
      });
      field = {layers, inside, sharpBox, shape, signature: ''};
      this.fields.set(overlay, field);
    }
    this.run();
  }

  close(overlay) {
    const field = this.fields.get(overlay);
    if (!field) return;
    this.fields.delete(overlay);
    for (const {el} of field.layers) {
      if (reducedMotion()) el.remove();
      else el.animate([{opacity: 1}, {opacity: 0}], {duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards'}).finished.then(() => el.remove());
    }
  }

  run() {
    this.idle = 0;
    if (!this.frame && this.fields.size) this.frame = requestAnimationFrame(() => this.tick());
  }

  stop() {
    for (const overlay of [...this.fields.keys()]) this.close(overlay);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  tick() {
    this.frame = 0;
    if ([...this.fields.keys()].some(overlay => this.rostrum.writing.headOf(overlay))) this.idle = 0;
    for (const [overlay, field] of [...this.fields]) {
      if (!overlay.isConnected || !overlay.offsetWidth) {
        this.close(overlay);
        continue;
      }
      const box = wordsBox(overlay, this.rostrum.writing.headOf(overlay));
      if (box) this.write(overlay, field, box);
    }
    // after a while with no change stop asking for frames until run() is called again
    if (this.fields.size && ++this.idle < IDLE_FRAMES) this.frame = requestAnimationFrame(() => this.tick());
  }

  write(overlay, field, box) {
    let origin = {left: 0, top: 0}, scale = 1;
    if (field.inside) {
      const parent = overlay.parentElement, r = parent.getBoundingClientRect();
      scale = r.width / parent.offsetWidth || 1;
      origin = {left: r.left - parent.scrollLeft * scale, top: r.top - parent.scrollTop * scale};
    }
    const sharp = field.sharpBox ? field.sharpBox() : null;
    const signature = `${box.left | 0},${box.top | 0},${box.right | 0},${box.bottom | 0},${origin.left | 0},${origin.top | 0},${scale.toFixed(3)},${sharp ? `${sharp.left | 0},${sharp.top | 0},${sharp.right | 0},${sharp.bottom | 0}` : ''}`;
    if (signature === field.signature) return;
    this.idle = 0;
    field.signature = signature;
    for (const {el, reach} of field.layers) Object.assign(el.style, layerStyle(box, reach, origin, scale, sharp, field.shape));
  }
}
