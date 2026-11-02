/* Small helpers shared by the modules of the engine, with no state and no knowledge of any page */

/** The target of an event typed as any, callers treat a target without closest as not an element
 * @param {Event} event
 * @returns {any} */
export const targetOf = event => event.target;

export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const coarse = () => matchMedia('(pointer: coarse)').matches;

// the click of a finger comes this long after it is lifted
export const FINGER_CLICK_MS = 400;

export const isTyping = el => el.matches('input,select,textarea,[contenteditable]') || el.isContentEditable;

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
export const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ESCAPES[ch]);

/* browser storage under one prefix, a failed read or write is reported and a read returns the fallback */
export function createStore(prefix, report, storage = null) {
  // a sandboxed frame throws on the very read of localStorage, so it is read where the failure is reported
  const area = () => storage || globalThis.localStorage;
  return {
    get(key, fallback) {
      try {
        const raw = area().getItem(prefix + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (error) {
        report(`store.read:${prefix}${key}`, error);
        return fallback;
      }
    },
    set(key, value) {
      try {
        area().setItem(prefix + key, JSON.stringify(value));
      } catch (error) {
        report(`store.write:${prefix}${key}`, error);
      }
    },
  };
}

/* swallows the click that follows a press which ended something, within is how long in ms to wait for that click */
export function swallowNextClick(within = 0) {
  const swallow = click => {
    click.stopPropagation();
    click.preventDefault();
  };
  window.addEventListener('click', swallow, {capture: true, once: true});
  setTimeout(() => window.removeEventListener('click', swallow, {capture: true}), within);
}
