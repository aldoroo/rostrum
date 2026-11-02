/* How things appear, an object lights its outline when first seen, then its forms come from largest to smallest, then its words from the largest type
   Figures run through digits, a later change runs only the digits that differ and flashes under the reading
   What a repaint brings unchanged stays still, everything is compared with what was last shown */
import {Digits} from './digits.js';
import {reducedMotion} from './util.js';
import {writtenItems} from './writing.js';

const RAMP_MS = 560;
const LOOK_FLASH = 'color-mix(in oklch,var(--rostrum-glow) 24%,transparent)';
const CELL_FLASH = 'color-mix(in oklch,var(--rostrum-glow) 22%,transparent)';
const NO_FLASH = 'color-mix(in oklch,var(--rostrum-glow) 0%,transparent)';
// a page open for days must not remember every row it ever showed
const SEEN_MOST = 50000;
// when a whole table is rewritten only this many cells run their digits, more would force a layout on every frame
const DECODE_MOST = 40;
// timings of the parts of an object, counted from the moment its outline lights up
const FORMS_AT = 120;
const FORMS_SPAN = 280;
const FORM_MS = 260;
const WORDS_AT = 340;
const WORDS_STEP = 110;
const WORDS_LEAST_MS = 200;
const WORDS_MOST_MS = 520;
// a form with at least this area is wiped in from its edge, a smaller one fades in
const DRAWN_AREA = 40000;
// limits on what one object may do in one frame
const LOOK_AT_MOST = 700;
const FORMS_MOST = 140;
const WORDS_MOST = 900;
// with more siblings than this the position among them is left out of the key
const SLOTS_MOST = 200;
const LONE_MOST = 2;
// an object first seen while the camera moves fades in whole, writing it letter by letter would cost camera frames
const PASSING_MS = 260;
// a chart with new data morphs from the old picture to the new one
const MORPH_MS = 520;
const MORPH_EASE = 'cubic-bezier(.2,.8,.2,1)';
const SHAPES_MOST = 600;

function inFrame(el) {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0;
}

function write(el, delay, duration = 460) {
  if (reducedMotion() || !el.animate) return;
  // keep any filter out of this animation, a clip-path and a filter animated together make the first 3D camera frame over that tab kill the tab (STATUS_BREAKPOINT on Intel Iris Xe)
  el.animate([
    {clipPath: 'inset(-6px 100% -6px -6px)'},
    {clipPath: 'inset(-6px 0% -6px -6px)', offset: 0.8},
    {clipPath: 'inset(-6px -6px -6px -6px)'}],
  {duration, delay, easing: 'cubic-bezier(.3,.6,.25,1)', fill: 'backwards'});
}

/* reads everything first and writes after, alternating would lay the chart out once per shape */
function draw(svg, delay) {
  if (reducedMotion()) return;
  const box = svg.getBoundingClientRect(), span = box.width || 1;
  const shapes = [...svg.querySelectorAll('path,polyline,line,rect,circle,text')].slice(0, 500).map(shape => {
    const style = getComputedStyle(shape), tag = shape.tagName.toLowerCase(), along = (shape.getBoundingClientRect().left - box.left) / span;
    const stroke = (tag === 'path' || tag === 'polyline') && style.fill === 'none' && style.stroke !== 'none' && style.strokeDasharray === 'none' && shape.getTotalLength ? shape.getTotalLength() : 0;
    const bar = tag === 'rect' && style.fill !== 'none' ? shape.getBBox() : null;
    return {shape, tag, along, stroke, opacity: style.opacity, bar: !!bar && bar.height > 2 && bar.width > 1.5};
  });
  for (const {shape, tag, along, stroke, opacity, bar} of shapes) {
    if (stroke > 12) {
      shape.animate([{strokeDasharray: `${stroke} ${stroke}`, strokeDashoffset: stroke}, {strokeDasharray: `${stroke} ${stroke}`, strokeDashoffset: 0}], {duration: 760, delay, easing: 'cubic-bezier(.45,.05,.2,1)', fill: 'backwards'});
    } else if (bar) {
      shape.style.transformBox = 'fill-box';
      shape.style.transformOrigin = '50% 100%';
      shape.animate([{transform: 'scaleY(0)'}, {transform: 'scaleY(1)'}], {duration: 520, delay: delay + along * 300, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards'});
    } else {
      shape.animate([{opacity: 0}, {opacity}], {duration: 320, delay: delay + (tag === 'circle' ? 520 : 80 + along * 240), fill: 'backwards'});
    }
  }
}

/* keys the shapes of a chart by colour and position within that colour, so a segment can be matched in the new picture */
function shapesOf(svg) {
  const turns = new Map(), out = new Map();
  for (const shape of [...svg.querySelectorAll('rect,path,circle')].slice(0, SHAPES_MOST)) {
    const tag = shape.tagName.toLowerCase(), paint = shape.getAttribute('fill') || shape.getAttribute('stroke') || shape.getAttribute('style') || '', kind = `${tag}|${paint}`, turn = turns.get(kind) || 0;
    turns.set(kind, turn + 1);
    const read = name => parseFloat(shape.getAttribute(name)) || 0;
    const form = tag === 'rect' ? {x: read('x'), y: read('y'), width: read('width'), height: read('height')} : tag === 'circle' ? {cx: read('cx'), cy: read('cy')} : {d: shape.getAttribute('d') || ''};
    out.set(`${kind}#${turn}`, {shape, form});
  }
  return out;
}

const samePath = (a, b) => a.replace(/[^A-Za-z]/g, '') === b.replace(/[^A-Za-z]/g, '');

const keyframe = form => (form.d !== undefined ? {d: `path("${form.d}")`} : Object.fromEntries(Object.entries(form).map(([name, value]) => [name, `${value}px`])));

/* returns false when the two pictures have too little in common to morph */
function morph(svg, before, after) {
  const common = [...after.keys()].filter(key => before.has(key));
  if (common.length < Math.max(before.size, after.size) * 0.6) return false;
  for (const [key, {shape, form}] of after) {
    const was = before.get(key);
    if (!was) shape.animate([{opacity: 0}, {opacity: 1}], {duration: MORPH_MS});
    else if (form.d === undefined || samePath(was.form.d, form.d)) shape.animate([keyframe(was.form), keyframe(form)], {duration: MORPH_MS, easing: MORPH_EASE});
  }
  for (const label of svg.querySelectorAll('text')) label.animate([{opacity: 0.25}, {opacity: 1}], {duration: MORPH_MS});
  return true;
}

/* true when the element paints something of its own, a surface, a frame or a line */
function isForm(el) {
  if (el.matches('tr,hr,button,input,select,textarea')) return true;
  if (el.matches('td,th,tbody,thead,table,svg,canvas')) return false;
  const style = getComputedStyle(el);
  return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backgroundImage !== 'none' || style.boxShadow !== 'none' ||
    style.borderTopWidth !== '0px' || style.borderBottomWidth !== '0px' || style.borderLeftWidth !== '0px' || style.borderRightWidth !== '0px';
}

export class Fx {
  /** @param {import('./index.js').Rostrum} rostrum @param {import('./writing.js').Writing} writing */
  constructor(rostrum, writing) {
    this.rostrum = rostrum;
    this.writing = writing;
    this.selectors = rostrum.options.fx;
    this.seen = new Map();
    this.born = new WeakMap();
    this.digits = new Digits();
    this.queue = new Set();
    this.queued = 0;
    // elements that held something when drawn, what comes into them later is a repaint
    this.drawn = new WeakSet();
    this.pictures = new Map();
    this.watch();
  }

  hasLit(el) {
    return el.classList.contains('rostrum-lit');
  }

  /* How far the light of an object has come on, from 0 to 1
     It rises to its level and never overshoots, an overshoot would look like the whole table getting brighter while a tab is drawn */
  rampOf(owner, clock) {
    const born = owner && this.born.get(owner);
    if (born === undefined || born === null) return owner && !reducedMotion() ? 0 : 1;
    const t = (clock - born) / RAMP_MS;
    if (t >= 1) return 1;
    if (t <= 0) return 0.0001;
    return 1 - (1 - t) ** 3;
  }

  /* during a flight the light waits until the camera is about to settle */
  untilLanding() {
    const {flight} = this.rostrum;
    return flight ? Math.max(0, flight.endsAt - performance.now() - 420) : 0;
  }

  struck(el) {
    return this.born.has(el);
  }

  /* lights the outline only, the contents come with ignite */
  strike(el) {
    if (!this.born.has(el)) this.born.set(el, performance.now() + this.untilLanding());
    this.rostrum.scene.request();
  }

  /* shows an object for the first time, in a held tab only letThrough from the wait for its data can do that */
  ignite(el, letThrough = false) {
    if (this.hasLit(el)) return;
    if (!letThrough && el.closest('.rostrum-held')) return;
    el.classList.add('rostrum-lit');
    this.strike(el);
    if (this.rostrum.camera.moving && !this.rostrum.flight) {
      this.show(el, 0, false, true);
      if (el.animate && !reducedMotion()) el.animate([{opacity: 0}, {opacity: 1}], {duration: PASSING_MS, easing: 'ease-out'});
      return;
    }
    this.show(el, this.untilLanding(), true);
  }

  readingKey(cell) {
    const label = cell.querySelector(this.selectors.reading.label);
    return `r|${this.scope(cell)}|${label ? label.textContent : ''}`;
  }

  /* lone means only a few figures changed, so a light under each shows where, with all of them changing a light would tell nothing */
  reading(cell, delay, quiet, index, lone) {
    const v = cell.querySelector(this.selectors.reading.value);
    if (!v) return;
    this.digits.settle(v);
    const key = this.readingKey(cell), before = this.seen.get(key), now = v.textContent;
    this.seen.set(key, now);
    if (quiet || before === now) return;
    if (before === undefined) {
      this.digits.run(v, delay + index * 34, 620);
      return;
    }
    this.digits.run(v, 0, 520, before);
    if (v.animate) v.animate([{filter: 'brightness(2)'}, {filter: 'brightness(1)'}], {duration: 760, easing: 'ease-out'});
    if (lone) this.rostrum.pointAt(cell);
  }

  /* a key for what is shown, so objects of a site without ids do not share remembered values */
  scope(el) {
    const owner = el.closest('.rostrum-on-table');
    return `${owner ? this.rostrum.keyOf(owner) : ''}|${(el.closest('[id]') || {}).id || ''}`;
  }

  nth(el, selector) {
    const owner = el.closest('.rostrum-on-table');
    return owner ? [...owner.querySelectorAll(selector)].indexOf(el) : 0;
  }

  table(table, delay, quiet) {
    const key = this.tableKey(table), first = !this.seen.has(key);
    let changed = 0;
    this.seen.set(key, 1);
    [...table.querySelectorAll('tbody tr')].slice(0, 120).forEach((row, r) => {
      const cells = [...row.children], rowKey = `${key}|${cells[0] ? cells[0].textContent.trim().slice(0, 48) : r}`, known = this.seen.has(rowKey);
      this.seen.set(rowKey, 1);
      if (!quiet && row.animate && !known) {
        if (first) {
          if (r < 18) row.animate([{opacity: 0}, {opacity: 1}], {duration: 280, delay: delay + r * 24, fill: 'backwards'});
        } else row.animate([{backgroundColor: LOOK_FLASH}, {backgroundColor: NO_FLASH}], {duration: 1100, easing: 'ease-out'});
      }
      cells.forEach((cell, c) => {
        this.digits.settle(cell);
        const cellKey = `${rowKey}|${c}`, before = this.seen.get(cellKey), now = cell.textContent;
        this.seen.set(cellKey, now);
        if (quiet || before === undefined || before === now || !/\d/.test(now)) return;
        if (++changed <= DECODE_MOST) this.digits.run(cell, 0, 420, before);
        if (cell.animate) cell.animate([{backgroundColor: CELL_FLASH}, {backgroundColor: NO_FLASH}], {duration: 900, easing: 'ease-out'});
      });
    });
  }

  writeIn(el) {
    write(el, 0, 320);
  }

  /* True for a place in an object that has never held anything, what comes there is drawn
     What a repaint puts in a known place is only compared */
  isNewPlace(root) {
    const table = root.closest('table');
    if (table && this.seen.has(this.tableKey(table))) return false;
    if (root.parentElement && this.drawn.has(root.parentElement)) return false;
    const parent = root.parentElement, at = parent && parent.childElementCount <= SLOTS_MOST ? [...parent.children].indexOf(root) : 0;
    const key = `s|${this.scope(root)}|${root.tagName}|${at}`, known = this.seen.has(key);
    this.seen.set(key, 1);
    return !known;
  }

  tableKey(table) {
    return `t|${this.scope(table)}|${this.nth(table, 'table')}`;
  }

  /* schedules the forms of something new from the largest, then its words from the largest type, on one timeline */
  draft(root, delay, first = false) {
    if (reducedMotion()) return;
    const all = [...root.querySelectorAll('*')].slice(0, LOOK_AT_MOST);
    // a skeleton may hold a placeholder when its object lights up, so the data replacing it still get drawn
    if (!first || root.closest('.rostrum-loaded')) for (const el of [root, ...all]) if (el.childNodes.length) this.drawn.add(el);
    const inside = all.filter(el => !el.ownerSVGElement && el.offsetWidth && isForm(el));
    if (!root.matches('.rostrum-on-table') && isForm(root)) inside.unshift(root);
    const forms = inside.map(el => ({el, area: el.offsetWidth * el.offsetHeight})).sort((a, b) => b.area - a.area).slice(0, FORMS_MOST);
    forms.forEach(({el, area}, rank) => {
      const at = delay + FORMS_AT + FORMS_SPAN * rank / forms.length;
      if (area >= DRAWN_AREA) write(el, at, FORM_MS + 160);
      else el.animate([{opacity: 0}, {opacity: 1}], {duration: FORM_MS, delay: at, easing: 'ease-out', fill: 'backwards'});
    });
    if (!this.writing.available) return;
    const bySize = new Map(), sizes = new Map();
    for (const item of writtenItems(root).slice(0, WORDS_MOST)) {
      const parent = (item.node || item.mark).parentElement;
      if (parent.closest('svg,style,script,textarea')) continue;
      if (!sizes.has(parent)) sizes.set(parent, Math.round(parseFloat(getComputedStyle(parent).fontSize) * this.rostrum.objectOf(parent.closest('.rostrum-on-table')).zoom));
      const size = sizes.get(parent);
      if (!bySize.has(size)) bySize.set(size, []);
      bySize.get(size).push(item);
    }
    const now = performance.now();
    this.writing.schedule([...bySize.keys()].sort((a, b) => b - a).map((size, rank) => {
      const nodes = bySize.get(size), total = nodes.reduce((sum, item) => sum + item.size, 0);
      return {root, nodes, total, span: Math.max(WORDS_LEAST_MS, Math.min(WORDS_MOST_MS, total * 1.2)), start: now + delay + WORDS_AT + rank * WORDS_STEP};
    }));
  }

  /* handles new content inside an object that is already lit */
  show(root, delay, first = false, passing = false) {
    const {reading} = this.selectors;
    root = root.closest(reading.cell) || root;
    const owner = root.closest('.rostrum-on-table');
    if (!owner || !this.hasLit(owner)) return;
    const seen = !passing && (first || inFrame(root)), fresh = this.isNewPlace(root) || first, quiet = !seen || fresh;
    const cells = root.matches(reading.cell) ? [root] : [...root.querySelectorAll(reading.cell)];
    this.compareHeads(root, delay, quiet);
    const changed = cells.filter(cell => {
      const v = cell.querySelector(reading.value), before = this.seen.get(this.readingKey(cell));
      return v && before !== undefined && before !== v.textContent;
    }).length;
    cells.forEach((cell, i) => this.reading(cell, delay, quiet, i, changed <= LONE_MOST));
    (root.matches('table') ? [root] : [...root.querySelectorAll('table')].slice(0, 8)).forEach(table => this.table(table, delay, quiet));
    this.comparePictures(root, delay, seen, quiet);
    if (seen && fresh) {
      this.draft(root, delay, first);
      cells.slice(0, DECODE_MOST).forEach((cell, i) => {
        const v = cell.querySelector(reading.value);
        if (v) this.digits.run(v, delay + WORDS_AT + i * 20, 620);
      });
    }
    this.forgetOldest();
  }

  compareHeads(root, delay, quiet) {
    const {heads, reading} = this.selectors;
    const found = !heads ? [] : root.matches(heads) ? [root] : [...root.querySelectorAll(heads)].slice(0, 60);
    found.forEach((head, i) => {
      if (head.closest(reading.cell)) return;
      const key = `h|${this.scope(head)}|${head.textContent.trim().slice(0, 60)}`;
      if (this.seen.has(key)) return;
      this.seen.set(key, 1);
      if (!quiet) write(head, delay + i * 22);
    });
  }

  comparePictures(root, delay, seen, quiet) {
    const pictures = root.matches('svg,canvas') ? [root] : [...root.querySelectorAll('svg,canvas')];
    pictures.forEach((picture, i) => {
      if (picture.closest(this.selectors.chartSkip)) return;
      const box = picture.getBoundingClientRect();
      if (box.width < 80 || box.height < 30) return;
      const key = `c|${this.scope(picture)}|${this.nth(picture, 'svg,canvas')}|${i}`, drawn = picture.tagName === 'svg' ? picture.innerHTML : null, signature = drawn === null ? 'canvas' : drawn.length + drawn.slice(-160), before = this.seen.get(key);
      this.seen.set(key, signature);
      if (before === signature) return;
      const was = this.pictures.get(key), now = picture.tagName === 'svg' ? shapesOf(picture) : null;
      if (now) this.pictures.set(key, now);
      if (!seen) return;
      if (before === undefined) {
        if (picture.tagName === 'svg') draw(picture, delay + FORMS_AT);
        else if (picture.animate && !reducedMotion()) picture.animate([{opacity: 0}, {opacity: 1}], {duration: 760, delay: delay + FORMS_AT, easing: 'ease-out', fill: 'backwards'});
        return;
      }
      if (quiet || !picture.animate || reducedMotion()) return;
      if (!(was && now && morph(picture, was, now))) picture.animate([{opacity: 0.45}, {opacity: 1}], {duration: 420, easing: 'ease-out'});
    });
  }

  forgetOldest() {
    if (this.seen.size <= SEEN_MOST) return;
    let over = this.seen.size - Math.floor(SEEN_MOST * 0.8);
    for (const key of this.seen.keys()) {
      if (over-- <= 0) break;
      this.seen.delete(key);
    }
  }

  stop() {
    this.watcher.disconnect();
    cancelAnimationFrame(this.queued);
    this.digits.stop();
  }

  watch() {
    this.watcher = new MutationObserver(records => {
      for (const record of records) {
        if (record.addedNodes.length) for (const node of record.addedNodes) this.queue.add(node.nodeType === 1 ? node : record.target);
      }
      if (this.queue.size && !this.queued) {
        this.queued = requestAnimationFrame(() => {
          this.queued = 0;
          const roots = new Set([...this.queue].filter(el => el.isConnected && !el.closest('.rostrum-tip-source')));
          this.queue = new Set();
          // keeps only the topmost changed elements, walking up the parents stays linear on a table of 20000 new rows
          const topmost = el => {
            for (let n = el.parentElement; n; n = n.parentElement) if (roots.has(n)) return false;
            return true;
          };
          [...roots].filter(topmost).forEach(el => this.show(el, 0, false, !!this.rostrum.flight));
        });
      }
    });
    this.watcher.observe(this.rostrum.plane, {childList: true, subtree: true});
  }
}
