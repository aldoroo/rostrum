/* Hour rulers under the calendar, one per end or one shared when both ends are on the same day
   An end names a minute inside the period, so the right edge of a ruler is 23:59 */

import {clamp} from './util.js';

export const DAY = 86400;
export const MINUTE = 60;
export const HOUR = 3600;
const DAY_MINUTES = 1440;
const LAST_MINUTE = DAY_MINUTES - 1;
const POINTER_STEP = 15;
const FINE_STEP = 5;
const WHEEL_NOTCH = 60;
const PULL_PX = 4;
const FINE_WAIT_MS = 500;
const TAG_GAP_PX = 6;
const LIT_ALPHA = 0.8;
const UNLIT_ALPHA = 0.26;
const BAND_ALPHA = 0.14;

export const two = n => String(n).padStart(2, '0');
const clockText = minute => `${two(Math.floor(minute / 60))}:${two(minute % 60)}`;

/* a canvas ready to draw on in CSS pixels, null while it has no size */
export function sharpCanvas(canvas) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const c = canvas.getContext('2d');
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  return {c, width, height};
}

export function endsOf({from, to}) {
  const last = to - MINUTE, fromDay = from - (from % DAY), toDay = last - (last % DAY);
  return {fromDay, fromMinute: (from - fromDay) / MINUTE, toDay, toMinute: (last - toDay) / MINUTE};
}

export function windowOf({fromDay, fromMinute, toDay, toMinute}) {
  return {from: fromDay + fromMinute * MINUTE, to: toDay + toMinute * MINUTE + MINUTE};
}

export function snapMinute(minute, step = POINTER_STEP) {
  return clamp(Math.round(minute / step) * step, 0, LAST_MINUTE);
}

/* one step from where an end stands, from off the grid the first step lands on the grid */
export function stepMinute(minute, delta, step = FINE_STEP) {
  const next = delta > 0 ? (Math.floor(minute / step) + delta) * step : (Math.ceil(minute / step) + delta) * step;
  return clamp(next, 0, LAST_MINUTE);
}

/* on the same day the two ends do not pass each other */
export function placeEnd(ends, side, minute) {
  const m = clamp(minute, 0, LAST_MINUTE), same = ends.fromDay === ends.toDay;
  if (side === 'from') return {...ends, fromMinute: same ? Math.min(m, ends.toMinute) : m};
  return {...ends, toMinute: same ? Math.max(m, ends.fromMinute) : m};
}

export class PeriodClock {
  /** @param {HTMLElement} host @param {any} options {bar, marks: [{name, color}], fromLabel, toLabel, dayText(day), seasonOf(day), loadHours(day), loaded(), failed(error), change(window, final), hover(hour)} */
  constructor(host, options) {
    this.host = host;
    this.options = options;
    /** @type {{from: number, to: number}} */
    this.window = {from: 0, to: DAY};
    /** @type {any} */
    this.held = null;
    /** @type {Map<number, Map<number, any> | null>} */
    this.hours = new Map();
    this.fineTimer = 0;
    this.wheelTurn = 0;
    this.abort = new AbortController();
    const labels = [6, 12, 18].map(hour => `<span style="left:${(hour / 24) * 100}%">${two(hour)}</span>`).join('');
    const ruler = '<div class="rostrum-period-ruler"><div class="rostrum-period-tags"></div><div class="rostrum-period-dial"><canvas></canvas></div>' +
      `<div class="rostrum-period-hours"><b></b>${labels}</div></div>`;
    host.innerHTML = ruler + ruler;
    /** @type {any[]} */
    this.rulers = [...host.querySelectorAll('.rostrum-period-ruler')];
    const hand = (side, label) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rostrum-period-hand';
      el.dataset.side = side;
      el.setAttribute('role', 'slider');
      el.setAttribute('aria-label', label);
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(LAST_MINUTE));
      return el;
    };
    this.hands = {from: hand('from', options.fromLabel), to: hand('to', options.toLabel)};
    const tag = () => document.createElement('span');
    this.tags = {from: tag(), to: tag()};
    this.listen();
  }

  stop() {
    this.abort.abort();
    this.cancelHold();
  }

  /* drops a drag or a pending fine step, the caller restores the window */
  cancelHold() {
    clearTimeout(this.fineTimer);
    this.held = null;
  }

  /* replaces the map, so an answer still on its way is ignored */
  forget() {
    this.hours = new Map();
  }

  want(day) {
    const {loadHours} = this.options;
    if (!loadHours || this.hours.has(day)) return;
    const asked = this.hours;
    asked.set(day, null);
    loadHours(day).then(answer => {
      if (asked !== this.hours) return;
      asked.set(day, new Map(answer.buckets.map(b => [b.t, b])));
      this.draw();
      this.options.loaded();
    }, error => {
      asked.delete(day);
      this.options.failed(error);
    });
  }

  /* the buckets of the hours of a day, null while they are not known */
  hoursOf(day) {
    const known = this.hours.get(day);
    return known ? [...known.values()] : null;
  }

  bucketAt(hour) {
    const known = this.hours.get(hour - (hour % DAY));
    return known ? known.get(hour) || null : null;
  }

  show(window) {
    this.window = window;
    this.draw();
  }

  shownSides() {
    const ends = endsOf(this.window), same = ends.fromDay === ends.toDay;
    return same
      ? [{day: ends.fromDay, sides: ['from', 'to'], low: ends.fromMinute, high: ends.toMinute}]
      : [{day: ends.fromDay, sides: ['from'], low: ends.fromMinute, high: LAST_MINUTE},
        {day: ends.toDay, sides: ['to'], low: 0, high: ends.toMinute}];
  }

  draw() {
    const {rulers, options} = this, shown = this.shownSides(), ends = endsOf(this.window);
    rulers[1].hidden = shown.length === 1;
    for (const part of shown) this.want(part.day);
    const values = shown.flatMap(part => this.hoursOf(part.day) || []).map(b => b.values[options.bar] || 0), most = Math.max(1, ...values);
    shown.forEach((part, i) => {
      const ruler = rulers[i], dial = ruler.querySelector('.rostrum-period-dial'), tags = ruler.querySelector('.rostrum-period-tags');
      for (const side of part.sides) {
        const hand = this.hands[side], minute = side === 'from' ? ends.fromMinute : ends.toMinute, text = clockText(minute);
        if (hand.parentElement !== dial) dial.append(hand);
        if (this.tags[side].parentElement !== tags) tags.append(this.tags[side]);
        hand.style.left = `${(minute / DAY_MINUTES) * 100}%`;
        hand.setAttribute('aria-valuenow', String(minute));
        hand.setAttribute('aria-valuetext', text);
        this.tags[side].textContent = text;
      }
      this.placeTags(part, tags.clientWidth, ends);
      ruler.querySelector('.rostrum-period-hours b').textContent = options.dayText(part.day);
      ruler.querySelector('.rostrum-period-hours b').dataset.season = options.seasonOf(part.day);
      this.drawDial(ruler.querySelector('canvas'), part, most);
    });
  }

  /* the tag of an end stands outside the hours it bounds, two tags on one ruler do not overlap */
  placeTags(part, width, ends) {
    const x = minute => (minute / DAY_MINUTES) * width, {from, to} = this.tags, gap = 3;
    const hasFrom = part.sides.includes('from'), hasTo = part.sides.includes('to');
    let fromRight = -TAG_GAP_PX;
    if (hasFrom) {
      const w = from.offsetWidth, room = width - w - (hasTo ? to.offsetWidth + TAG_GAP_PX : 0), left = clamp(x(ends.fromMinute) - w - gap, 0, Math.max(0, room));
      from.style.left = `${left}px`;
      fromRight = left + w;
    }
    if (hasTo) {
      const w = to.offsetWidth;
      to.style.left = `${clamp(x(ends.toMinute) + gap, fromRight + TAG_GAP_PX, Math.max(fromRight + TAG_GAP_PX, width - w))}px`;
    }
  }

  drawDial(canvas, part, most) {
    const sharp = sharpCanvas(canvas);
    if (!sharp) return;
    const {c, width, height} = sharp, {options} = this, ink = getComputedStyle(this.host).getPropertyValue('--rostrum-glow').trim(), base = height - 1.5, top = 5, step = width / 24, wide = Math.max(1, step - 1);
    const x = minute => (minute / DAY_MINUTES) * width, known = this.hours.get(part.day) || new Map();
    c.fillStyle = ink;
    c.globalAlpha = BAND_ALPHA;
    c.fillRect(x(part.low), 0, x(part.high + 1) - x(part.low), base);
    for (let hour = 0; hour < 24; hour++) {
      const lit = (hour + 1) * 60 > part.low && hour * 60 <= part.high, bucket = known.get(part.day + hour * HOUR);
      const count = bucket ? bucket.values[options.bar] || 0 : 0;
      if (count) {
        c.fillStyle = ink;
        c.globalAlpha = lit ? LIT_ALPHA : UNLIT_ALPHA;
        const h = Math.max(1.5, Math.sqrt(count / most) * (base - top));
        c.fillRect(hour * step, base - h, wide, h);
      }
      options.marks.forEach((mark, row) => {
        if (!bucket || !bucket.values[mark.name]) return;
        c.fillStyle = mark.color;
        c.globalAlpha = lit ? 1 : UNLIT_ALPHA;
        c.fillRect(hour * step, row * 3, wide, 2);
      });
      c.fillStyle = ink;
      c.globalAlpha = LIT_ALPHA;
      c.fillRect(hour * step, base - (hour % 6 ? 2 : 5), 1, hour % 6 ? 2 : 5);
    }
    c.fillRect(0, base, width, 1);
    c.globalAlpha = 1;
  }

  minuteAt(e, dial) {
    const r = dial.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1) * DAY_MINUTES;
  }

  place(ends, final) {
    this.window = windowOf(ends);
    this.draw();
    this.options.change(this.window, final);
  }

  /* which end a position on a ruler refers to */
  sideAt(rulerIndex, minute) {
    const ends = endsOf(this.window);
    if (ends.fromDay !== ends.toDay) return rulerIndex === 0 ? 'from' : 'to';
    return Math.abs(minute - ends.fromMinute) <= Math.abs(minute - ends.toMinute) ? 'from' : 'to';
  }

  moveFine(side, delta, step = FINE_STEP) {
    const ends = endsOf(this.window), minute = side === 'from' ? ends.fromMinute : ends.toMinute;
    this.place(placeEnd(ends, side, stepMinute(minute, delta, step)), false);
    clearTimeout(this.fineTimer);
    this.fineTimer = setTimeout(() => this.options.change(this.window, true), FINE_WAIT_MS);
  }

  listen() {
    const {signal} = this.abort;
    this.rulers.forEach((ruler, index) => {
      /** @type {any} */
      const dial = ruler.querySelector('.rostrum-period-dial');
      dial.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        clearTimeout(this.fineTimer);
        this.options.hover(null);
        const hand = e.target.closest('.rostrum-period-hand'), minute = this.minuteAt(e, dial), ends = endsOf(this.window);
        this.held = {id: e.pointerId, start: this.window, x: e.clientX, moved: false, anchor: snapMinute(minute), side: hand ? hand.dataset.side : null};
        if (hand) hand.focus();
        else if (ends.fromDay !== ends.toDay) {
          this.held.side = index === 0 ? 'from' : 'to';
          this.place(placeEnd(ends, this.held.side, snapMinute(minute)), false);
        }
        dial.setPointerCapture(e.pointerId);
      }, {signal});
      dial.addEventListener('pointermove', e => {
        const minute = this.minuteAt(e, dial);
        if (!this.held) {
          const hour = Math.min(23, Math.floor(minute / 60)), part = this.shownSides()[index];
          this.options.hover(part.day + hour * HOUR);
          return;
        }
        const {held} = this, ends = endsOf(this.window);
        if (!held.moved && Math.abs(e.clientX - held.x) < PULL_PX) return;
        // with both ends on one minute, take the end that can move in the direction of the drag
        if (!held.moved && held.side && ends.fromDay === ends.toDay && ends.fromMinute === ends.toMinute) held.side = e.clientX < held.x ? 'from' : 'to';
        held.moved = true;
        if (held.side) this.place(placeEnd(ends, held.side, snapMinute(minute)), false);
        else {
          const at = snapMinute(minute);
          this.place({...ends, fromMinute: Math.min(held.anchor, at), toMinute: Math.max(held.anchor, at)}, false);
        }
      }, {signal});
      dial.addEventListener('pointerleave', () => {
        if (!this.held) this.options.hover(null);
      }, {signal});
      dial.addEventListener('pointerup', e => {
        const {held} = this;
        if (!held) return;
        this.held = null;
        const minute = this.minuteAt(e, dial);
        // a press without a drag moves the nearer end there
        if (!held.moved && !held.side) {
          const side = this.sideAt(index, minute);
          this.place(placeEnd(endsOf(this.window), side, snapMinute(minute)), false);
        }
        if (this.window.from !== held.start.from || this.window.to !== held.start.to) this.options.change(this.window, true);
      }, {signal});
      dial.addEventListener('pointercancel', () => {
        const {held} = this;
        if (!held) return;
        this.held = null;
        this.place(endsOf(held.start), false);
      }, {signal});
      dial.addEventListener('wheel', e => {
        e.preventDefault();
        e.stopPropagation();
        this.wheelTurn += e.deltaY;
        if (Math.abs(this.wheelTurn) < WHEEL_NOTCH) return;
        const delta = this.wheelTurn < 0 ? 1 : -1;
        this.wheelTurn = 0;
        this.moveFine(this.sideAt(index, this.minuteAt(e, dial)), delta);
      }, {passive: false, signal});
    });
    this.host.addEventListener('keydown', e => {
      /** @type {any} */
      const t = e.target;
      const hand = t.closest && t.closest('.rostrum-period-hand'), delta = {ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1}[e.key];
      if (!hand || !delta) return;
      e.preventDefault();
      this.moveFine(hand.dataset.side, delta, e.shiftKey ? 60 : FINE_STEP);
    }, {signal});
  }
}
