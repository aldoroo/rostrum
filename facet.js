/* A filter shown as a word with a count, pressing the word toggles it and a small word above flips it to the opposite
   The site supplies the words, the counts and what a change does */

export class Facet {
  /** @param {HTMLElement} host @param {any} options {label: text or an element that acts by itself, mark: a colour, not: word of the opposite, format(n), change(state)} */
  constructor(host, options) {
    this.host = host;
    this.options = options;
    /** @type {'off' | 'include' | 'exclude'} */
    this.state = 'off';
    /** @type {{with: number, without: number} | null} */
    this.counts = null;
    const named = typeof options.label === 'string';
    host.classList.add('rostrum-facet');
    if (options.mark) host.style.setProperty('--rostrum-facet-mark', options.mark);
    host.innerHTML = `<button type="button" class="rostrum-facet-not" aria-pressed="false">${options.not}</button>` +
      `<span class="rostrum-facet-main">${named ? '<button type="button" class="rostrum-facet-name" aria-pressed="false"></button>' : '<span class="rostrum-facet-own"></span>'}<b></b></span>`;
    /** @type {any} */
    const place = host.querySelector(named ? '.rostrum-facet-name' : '.rostrum-facet-own');
    if (named) place.textContent = options.label;
    else place.append(options.label);
    /** @type {any} */
    this.name = named ? place : null;
    /** @type {any} */
    this.not = host.querySelector('.rostrum-facet-not');
    /** @type {any} */
    this.number = host.querySelector('b');
    this.abort = new AbortController();
    const {signal} = this.abort;
    if (named) place.addEventListener('click', () => options.change(this.state === 'off' ? 'include' : 'off'), {signal});
    this.not.addEventListener('click', () => options.change(this.state === 'exclude' ? 'include' : 'exclude'), {signal});
    this.setState('off');
  }

  stop() {
    this.abort.abort();
    this.host.classList.remove('rostrum-facet');
    delete this.host.dataset.state;
    this.host.style.removeProperty('--rostrum-facet-mark');
    this.host.replaceChildren();
  }

  /** @param {'off' | 'include' | 'exclude'} state */
  setState(state) {
    this.state = state;
    this.host.dataset.state = state;
    if (this.name) this.name.setAttribute('aria-pressed', String(state !== 'off'));
    this.not.setAttribute('aria-pressed', String(state === 'exclude'));
    this.not.disabled = state === 'off';
    this.write();
  }

  /* counts is {with, without}, or empty to show no number */
  show(counts) {
    this.counts = counts || null;
    this.write();
  }

  write() {
    const {counts} = this;
    this.number.textContent = counts ? this.options.format(this.state === 'exclude' ? counts.without : counts.with) : '';
  }
}
