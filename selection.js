/* A row selection written as a text query and saved under a name
   Words come from the site's vocabulary, anything unknown makes the whole query unknown
   SelectionLine shows the active words, a query field and the saved selections */

const WIPE_MS = 320;

/* @param vocabulary {filters: [{id, word, without, names: [...]}], negatives: [...], fillers: [...], tags: [names], units: {minute: [names], ...}, subject: regex of a single thing the query is about}
   @returns {filters: {id: 'include' | 'exclude'}, tags: [...], tagsExclude, subject, period: '-7 d' or ''} or {unknown: [...]} */
export function readQuery(text, vocabulary) {
  const tokens = String(text || '').toLowerCase().split(/[\s,;+]+/).filter(Boolean);
  const names = new Map();
  for (const filter of vocabulary.filters) for (const name of filter.names) names.set(name, filter.id);
  const tags = new Map((vocabulary.tags || []).map(tag => [String(tag).toLowerCase(), String(tag)]));
  const units = new Set(Object.values(vocabulary.units || {}).flat());
  const read = {filters: {}, tags: [], tagsExclude: false, subject: null, period: ''}, unknown = [], period = [];
  let negative = false;
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    const length = /^-?(\d+)(\p{L}*)$/u.exec(token), unit = length && (length[2] || tokens[i + 1]);
    if (length && +length[1] && units.has(unit)) {
      period.push(`${length[1]} ${unit}`);
      if (!length[2]) i += 1;
      continue;
    }
    if (token.length > 1 && token.startsWith('-')) {
      negative = true;
      token = token.slice(1);
    }
    if (vocabulary.negatives.includes(token)) {
      negative = true;
      continue;
    }
    if (vocabulary.fillers.includes(token)) continue;
    const pair = i + 1 < tokens.length ? `${token} ${tokens[i + 1]}` : '';
    const id = names.get(pair) || names.get(token);
    if (id) {
      if (names.get(pair)) i += 1;
      const state = negative ? 'exclude' : 'include';
      if (read.filters[id] && read.filters[id] !== state) unknown.push(token);
      read.filters[id] = state;
    } else if (tags.has(token)) {
      if (read.tags.length && read.tagsExclude !== negative) unknown.push(token);
      read.tagsExclude = negative;
      read.tags.push(tags.get(token));
    } else if (vocabulary.subject && vocabulary.subject.test(token) && !negative) read.subject = token;
    else unknown.push(token);
    negative = false;
  }
  if (negative) unknown.push(tokens[tokens.length - 1]);
  if (period.length) read.period = `-${period.join(' ')}`;
  return unknown.length ? {unknown} : read;
}

/* the text of a selection, back in the words of the site */
export function writeQuery(read, vocabulary) {
  const not = vocabulary.negatives[0], words = [];
  for (const filter of vocabulary.filters) {
    const state = read.filters[filter.id];
    if (state) words.push(state === 'exclude' ? filter.without : filter.word);
  }
  for (const tag of read.tags) words.push(read.tagsExclude ? `${not} ${tag}` : tag);
  if (read.period) words.push(read.period);
  return words.join(' ');
}

export class SelectionLine {
  /** @param {HTMLElement} host @param {any} options {placeholder, labels: {presets, save, name, remove}, words(): [{text, mark, drop()}], items(): [{name, text, count}], active(): name or null, savable(): text or null, say(text): what a query would show or null when it is not understood, add(text) and take(text): whether it worked, save(name, text), remove(name)} */
  constructor(host, options) {
    this.host = host;
    this.options = options;
    this.wiping = false;
    this.wipeTimer = 0;
    host.classList.add('rostrum-selection');
    host.innerHTML = `<div class="rostrum-selection-line"><span class="rostrum-selection-words"></span><input class="rostrum-selection-query" autocomplete="off" spellcheck="false" placeholder="${options.placeholder}"><button type="button" class="rostrum-selection-open" aria-expanded="false"></button></div>` +
      '<div class="rostrum-selection-panel" data-rostrum-popup data-rostrum-hands-off data-rostrum-sharp=".rostrum-selection-line" hidden><div class="rostrum-selection-said"></div><div class="rostrum-selection-list"></div>' +
      `<button type="button" class="rostrum-selection-save">${options.labels.save}</button><input class="rostrum-selection-name" autocomplete="off" spellcheck="false" placeholder="${options.labels.name}" hidden></div>`;
    /** @type {any} */
    const $ = selector => host.querySelector(selector);
    /** @type {any} */
    this.line = $('.rostrum-selection-line');
    /** @type {any} */
    this.wordsEl = $('.rostrum-selection-words');
    /** @type {any} */
    this.opener = $('.rostrum-selection-open');
    /** @type {any} */
    this.panel = $('.rostrum-selection-panel');
    /** @type {any} */
    this.query = $('.rostrum-selection-query');
    /** @type {any} */
    this.said = $('.rostrum-selection-said');
    /** @type {any} */
    this.list = $('.rostrum-selection-list');
    /** @type {any} */
    this.saveButton = $('.rostrum-selection-save');
    /** @type {any} */
    this.nameField = $('.rostrum-selection-name');
    this.current = [];
    this.abort = new AbortController();
    this.listen();
    this.sync();
  }

  stop() {
    this.abort.abort();
    clearTimeout(this.wipeTimer);
    this.host.classList.remove('rostrum-selection');
    this.host.replaceChildren();
  }

  sync() {
    this.opener.textContent = this.options.active() || this.options.labels.presets;
    if (!this.wiping) this.drawWords();
    if (!this.panel.hidden) this.render();
  }

  drawWords() {
    this.current = this.options.words();
    this.wordsEl.replaceChildren(...this.current.map((word, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = word.text;
      button.dataset.i = String(i);
      button.style.setProperty('--i', String(i));
      if (word.mark) button.style.setProperty('--rostrum-facet-mark', word.mark);
      return button;
    }));
    this.query.classList.toggle('rostrum-selection-after', this.current.length > 0);
  }

  /* the words animate out one after another, the selection itself has already changed */
  wipe() {
    if (!this.wordsEl.children.length) return;
    this.wiping = true;
    this.wordsEl.classList.add('rostrum-selection-wiping');
    clearTimeout(this.wipeTimer);
    this.wipeTimer = setTimeout(() => {
      this.wiping = false;
      this.wordsEl.classList.remove('rostrum-selection-wiping');
      this.drawWords();
    }, WIPE_MS);
  }

  render() {
    const {items, savable, labels} = this.options;
    this.list.replaceChildren(...items().map(item => {
      const row = document.createElement('div');
      row.className = 'rostrum-selection-item';
      row.dataset.name = item.name;
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'rostrum-selection-take';
      take.textContent = item.name;
      take.title = item.text;
      const count = document.createElement('b');
      count.textContent = item.count === null ? '' : item.count;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'rostrum-selection-drop';
      drop.textContent = '×';
      drop.setAttribute('aria-label', `${labels.remove}: ${item.name}`);
      row.append(take, count, drop);
      return row;
    }));
    this.saveButton.hidden = !savable() || !this.nameField.hidden;
  }

  say() {
    const said = this.options.say(this.query.value);
    this.query.classList.toggle('rostrum-selection-bad', said === null);
    this.said.textContent = said === null ? '' : said;
  }

  toggle(open) {
    if (this.panel.hidden === !open) return;
    this.panel.hidden = !open;
    this.opener.setAttribute('aria-expanded', String(open));
    this.nameField.hidden = true;
    this.nameField.value = '';
    if (open) this.render();
    else {
      this.query.value = '';
      this.query.classList.remove('rostrum-selection-bad');
      this.said.textContent = '';
    }
  }

  add() {
    const text = this.query.value;
    if (!text.trim()) return;
    if (!this.options.add(text)) {
      this.query.classList.add('rostrum-selection-bad');
      return;
    }
    this.query.value = '';
    this.query.classList.remove('rostrum-selection-bad');
    this.said.textContent = '';
  }

  listen() {
    const {signal} = this.abort;
    this.line.addEventListener('click', e => {
      /** @type {any} */
      const t = e.target, word = t.closest('.rostrum-selection-words button');
      if (word) {
        const said = this.current[+word.dataset.i];
        if (said && !this.wiping) said.drop();
      } else if (t.closest('.rostrum-selection-open')) this.toggle(this.panel.hidden);
      else {
        this.query.focus();
        this.toggle(true);
      }
    }, {signal});
    this.query.addEventListener('focus', () => this.toggle(true), {signal});
    this.query.addEventListener('input', () => {
      this.toggle(true);
      this.say();
    }, {signal});
    this.query.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.add();
      } else if (e.key === 'Backspace' && !this.query.value && this.current.length) {
        e.preventDefault();
        this.current[this.current.length - 1].drop();
      }
    }, {signal});
    this.list.addEventListener('click', e => {
      /** @type {any} */
      const t = e.target, row = t.closest('.rostrum-selection-item');
      if (!row) return;
      if (t.closest('.rostrum-selection-drop')) {
        this.options.remove(row.dataset.name);
        this.sync();
      } else if (t.closest('.rostrum-selection-take') && this.options.take(row.querySelector('.rostrum-selection-take').title)) this.toggle(false);
    }, {signal});
    this.saveButton.addEventListener('click', () => {
      this.nameField.hidden = false;
      this.saveButton.hidden = true;
      this.nameField.focus();
    }, {signal});
    this.nameField.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = this.nameField.value.trim(), text = this.options.savable();
      if (!name || !text) return;
      this.options.save(name, text);
      this.nameField.value = '';
      this.nameField.hidden = true;
      this.sync();
    }, {signal});
    window.addEventListener('pointerdown', e => {
      /** @type {any} */
      const t = e.target;
      if (!this.panel.hidden && !this.host.contains(t)) this.toggle(false);
    }, {capture: true, signal});
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.panel.hidden) {
        this.toggle(false);
        this.query.blur();
      }
    }, {signal});
  }
}
