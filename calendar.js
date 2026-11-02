/* A period picker with two ends as digit groups (type, arrows, wheel, pull), a line of activity between them and a calendar panel with hour rulers
   Changes made while the panel is open reach the site when it closes, Escape cancels them
   Times are wall clock seconds counted as UTC and the end of a period is exclusive */

import {DAY, HOUR, MINUTE, PeriodClock, sharpCanvas, two} from './clock.js';

const WIDTH_OF = {day: 2, month: 2, year: 4, hour: 2, minute: 2};
const WHEEL_NOTCH = 60;
const MOST_WEEKS = 6;
// a drag over a group of digits starts after PULL_START_PX and moves one step per PULL_STEP_PX
const PULL_START_PX = 3;
const PULL_STEP_PX = 6;
const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
// stepped digits are committed once stepping has paused this long
const STEPS_WAIT_MS = 500;
const LINE_ALPHA = 0.5;

const parts = seconds => {
  const d = new Date(seconds * 1000);
  return {year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes()};
};
const wall = (year, month, day, hour = 0, minute = 0) => Date.UTC(year, month, day, hour, minute) / 1000;

export const dateText = seconds => {
  const p = parts(seconds);
  return `${two(p.day)}.${two(p.month + 1)}.${p.year}`;
};
const timeText = seconds => {
  const p = parts(seconds);
  return `${two(p.hour)}:${two(p.minute)}`;
};

/* null for a date that does not exist, such as 31.02 */
export function readDate(text) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const at = wall(+m[3], +m[2] - 1, +m[1]);
  return parts(at).day === +m[1] && parts(at).month === +m[2] - 1 ? at : null;
}

export function readTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * HOUR + +m[2] * MINUTE : null;
}

/* one step of a group of digits, days roll over into the next month and hours wrap within the day */
export function stepField(text, part, delta) {
  if (part === 'hour' || part === 'minute') {
    const value = readTime(text);
    if (value === null) return null;
    return timeText((value + (part === 'hour' ? HOUR : MINUTE) * delta + DAY) % DAY);
  }
  const at = readDate(text);
  if (at === null) return null;
  if (part === 'day') return dateText(at + DAY * delta);
  const p = parts(at), month = part === 'month' ? p.month + delta : p.month, year = part === 'year' ? p.year + delta : p.year;
  // the 31st stepped into a shorter month lands on its last day
  const last = parts(wall(year, month + 1, 0)).day;
  return dateText(wall(year, month, Math.min(p.day, last)));
}

const ONE_STAMP = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?:\s+(\d{1,2}):(\d{2}))?$/;

/* A typed moment, a left out year means the latest one not in the future
   With end set the result is the exclusive end, the next day for a date without a time and the next minute otherwise */
function stampOf(text, now, end) {
  const m = ONE_STAMP.exec(text.trim());
  if (!m) return null;
  const day = +m[1], month = +m[2] - 1, hour = m[4] === undefined ? 0 : +m[4], minute = m[5] === undefined ? 0 : +m[5];
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  let year = m[3] ? +m[3] : parts(now).year;
  let at = wall(year, month, day, hour, minute);
  if (parts(at).day !== day) return null;
  if (!m[3] && at > now) {
    year -= 1;
    at = wall(year, month, day, hour, minute);
  }
  if (!end) return at;
  return m[4] === undefined ? at + DAY : at + MINUTE;
}

/* the same day some months back, or the last day of a shorter month */
function monthsBack(seconds, months) {
  const p = parts(seconds), last = parts(wall(p.year, p.month - months + 1, 0)).day;
  return wall(p.year, p.month - months, Math.min(p.day, last), p.hour, p.minute);
}

/* Reads a length back from now, such as -1 h 30 min
   With hours or minutes the range is exact and ends with this minute, otherwise it is whole days up to the end of today
   units is {minute, hour, day, week, month, year}, each a list of accepted names */
function backFromNow(typed, now, units) {
  const text = typed.replace(/^-\s*/, ''), tokens = [...text.matchAll(/(\d+)\s*(\p{L}+)\s*/gu)];
  if (!tokens.length || tokens.map(token => token[0]).join('') !== text) return null;
  const count = {minute: 0, hour: 0, day: 0, week: 0, month: 0, year: 0};
  for (const [, amount, name] of tokens) {
    const kind = Object.keys(count).find(unit => units[unit].includes(name));
    if (!kind || !+amount) return null;
    count[kind] += +amount;
  }
  const days = count.day + count.week * 7, months = count.month + count.year * 12;
  if (count.minute || count.hour) {
    const minute = now - (now % MINUTE);
    return {from: monthsBack(minute, months) - days * DAY - count.hour * HOUR - count.minute * MINUTE, to: minute + MINUTE};
  }
  const dayStart = now - (now % DAY);
  return {from: monthsBack(dayStart, months) - days * DAY + DAY, to: dayStart + DAY};
}

/* Reads a date, a range of dates with optional times, a length back from now, the words for today and yesterday, or a month name
   Returns {from, to}, or null when the text is not understood
   words is {today, yesterday, months, units} */
export function parseRange(text, now, words) {
  const typed = text.trim().toLowerCase();
  if (!typed) return null;
  const dayStart = now - (now % DAY);
  if (typed === words.today) return {from: dayStart, to: dayStart + DAY};
  if (typed === words.yesterday) return {from: dayStart - DAY, to: dayStart};
  const back = backFromNow(typed, now, words.units);
  if (back) return back;
  const named = /^(\p{L}+)(?:\s+(\d{4}))?$/u.exec(typed);
  if (named) {
    const month = words.months.findIndex(name => name.startsWith(named[1]) && named[1].length >= 3);
    if (month < 0) return null;
    let year = named[2] ? +named[2] : parts(now).year;
    if (!named[2] && wall(year, month, 1) > now) year -= 1;
    return {from: wall(year, month, 1), to: wall(year, month + 1, 1)};
  }
  const sides = typed.split(/\s*[–—]\s*|\s+-\s+|\s*\.\.\s*/);
  if (sides.length > 2) return null;
  const from = stampOf(sides[0], now, false), to = stampOf(sides[sides.length - 1], now, true);
  if (from === null || to === null || to <= from) return null;
  return {from, to};
}

/* Sums the buckets {t, values: {name: count}} that touch [from, to), each counted whole
   exact is false when a bucket stuck out of the range */
export function sumRange(buckets, seconds, from, to) {
  const totals = {};
  let exact = true;
  for (const {t, values} of buckets) {
    if (t + seconds <= from || t >= to) continue;
    if (t < from || t + seconds > to) exact = false;
    for (const name of Object.keys(values)) totals[name] = (totals[name] || 0) + values[name];
  }
  return {totals, exact};
}

/* sums [from, to) from the days it covers whole and, where hoursOf(day) knows them, the hours of the days it covers in part */
export function sumPeriod(dayBuckets, hoursOf, from, to) {
  const firstDay = from - (from % DAY), lastDay = (to - 1) - ((to - 1) % DAY), sums = [];
  const inDay = (day, low, high) => {
    const hours = low === day && high === day + DAY ? null : hoursOf(day);
    sums.push(hours ? sumRange(hours, HOUR, low, high) : sumRange(dayBuckets, DAY, low, high));
  };
  inDay(firstDay, from, Math.min(to, firstDay + DAY));
  if (lastDay > firstDay) {
    if (lastDay > firstDay + DAY) sums.push(sumRange(dayBuckets, DAY, firstDay + DAY, lastDay));
    inDay(lastDay, lastDay, to);
  }
  const totals = {};
  for (const sum of sums) for (const name of Object.keys(sum.totals)) totals[name] = (totals[name] || 0) + sum.totals[name];
  return {totals, exact: sums.every(sum => sum.exact)};
}

/* the weeks of a month starting on Monday, a day is its start in seconds and null is an empty cell */
export function weeksOf(year, month) {
  const first = wall(year, month, 1), days = parts(wall(year, month + 1, 0)).day, lead = (new Date(first * 1000).getUTCDay() + 6) % 7;
  const places = [...Array(lead).fill(null), ...Array.from({length: days}, (_, i) => first + i * DAY)];
  const weeks = [];
  for (let i = 0; i < places.length; i += 7) weeks.push(places.slice(i, i + 7));
  return weeks;
}

export class PeriodPicker {
  /** @param {HTMLElement} host @param {any} options {load(), loadHours(day), failed(error), bar, marks: [{name, color}], pick({from, to}), rangeText(from, to), lengthText(from, to), summary(totals, exact), presets: [{label, run}] or a function returning them, now(), dates, placeholder, wholeText, notUnderstood, endBeforeStart, words: {from, to, calendar, parts, weekdays, monthsShort, months, today, yesterday, units}} */
  constructor(host, options) {
    this.host = host;
    this.options = options;
    this.buckets = new Map();
    this.most = 1;
    this.window = {from: 0, to: DAY};
    // the period last exchanged with the site, this.window can be ahead of it while the calendar is open
    /** @type {{from: number, to: number} | null} */
    this.applied = null;
    this.left = {year: 2000, month: 0};
    /** @type {number | null} */
    this.pending = null;
    /** @type {number | null} */
    this.dragFrom = null;
    this.closing = false;
    /** @type {number | null} */
    this.hovered = null;
    /** @type {number | null} */
    this.hoveredHour = null;
    /** @type {string | null} */
    this.typing = null;
    /** @type {any} */
    this.pull = null;
    const {words} = options;
    const part = name => `<input data-part="${name}" class="rostrum-period-w${WIDTH_OF[name]}" maxlength="${WIDTH_OF[name]}" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="${words.parts[name]}">`;
    const end = (side, label) => `<span class="rostrum-period-end" data-side="${side}"><span class="rostrum-period-label">${label}</span><span class="rostrum-period-stamp">${part('day')}<i>.</i>${part('month')}<i>.</i>${part('year')}<b></b>${part('hour')}<i>:</i>${part('minute')}</span></span>`;
    host.classList.add('rostrum-period');
    host.classList.toggle('rostrum-period-dates', !!options.dates);
    host.innerHTML = `<span class="rostrum-period-fields">${end('from', words.from)}<button type="button" class="rostrum-period-line" aria-expanded="false" aria-label="${words.calendar}"><canvas></canvas><span class="rostrum-period-length"></span></button>${end('to', words.to)}<span class="rostrum-period-said"></span></span>` +
      `<div class="rostrum-period-panel" data-rostrum-popup data-rostrum-hands-off data-rostrum-sharp=".rostrum-period-fields" hidden><div class="rostrum-period-presets"><div class="rostrum-period-ready"></div><input class="rostrum-period-typed" autocomplete="off" spellcheck="false" placeholder="${options.placeholder}"></div>` +
      `<div class="rostrum-period-body"><div class="rostrum-period-years"></div><div class="rostrum-period-months"></div>${options.dates ? '' : '<div class="rostrum-period-clock"></div>'}<div class="rostrum-period-readout"></div></div></div>`;
    /** @type {any} */
    const $ = selector => host.querySelector(selector);
    /** @type {HTMLElement} */
    this.panel = $('.rostrum-period-panel');
    /** @type {HTMLElement} */
    this.years = $('.rostrum-period-years');
    /** @type {HTMLElement} */
    this.months = $('.rostrum-period-months');
    /** @type {HTMLElement} */
    this.readoutEl = $('.rostrum-period-readout');
    /** @type {HTMLElement} */
    this.said = $('.rostrum-period-said');
    /** @type {HTMLElement} */
    this.ready = $('.rostrum-period-ready');
    /** @type {HTMLButtonElement} */
    this.line = $('.rostrum-period-line');
    /** @type {HTMLCanvasElement} */
    this.lineCanvas = $('.rostrum-period-line canvas');
    /** @type {HTMLElement} */
    this.lengthEl = $('.rostrum-period-length');
    /** @type {HTMLInputElement} */
    this.typedField = $('.rostrum-period-typed');
    /** @type {any[]} */
    this.inputs = [...host.querySelectorAll('.rostrum-period-stamp input')];
    this.stepsTimer = 0;
    this.abort = new AbortController();
    this.clock = options.dates ? null : new PeriodClock($('.rostrum-period-clock'), {
      bar: options.bar, marks: options.marks, loadHours: options.loadHours, failed: options.failed, fromLabel: words.from, toLabel: words.to,
      dayText: day => `${parts(day).day} ${words.monthsShort[parts(day).month]}`,
      seasonOf: day => SEASONS[parts(day).month],
      change: (window, final) => this.takeHours(window, final),
      hover: hour => {
        this.hoveredHour = hour;
        this.paint();
      },
      loaded: () => this.paint(),
    });
    this.listen();
    // a picker created in a hidden tab has no size to draw on until the tab is shown
    this.lineWatch = new ResizeObserver(() => this.drawLine());
    this.lineWatch.observe(this.lineCanvas);
  }

  stop() {
    this.abort.abort();
    clearTimeout(this.stepsTimer);
    this.lineWatch.disconnect();
    if (this.clock) this.clock.stop();
    this.host.classList.remove('rostrum-period');
    this.host.replaceChildren();
  }

  async refresh() {
    const answer = await this.options.load();
    if (this.clock) this.clock.forget();
    this.buckets = new Map(answer.buckets.map(b => [b.t, b]));
    this.most = Math.max(1, ...answer.buckets.map(b => b.values[this.options.bar] || 0));
    if (answer.buckets.length) this.history = {from: answer.buckets[0].t, to: answer.buckets[answer.buckets.length - 1].t + DAY};
    this.drawLine();
    if (!this.panel.hidden) this.render();
  }

  /* The site sets the period here, a null from means the whole history
     It is ignored while a ruler is held or the open panel has changes not sent yet */
  show(from, to) {
    if ((this.clock && this.clock.held) || (!this.panel.hidden && this.ahead())) return;
    this.empty = from === null;
    this.window = this.empty ? {from: 0, to: 0} : {from, to};
    this.applied = this.empty ? null : {from, to};
    this.writeFields();
    if (!this.panel.hidden) this.render();
  }

  partOf(side, name) {
    return this.inputs.find(el => el.dataset.part === name && el.closest('.rostrum-period-end').dataset.side === side);
  }

  sideOf(el) {
    return el.closest('.rostrum-period-end').dataset.side;
  }

  writeSide(side, seconds) {
    const [day, month, year] = dateText(seconds).split('.'), [hour, minute] = timeText(seconds).split(':');
    for (const [name, value] of Object.entries({day, month, year, hour, minute})) this.partOf(side, name).value = value;
  }

  /* the side being typed in keeps its text and its error marks unless force is set */
  writeFields(force = false) {
    const {window: w} = this, kept = force ? null : this.typing;
    if (this.empty) {
      for (const el of this.inputs) if (this.sideOf(el) !== kept) el.value = '';
    } else {
      if (kept !== 'from') this.writeSide('from', w.from);
      if (kept !== 'to') this.writeSide('to', w.to - MINUTE);
    }
    for (const el of this.inputs) if (this.sideOf(el) !== kept) el.classList.remove('rostrum-period-bad');
    if (!kept) this.said.textContent = '';
    this.drawLine();
  }

  /* draws the line between the two ends with the length of the period and its activity day by day */
  drawLine() {
    const {lineCanvas: canvas, options, empty} = this, style = getComputedStyle(this.host), ink = style.getPropertyValue('--rostrum-glow').trim();
    // without dates the line shows the whole known history
    const w = empty && this.history ? this.history : this.window;
    this.lengthEl.textContent = empty ? options.wholeText : options.lengthText(w.from, w.to);
    const sharp = sharpCanvas(canvas);
    if (!sharp) return;
    const {c, width, height} = sharp, base = height - 1.5, top = 4, firstDay = w.from - (w.from % DAY), days = Math.max(1, Math.ceil((w.to - firstDay) / DAY));
    const seen = [];
    for (let i = 0; i < days; i++) seen.push(this.buckets.get(firstDay + i * DAY));
    const most = Math.max(1, ...seen.map(b => (b ? b.values[options.bar] || 0 : 0))), step = width / days, wide = Math.max(1, step - (step > 3 ? 1 : 0));
    c.fillStyle = ink;
    seen.forEach((b, i) => {
      const count = b ? b.values[options.bar] || 0 : 0;
      if (!count) return;
      const h = Math.max(1.5, Math.sqrt(count / most) * (base - top));
      c.globalAlpha = LINE_ALPHA;
      c.fillRect(i * step, base - h, wide, h);
    });
    options.marks.forEach((mark, row) => {
      c.fillStyle = mark.color;
      c.globalAlpha = 1;
      seen.forEach((b, i) => {
        if (b && b.values[mark.name]) c.fillRect(i * step, row * 3, Math.max(1.5, wide), 2);
      });
    });
    // the base line, its ends stand under the two readouts
    c.globalAlpha = 1;
    c.fillStyle = ink;
    c.shadowColor = ink;
    c.shadowBlur = 6;
    c.fillRect(0, base, width, 1);
    c.fillRect(0, base - 5, 1, 5);
    c.fillRect(width - 1, base - 5, 1, 5);
    c.shadowBlur = 0;
  }

  readSide(side) {
    const text = names => names.map(name => this.partOf(side, name).value.trim());
    const [day, month, year] = text(['day', 'month', 'year']), [hour, minute] = text(['hour', 'minute']);
    return {date: readDate(`${day}.${month}.${year}`), time: readTime(`${hour}:${minute}`)};
  }

  commit() {
    clearTimeout(this.stepsTimer);
    const {options} = this, from = this.readSide('from'), to = this.readSide('to');
    const mark = (side, names, bad) => names.forEach(name => this.partOf(side, name).classList.toggle('rostrum-period-bad', bad));
    mark('from', ['day', 'month', 'year'], from.date === null);
    mark('from', ['hour', 'minute'], from.time === null);
    mark('to', ['day', 'month', 'year'], to.date === null);
    mark('to', ['hour', 'minute'], to.time === null);
    if (from.date === null || from.time === null || to.date === null || to.time === null) {
      this.said.textContent = options.notUnderstood;
      return;
    }
    const start = from.date + (options.dates ? 0 : from.time), stop = to.date + (options.dates ? DAY - MINUTE : to.time) + MINUTE;
    if (stop <= start) {
      mark('to', ['day', 'month', 'year'], true);
      this.said.textContent = options.endBeforeStart;
      return;
    }
    this.said.textContent = '';
    this.typing = null;
    if (this.empty || start !== this.window.from || stop !== this.window.to) this.choose(start, stop, false);
  }

  choose(from, to, close = true) {
    clearTimeout(this.stepsTimer);
    this.empty = false;
    this.window = {from, to};
    this.pending = null;
    this.typing = null;
    this.writeFields(true);
    if (close) this.hide();
    if (!this.panel.hidden) this.render();
    else if (this.ahead()) this.tell();
  }

  /* true when the window differs from what the site was last told */
  ahead() {
    if (this.empty) return false;
    return !this.applied || this.applied.from !== this.window.from || this.applied.to !== this.window.to;
  }

  tell() {
    const {from, to} = this.window;
    this.applied = {from, to};
    this.options.pick({from, to});
  }

  takeBack() {
    clearTimeout(this.stepsTimer);
    if (this.clock) this.clock.cancelHold();
    this.typing = null;
    this.empty = !this.applied;
    this.window = this.applied ? {...this.applied} : {from: 0, to: 0};
    this.writeFields(true);
  }

  /* called by the hour rulers, the digits follow a moving end and the period is committed when it stops */
  takeHours(window, final) {
    this.pending = null;
    if (final) {
      this.choose(window.from, window.to, false);
      return;
    }
    this.window = window;
    this.writeFields(true);
    this.paint();
  }

  /* steps one group of digits and rewrites the whole date, because a step from the 31st can change the month too */
  step(el, delta) {
    const side = this.sideOf(el), name = el.dataset.part, kind = name === 'hour' || name === 'minute' ? 'time' : 'date';
    const get = part => this.partOf(side, part).value.trim().padStart(WIDTH_OF[part], '0');
    const text = kind === 'time' ? `${get('hour')}:${get('minute')}` : `${get('day')}.${get('month')}.${get('year')}`;
    const stepped = stepField(text, name, delta);
    if (!stepped) return;
    const pieces = stepped.split(/[.:]/), names = kind === 'time' ? ['hour', 'minute'] : ['day', 'month', 'year'];
    names.forEach((part, i) => {
      this.partOf(side, part).value = pieces[i];
    });
    this.typing = side;
    clearTimeout(this.stepsTimer);
    if (!this.pull) this.stepsTimer = setTimeout(() => this.commit(), STEPS_WAIT_MS);
  }

  move(el, by) {
    const next = this.inputs[this.inputs.indexOf(el) + by];
    if (next) next.focus();
  }

  listenPart(el) {
    const {signal} = this.abort, width = +el.maxLength;
    el.addEventListener('focus', () => el.select(), {signal});
    el.addEventListener('click', () => el.select(), {signal});
    // dragging a group of digits up or down steps it like a wheel, the period is committed on release
    el.addEventListener('pointerdown', e => {
      if (e.button === 0) this.pull = {el, id: e.pointerId, y: e.clientY, moving: false};
    }, {signal});
    el.addEventListener('pointermove', e => {
      const {pull} = this;
      if (!pull || pull.el !== el) return;
      const away = pull.y - e.clientY;
      if (!pull.moving) {
        if (Math.abs(away) < PULL_START_PX) return;
        pull.moving = true;
        pull.y = e.clientY;
        el.setPointerCapture(pull.id);
        return;
      }
      e.preventDefault();
      const steps = Math.trunc(away / PULL_STEP_PX);
      if (!steps) return;
      pull.y -= steps * PULL_STEP_PX;
      this.step(el, steps);
      el.select();
    }, {signal});
    const letGo = () => {
      const {pull} = this;
      if (!pull || pull.el !== el) return;
      this.pull = null;
      if (pull.moving && this.typing) this.commit();
      if (pull.moving) el.select();
    };
    el.addEventListener('pointerup', letGo, {signal});
    el.addEventListener('pointercancel', letGo, {signal});
    el.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '');
      this.typing = this.sideOf(el);
      clearTimeout(this.stepsTimer);
      if (el.value.length === width) this.move(el, 1);
    }, {signal});
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.step(el, e.key === 'ArrowUp' ? 1 : -1);
      } else if (e.key === 'ArrowLeft' && el.selectionStart === 0) {
        e.preventDefault();
        this.move(el, -1);
      } else if (e.key === 'ArrowRight' && el.selectionEnd === el.value.length) {
        e.preventDefault();
        this.move(el, 1);
      } else if (e.key === 'Backspace' && !el.value) {
        e.preventDefault();
        this.move(el, -1);
      }
    }, {signal});
    el.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      this.wheelTurn = (this.wheelTurn || 0) + e.deltaY;
      if (Math.abs(this.wheelTurn) < WHEEL_NOTCH) return;
      this.step(el, this.wheelTurn < 0 ? 1 : -1);
      this.wheelTurn = 0;
    }, {passive: false, signal});
    el.addEventListener('blur', () => {
      if (el.value && el.value.length < width) el.value = el.value.padStart(width, '0');
    }, {signal});
    // a whole range can be pasted into any group
    el.addEventListener('paste', e => {
      const range = parseRange(e.clipboardData.getData('text'), this.options.now(), this.options.words);
      if (!range) return;
      e.preventDefault();
      this.choose(range.from, range.to);
    }, {signal});
  }

  hide() {
    this.panel.hidden = true;
    this.line.setAttribute('aria-expanded', 'false');
    this.pending = null;
    this.dragFrom = null;
    this.hovered = null;
    this.hoveredHour = null;
  }

  toggle(open) {
    if (this.panel.hidden === !open) return;
    if (!open) {
      if (this.typing) this.commit();
      this.hide();
      if (this.ahead()) this.tell();
      return;
    }
    this.panel.hidden = false;
    this.line.setAttribute('aria-expanded', 'true');
    this.presets = typeof this.options.presets === 'function' ? this.options.presets() : this.options.presets;
    this.ready.innerHTML = this.presets.map((p, i) => `<button type="button" data-preset="${i}">${p.label}</button>`).join('');
    // the calendar shows two months with the end of the period in the right one
    const end = parts(this.empty ? (this.history ? this.history.to - DAY : this.options.now()) : this.window.to - MINUTE);
    this.left = {year: end.year, month: end.month};
    this.shift(-1);
    this.keepInFrame();
  }

  /* a calendar near the edge of the frame opens to where there is room */
  keepInFrame() {
    const {panel} = this;
    panel.style.left = '';
    panel.style.top = '';
    panel.style.bottom = '';
    const r = panel.getBoundingClientRect(), k = r.width / panel.offsetWidth || 1;
    if (r.right > innerWidth - 8) panel.style.left = `${(innerWidth - 8 - r.right) / k}px`;
    if (r.bottom > innerHeight - 64 && r.top - r.height > 64) {
      panel.style.top = 'auto';
      panel.style.bottom = 'calc(100% + 8px)';
    }
  }

  shift(months) {
    const at = parts(wall(this.left.year, this.left.month + months, 1));
    this.left = {year: at.year, month: at.month};
    this.render();
  }

  render() {
    const {left, options} = this, {words} = options, today = options.now() - (options.now() % DAY);
    const {year} = left, sums = Array(12).fill(0);
    for (const b of this.buckets.values()) {
      const p = parts(b.t);
      if (p.year === year) sums[p.month] += b.values[options.bar] || 0;
    }
    const most = Math.max(1, ...sums), right = parts(wall(left.year, left.month + 1, 1));
    this.years.innerHTML = `<button type="button" data-year="-1" aria-label="${year - 1}">‹</button><b>${year}</b><button type="button" data-year="1" aria-label="${year + 1}">›</button>` +
      words.monthsShort.map((name, m) => {
        const here = left.month === m || (right.year === year && right.month === m);
        return `<button type="button" data-jump="${m}" data-season="${SEASONS[m]}" class="${here ? 'rostrum-period-here' : ''}${sums[m] ? '' : ' rostrum-period-empty'}" style="--v:${(sums[m] / most).toFixed(2)}">${name}</button>`;
      }).join('');
    const month = (y, m) => {
      const at = parts(wall(y, m, 1));
      const weeks = weeksOf(at.year, at.month);
      // every month takes the height of six weeks so what lies under the days does not jump
      const spare = '<tr class="rostrum-period-spare"><td></td></tr>'.repeat(MOST_WEEKS - weeks.length);
      const cells = weeks.map(week => `<tr>${week.map(day => {
        if (day === null) return '<td></td>';
        const b = this.buckets.get(day), v = b ? (b.values[options.bar] || 0) / this.most : 0;
        const marks = options.marks.filter(mark => b && b.values[mark.name]).map(mark => `<i style="background:${mark.color}"></i>`).join('');
        return `<td><button type="button" class="rostrum-day${b ? '' : ' rostrum-day-none'}${day === today ? ' rostrum-day-today' : ''}" data-day="${day}" style="--v:${Math.sqrt(v).toFixed(2)}"${day > today ? ' disabled' : ''}>${parts(day).day}<span>${marks}</span></button></td>`;
      }).join('')}</tr>`).join('');
      return `<div class="rostrum-period-month"><button type="button" class="rostrum-period-title" data-month="${wall(at.year, at.month, 1)}"><span data-season="${SEASONS[at.month]}">${words.months[at.month]}</span> ${at.year}</button><table><tr>${words.weekdays.map(d => `<th>${d}</th>`).join('')}</tr>${cells}${spare}</table></div>`;
    };
    this.months.innerHTML = month(left.year, left.month) + month(left.year, left.month + 1);
    if (this.clock) {
      this.clock.host.classList.toggle('rostrum-period-whole', !!this.empty);
      if (!this.empty) this.clock.show(this.window);
    }
    this.paint();
  }

  /* marks the range on the days, the chosen one or the one being picked, and updates the readout */
  paint() {
    const {pending, hovered, window: w, options} = this;
    let from = w.from, to = w.to;
    if (pending !== null) {
      const other = hovered === null ? pending : hovered;
      from = Math.min(pending, other);
      to = Math.max(pending, other) + DAY;
    }
    /** @type {any} */
    const cells = this.months.querySelectorAll('[data-day]');
    for (const cell of cells) {
      const day = +cell.dataset.day;
      cell.classList.toggle('rostrum-day-in', day + DAY > from && day < to);
      cell.classList.toggle('rostrum-day-edge', (day <= from && day + DAY > from) || (day < to && day + DAY >= to));
    }
    const buckets = [...this.buckets.values()], {clock, hoveredHour} = this;
    const say = (a, b, {totals, exact}) => {
      this.readoutEl.textContent = [options.rangeText(a, b), options.summary(totals, exact)].filter(Boolean).join(' · ');
    };
    if (hoveredHour !== null && clock) {
      const bucket = clock.bucketAt(hoveredHour);
      say(hoveredHour, hoveredHour + HOUR, {totals: bucket ? bucket.values : {}, exact: true});
    } else if (this.empty && pending === null && hovered === null) {
      this.readoutEl.textContent = options.wholeText;
    } else if (hovered !== null && pending === null) {
      say(hovered, hovered + DAY, sumRange(buckets, DAY, hovered, hovered + DAY));
    } else {
      say(from, to, sumPeriod(buckets, day => (clock ? clock.hoursOf(day) : null), from, to));
    }
  }

  dayAt(target) {
    const cell = target.closest && target.closest('[data-day]');
    return cell && !cell.disabled ? +cell.dataset.day : null;
  }

  /* the panel stays open when there are hour rulers to set next */
  takeRange(a, b) {
    this.choose(Math.min(a, b), Math.max(a, b) + DAY, !this.clock);
  }

  /* A press on a free spot of the calendar cancels a first picked date
     Gaps in the row of years and months do not count as free */
  dropPending(target) {
    if (this.pending === null || target.closest('button,input,.rostrum-period-years,.rostrum-period-clock')) return;
    this.pending = null;
    this.dragFrom = null;
    this.hovered = null;
    this.paint();
  }

  listen() {
    const {panel, months, years} = this, {signal} = this.abort;
    for (const el of this.inputs) this.listenPart(el);
    // leaving the digits commits what was typed
    this.host.addEventListener('focusout', e => {
      /** @type {any} */
      const next = e.relatedTarget, inDigits = next && next.closest && next.closest('.rostrum-period-stamp');
      if (this.typing && !inDigits) this.commit();
    }, {signal});
    this.line.addEventListener('click', () => this.toggle(this.panel.hidden), {signal});
    this.typedField.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const range = parseRange(this.typedField.value, this.options.now(), this.options.words);
      this.typedField.classList.toggle('rostrum-period-bad', !range);
      if (!range) return;
      this.typedField.value = '';
      this.choose(range.from, range.to);
    }, {signal});
    panel.addEventListener('click', e => {
      /** @type {any} */
      const t = e.target, preset = t.closest('[data-preset]'), month = t.closest('[data-month]');
      if (preset) {
        this.takeBack();
        this.hide();
        this.presets[+preset.dataset.preset].run();
      } else if (month) {
        const at = parts(+month.dataset.month);
        this.choose(+month.dataset.month, wall(at.year, at.month + 1, 1), !this.clock);
      }
    }, {signal});
    panel.addEventListener('pointerdown', e => {
      if (e.button === 0) this.dropPending(e.target);
    }, {signal});
    years.addEventListener('click', e => {
      /** @type {any} */
      const t = e.target, step = t.closest('[data-year]'), jump = t.closest('[data-jump]');
      if (step) this.shift(+step.dataset.year * 12);
      else if (jump) {
        this.left = {year: this.left.year, month: +jump.dataset.jump};
        this.render();
      }
    }, {signal});
    months.addEventListener('pointerdown', e => {
      const day = this.dayAt(e.target);
      if (day === null || e.button !== 0) return;
      e.preventDefault();
      if (this.pending !== null) this.closing = true;
      else {
        this.pending = day;
        this.dragFrom = day;
        this.hovered = day;
      }
      this.paint();
    }, {signal});
    months.addEventListener('pointerover', e => {
      const day = this.dayAt(e.target);
      if (day === this.hovered) return;
      this.hovered = day;
      this.paint();
    }, {signal});
    months.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.paint();
    }, {signal});
    months.addEventListener('pointerup', e => {
      const day = this.dayAt(e.target), {pending, dragFrom, closing} = this;
      this.dragFrom = null;
      this.closing = false;
      if (day === null || pending === null) return;
      // a second press or a drag away from the first day ends the range
      if (closing || (dragFrom !== null && day !== dragFrom)) this.takeRange(pending, day);
    }, {signal});
    // keyboard access to the days, arrows move and Enter or Space acts like a press
    months.addEventListener('keydown', e => {
      const day = this.dayAt(e.target), step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[e.key];
      if (day === null) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.pending === null) {
          this.pending = day;
          this.hovered = day;
          this.paint();
        } else this.takeRange(this.pending, day);
      } else if (step) {
        e.preventDefault();
        const next = day + step * DAY, selector = `[data-day="${next}"]`;
        if (!this.months.querySelector(selector)) this.shift(step > 0 ? 1 : -1);
        /** @type {any} */
        const cell = this.months.querySelector(selector);
        if (cell) cell.focus();
        this.hovered = next;
        this.paint();
      }
    }, {signal});
    panel.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      this.wheelSum = (this.wheelSum || 0) + e.deltaY;
      if (Math.abs(this.wheelSum) >= 120) {
        this.shift(Math.sign(this.wheelSum));
        this.wheelSum = 0;
      }
    }, {passive: false, signal});
    window.addEventListener('pointerdown', e => {
      /** @type {any} */
      const t = e.target;
      if (!panel.hidden && !this.host.contains(t)) this.toggle(false);
    }, {capture: true, signal});
    // a drag that left the digits or the days is released out here
    window.addEventListener('pointerup', () => {
      this.pull = null;
      this.dragFrom = null;
      this.closing = false;
    }, {signal});
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || panel.hidden) return;
      if (this.pending !== null) {
        this.pending = null;
        this.paint();
      } else {
        this.takeBack();
        this.hide();
      }
    }, {signal});
  }
}
