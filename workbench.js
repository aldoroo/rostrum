/* A tab that starts empty and takes objects copied from other tabs, a copy keeps its own place, size and scale
   Copy and original are one live element, its host moves here when the workbench opens and back when another tab opens
   A comment node holds its place in the tab, so a tab lying next to the open workbench shows a gap there */
import {loosen} from './object.js';
import {isTyping, reducedMotion, targetOf} from './util.js';

/* the key of what lies on the workbench, a site can style by it with [data-rostrum-key^="tab|"] */
const benchKey = (tab, key) => `${tab}|${key}`;
const tabOfBenchKey = whole => whole.split('|')[0];

export class Workbench {
  /** @param {import('./index.js').Rostrum} rostrum @param {string} id */
  constructor(rostrum, id) {
    this.rostrum = rostrum;
    this.id = id;
    this.list = [];
    this.hosts = new Map();
    this.away = new Map();
    this.fixed = new WeakSet();
    for (const tab of rostrum.options.tabs) {
      const section = rostrum.sectionOf(tab);
      if (section) section.querySelectorAll('*').forEach(el => this.fixed.add(el));
    }
    this.section = document.createElement(rostrum.options.sectionTag);
    this.section.id = `t-${id}`;
    this.section.dataset.rostrumEmpty = rostrum.strings.benchEmpty;
    rostrum.plane.prepend(this.section);
    if (rostrum.options.rail) {
      this.button = document.createElement('button');
      this.button.dataset.tab = id;
      this.button.textContent = rostrum.strings.workbench;
      rostrum.options.rail.prepend(this.button);
    }
    this.setList(rostrum.store.get('rostrumBench', []));
    this.underPointer = null;
    // the Delete key removes what the pointer rests on from the workbench
    rostrum.listen(window, 'pointermove', e => {
      const t = targetOf(e);
      this.underPointer = t.closest ? t.closest('[data-rostrum-key]') : null;
    });
    rostrum.listen(window, 'keydown', e => {
      const t = targetOf(e), el = this.underPointer;
      if (e.key !== 'Delete' || !el || !el.isConnected || rostrum.tab !== this.id || isTyping(t)) return;
      this.underPointer = null;
      rostrum.tray.closeAll();
      this.removeFromSurface(rostrum.objectOf(el.closest('.rostrum-on-table') || el));
    });
  }

  stop() {
    this.present('');
    this.section.remove();
    if (this.button) this.button.remove();
  }

  /* the host is the nearest element that existed at startup, an object rendered later is its own host */
  hostOf(el) {
    let n = el;
    while (n && !this.fixed.has(n)) n = n.parentElement;
    return n || el;
  }

  /* finds nothing while a tab has not rendered yet, the list keeps the item and looks again later */
  find(item) {
    const within = this.rostrum.sectionOf(item.tab);
    return within ? [...within.querySelectorAll('*')].find(el => this.rostrum.ownKey(el) === item.key) : null;
  }

  /* the key of an object on the workbench, made of its tab and the host that steps over */
  wholeOf(object) {
    const host = this.hostOf(object.el), own = this.rostrum.ownKey(host);
    return own ? benchKey(this.rostrum.tab, own) : '';
  }

  holds(object) {
    return this.rostrum.tab === this.id || this.hosts.has(this.wholeOf(object));
  }

  /* a tab with an object on the workbench goes on drawing while the workbench is open */
  shows(tab) {
    return this.rostrum.tab === this.id && this.list.some(item => item.tab === tab);
  }

  get tabs() {
    return [...new Set(this.list.map(item => item.tab))];
  }

  save() {
    this.rostrum.store.set('rostrumBench', this.list);
  }

  loosen(host) {
    for (const el of [host, ...host.querySelectorAll('.rostrum-on-table')]) loosen(el);
  }

  stepOver(host, whole) {
    const place = document.createComment(`rostrum:${whole}`);
    host.before(place);
    this.away.set(whole, place);
    this.loosen(host);
    host.dataset.rostrumKey = whole;
    this.section.append(host);
  }

  stepBack(host, whole) {
    const place = this.away.get(whole), tab = tabOfBenchKey(whole);
    this.loosen(host);
    delete host.dataset.rostrumKey;
    this.away.delete(whole);
    if (place && place.isConnected) {
      place.replaceWith(host);
      return;
    }
    // the tab rewrote what held its place, so the object goes to the end of the tab
    this.rostrum.report('workbench.return', new Error(`the place of ${whole} in its tab is gone, it goes to the end of the tab`));
    const section = this.rostrum.sectionOf(tab);
    if (section) section.append(host);
  }

  present(tab) {
    for (const item of this.list) {
      const whole = benchKey(item.tab, item.key);
      if (!this.hosts.has(whole)) {
        const found = this.find(item);
        if (found) this.hosts.set(whole, found);
      }
      const host = this.hosts.get(whole);
      if (!host) continue;
      if (tab === this.id && !this.away.has(whole)) this.stepOver(host, whole);
      if (tab !== this.id && this.away.has(whole)) this.stepBack(host, whole);
    }
  }

  setList(list) {
    for (const item of this.list) {
      const whole = benchKey(item.tab, item.key);
      if (this.away.has(whole)) this.stepBack(this.hosts.get(whole), whole);
    }
    this.list = [];
    this.hosts.clear();
    for (const item of list) {
      this.list.push(item);
      const host = this.find(item);
      if (host) this.hosts.set(benchKey(item.tab, item.key), host);
    }
    this.save();
    this.present(this.rostrum.tab);
  }

  /* the outline of the object goes to the rail, the object itself does not move */
  fly(el, tab) {
    const button = this.rostrum.tabButton(tab);
    if (!button) return;
    const from = el.getBoundingClientRect(), to = button.getBoundingClientRect();
    button.animate([{boxShadow: '0 0 0 0 transparent'}, {boxShadow: '0 0 18px 4px color-mix(in oklch,var(--rostrum-glow) 90%,transparent)'}, {boxShadow: '0 0 0 0 transparent'}], {duration: 760});
    if (reducedMotion()) return;
    const ghost = document.createElement('div');
    ghost.className = 'rostrum-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`;
    document.body.append(ghost);
    ghost.animate([{transform: 'none', opacity: 1}, {transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(${to.width / from.width},${to.height / from.height})`, opacity: 0.3}], {duration: 460, easing: 'cubic-bezier(.55,0,.75,.2)'}).finished.then(() => ghost.remove());
  }

  send(object) {
    const {rostrum} = this, tab = rostrum.tab, key = object.key, host = this.hostOf(object.el), own = rostrum.ownKey(host);
    rostrum.trace('bench.send', key);
    if (!own) {
      rostrum.report('workbench.send', new Error(`${tab}: the object "${key}" has no stable name to restore it by`));
      return;
    }
    const whole = benchKey(tab, own);
    if (host === object.el) {
      const bench = rostrum.arrangement(this.id);
      bench.sizes[whole] = {...object.size, w: Math.round(object.world.w)};
      bench.save();
    }
    this.list.push({tab, key: own});
    this.hosts.set(whole, host);
    this.save();
    this.fly(object.el, this.id);
  }

  remove(whole) {
    const {rostrum} = this;
    rostrum.trace('bench.remove', whole);
    if (this.away.has(whole)) this.stepBack(this.hosts.get(whole), whole);
    rostrum.arrangement(this.id).forget(whole);
    this.hosts.delete(whole);
    this.list = this.list.filter(item => benchKey(item.tab, item.key) !== whole);
    this.save();
    rostrum.collect();
    rostrum.camera.apply();
  }

  /* removes from the workbench itself, the outline flies to the tab the object came from */
  removeFromSurface(object) {
    const holder = object.el.closest('[data-rostrum-key]');
    if (!holder) return;
    const whole = holder.dataset.rostrumKey;
    this.fly(object.el, tabOfBenchKey(whole));
    this.remove(whole);
  }

  toggle(object) {
    if (this.rostrum.tab === this.id) this.removeFromSurface(object);
    else if (this.hosts.has(this.wholeOf(object))) this.remove(this.wholeOf(object));
    else this.send(object);
  }
}
