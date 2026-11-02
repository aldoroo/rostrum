/* Wraps a site's input that takes one exact value
   It cleans input, takes a whole value on its own, suggests known values and shows short facts beside the field
   A value longer than a whole one is marked and not taken */

export class Lookup {
  /** @param {HTMLInputElement} input @param {any} options {length: whole value, clean(text), suggest(text): [{value, note, mark}], choose(value), facts(value): text, action: {label, run(value)}, labels: {clear, over(length)}} */
  constructor(input, options) {
    this.input = input;
    this.options = options;
    /** @type {any[]} */
    this.rows = [];
    this.at = -1;
    this.taken = input.value.trim();
    /** @type {any} */
    const host = document.createElement('span');
    this.host = host;
    host.className = 'rostrum-lookup';
    input.before(host);
    host.innerHTML = `<span class="rostrum-lookup-field"><span class="rostrum-lookup-slot"></span><button type="button" class="rostrum-lookup-clear" aria-label="${options.labels.clear}" hidden>×</button><span class="rostrum-lookup-facts"></span><button type="button" class="rostrum-lookup-action" hidden>${options.action.label}</button></span>` +
      '<div class="rostrum-lookup-panel" data-rostrum-popup data-rostrum-hands-off data-rostrum-sharp=".rostrum-lookup-field" hidden></div>';
    /** @type {any} */
    const $ = selector => host.querySelector(selector);
    $('.rostrum-lookup-slot').append(input);
    /** @type {any} */
    this.panel = $('.rostrum-lookup-panel');
    /** @type {any} */
    this.clearButton = $('.rostrum-lookup-clear');
    /** @type {any} */
    this.factsEl = $('.rostrum-lookup-facts');
    /** @type {any} */
    this.actionButton = $('.rostrum-lookup-action');
    this.abort = new AbortController();
    this.listen();
    this.sync();
  }

  stop() {
    this.abort.abort();
    this.host.replaceWith(this.input);
  }

  sync() {
    const value = this.input.value.trim(), taken = value === this.taken, over = value.length > this.options.length;
    this.host.classList.toggle('rostrum-lookup-over', over);
    this.clearButton.hidden = !value;
    this.factsEl.textContent = over ? this.options.labels.over(value.length) : value && taken ? this.options.facts(value) : '';
    this.actionButton.hidden = !(value && taken);
  }

  /* a value set by the site is taken as it is */
  show(value) {
    this.input.value = value;
    this.taken = value;
    this.sync();
  }

  take(value) {
    this.input.value = value;
    this.taken = value;
    this.close();
    this.sync();
    this.options.choose(value);
  }

  close() {
    this.panel.hidden = true;
    this.rows = [];
    this.at = -1;
  }

  draw() {
    this.rows = this.options.suggest(this.input.value.trim());
    this.at = -1;
    this.panel.replaceChildren(...this.rows.map((row, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.i = String(i);
      const value = document.createElement('span');
      value.textContent = row.value;
      const note = document.createElement('b');
      note.textContent = row.note || '';
      if (row.mark) note.style.color = row.mark;
      button.append(value, note);
      return button;
    }));
    this.panel.hidden = !this.rows.length;
  }

  mark(at) {
    this.at = at;
    [...this.panel.children].forEach((row, i) => row.classList.toggle('rostrum-lookup-at', i === at));
  }

  listen() {
    const {signal} = this.abort, {input, options} = this;
    input.addEventListener('focus', () => {
      input.select();
      this.draw();
    }, {signal});
    input.addEventListener('click', () => input.select(), {signal});
    input.addEventListener('input', () => {
      const cleaned = options.clean(input.value);
      if (cleaned !== input.value) input.value = cleaned;
      this.sync();
      if (cleaned.length === options.length) this.take(cleaned);
      else if (!cleaned && this.taken) this.take('');
      else this.draw();
    }, {signal});
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.rows.length) return;
        this.mark(e.key === 'ArrowDown' ? (this.at + 1) % this.rows.length : (this.at <= 0 ? this.rows.length : this.at) - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const value = this.at >= 0 ? this.rows[this.at].value : input.value.trim();
        if (value.length <= options.length) this.take(value);
      } else if (e.key === 'Escape') {
        this.close();
        input.blur();
      }
    }, {signal});
    // the site still works with the taken value, so half a value does not stay in the field
    input.addEventListener('blur', () => {
      if (document.activeElement === input || input.value.trim() === this.taken) return;
      input.value = this.taken;
      this.sync();
    }, {signal});
    this.panel.addEventListener('click', e => {
      /** @type {any} */
      const t = e.target, row = t.closest('button');
      if (row) this.take(this.rows[+row.dataset.i].value);
    }, {signal});
    this.clearButton.addEventListener('click', () => {
      this.take('');
      input.focus();
    }, {signal});
    this.actionButton.addEventListener('click', () => options.action.run(input.value.trim()), {signal});
    window.addEventListener('pointerdown', e => {
      /** @type {any} */
      const t = e.target;
      if (!this.panel.hidden && !this.host.contains(t)) this.close();
    }, {capture: true, signal});
  }
}
