/* A renderer crash leaves no error to catch, so the last events are written to browser storage as they happen
   A session that ended without a clean close is handed to the page on the next load
   Each browser tab keeps its own record, because another tab still running is no crash
   The record of another tab counts as dead only after a long silence */
import {targetOf} from './util.js';

const SIZE = 80;
const BEAT_MS = 5000;
const SILENT_MS = 180000;

function sessionId(report) {
  try {
    const known = sessionStorage.getItem('rostrum.session');
    if (known) return known;
    const id = Math.random().toString(36).slice(2);
    sessionStorage.setItem('rostrum.session', id);
    return id;
  } catch (error) {
    report('blackbox.session', error);
    return Math.random().toString(36).slice(2);
  }
}

export class BlackBox {
  /* prefix is the storage prefix, context() adds fields to every write, deliver(record) receives the record of a crashed session */
  constructor({prefix, context, deliver, report, listen}) {
    this.prefix = `${prefix}blackBox.`;
    this.key = this.prefix + sessionId(report);
    this.context = context;
    this.deliver = deliver;
    this.report = report;
    this.listen = listen;
    /** @type {any[]} */
    this.events = [];
    this.closed = false;
    this.beat = 0;
  }

  trace(event, detail = '') {
    if (this.closed) return;
    const heap = /** @type {any} */ (performance).memory, memory = heap ? Math.round(heap.usedJSHeapSize / 1048576) : null;
    this.events.push([Math.round(performance.now()), event, String(detail).slice(0, 80), memory]);
    if (this.events.length > SIZE) this.events = this.events.slice(-SIZE);
    try {
      localStorage.setItem(this.key, JSON.stringify({clean: false, at: new Date().toISOString(), ...this.context(), events: this.events}));
    } catch (error) {
      this.report('blackbox.write', error);
    }
  }

  /* goes over the records of earlier sessions, drops the clean ones and reports each unclean one once */
  sweep() {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(this.prefix)) continue;
      let last;
      try {
        last = JSON.parse(localStorage.getItem(key));
      } catch (error) {
        this.report(`blackbox.read:${key}`, error);
        localStorage.removeItem(key);
        continue;
      }
      if (last.clean) {
        if (key !== this.key) localStorage.removeItem(key);
        continue;
      }
      if (key !== this.key && now - Date.parse(last.at) < SILENT_MS) continue;
      console.error(`${new Date().toISOString()} black box: an earlier session ended without closing, last events:`, last);
      this.deliver(last);
      localStorage.removeItem(key);
    }
  }

  start(beat) {
    try {
      this.sweep();
    } catch (error) {
      this.report('blackbox.sweep', error);
    }
    this.trace('start', navigator.userAgent.slice(-40));
    // the browser fires visibilitychange after pagehide on every normal reload, closed stops trace from overwriting the clean record
    this.listen(window, 'pagehide', () => {
      this.closed = true;
      try {
        localStorage.setItem(this.key, JSON.stringify({clean: true, at: new Date().toISOString()}));
      } catch (error) {
        this.report('blackbox.close', error);
      }
    });
    this.listen(window, 'pageshow', e => {
      if (e.persisted) {
        this.closed = false;
        this.trace('restored');
      }
    });
    this.listen(document, 'visibilitychange', () => this.trace('visibility', document.visibilityState));
    this.beat = setInterval(() => this.trace('beat', beat()), BEAT_MS);
    this.listen(window, 'pointerdown', e => {
      const t = targetOf(e), where = t.closest && t.closest('[data-tab],[data-look],button,.rostrum-on-table');
      this.trace('press', where ? (where.dataset && (where.dataset.tab || where.dataset.look)) || where.id || where.tagName : t.tagName);
    }, true);
  }

  stop() {
    clearInterval(this.beat);
    this.closed = true;
    try {
      localStorage.removeItem(this.key);
    } catch (error) {
      this.report('blackbox.stop', error);
    }
  }
}
