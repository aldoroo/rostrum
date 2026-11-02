/* What comes up over the table, meaning the menus of the engine, popups named in the options and tips on SVG chart points
   They are watched for appearing, their words get written out and focus is pulled to them
   A tip stands beside what it is about, data-rostrum-about="x y width height" names that in shares of the tip's parent, the default is what lies under the pointer
   A tip kept inside an object stays hidden and the one tip of the engine shows its words, inside it would be clipped and scaled by the camera */
import {TIP_SHAPE} from './focus.js';
import {clamp, reducedMotion, targetOf} from './util.js';

const BESIDE_GAP = 14;
const FRAME_MARGIN = 8;
// what lies under the pointer when nothing more is known
const POINTER_REACH = 10;

/* Picks where a tip stands, the side in use stays while it fits, then right, left, below and above are tried
   When none fits the tip goes to the edge of the frame further from the pointer */
export function besideBox(about, tip, pointer, frame, lastSide = '') {
  const x = clamp(pointer.x - tip.w / 2, frame.left, frame.right - tip.w), y = clamp(pointer.y - tip.h / 2, frame.top, frame.bottom - tip.h);
  const places = {
    right: {left: about.right + BESIDE_GAP, top: y},
    left: {left: about.left - BESIDE_GAP - tip.w, top: y},
    below: {left: x, top: about.bottom + BESIDE_GAP},
    above: {left: x, top: about.top - BESIDE_GAP - tip.h},
  };
  const fits = ({left, top}) => left >= frame.left && left + tip.w <= frame.right && top >= frame.top && top + tip.h <= frame.bottom;
  for (const side of [lastSide, 'right', 'left', 'below', 'above']) if (side && fits(places[side])) return {side, ...places[side]};
  return {side: '', left: pointer.x > (frame.left + frame.right) / 2 ? frame.left : frame.right - tip.w, top: y};
}

export class Popups {
  /** @param {import('./index.js').Rostrum} rostrum @param {import('./writing.js').Writing} writing */
  constructor(rostrum, writing) {
    this.rostrum = rostrum;
    this.writing = writing;
    this.selectors = rostrum.options.fx;
    this.seen = new WeakMap();
    this.pointer = {x: 0, y: 0, target: null};
    this.tipFrom = null;
    this.tipSays = null;
    this.tipAbout = null;
    this.side = '';
    const {popups, tipClass} = this.selectors;
    // the blur around an overlay stands with it
    this.selector = `.rostrum-focus-inside,[data-rostrum-popup],.${tipClass}${popups ? `,${popups}` : ''}`;
    this.watch();
    this.pointTips();
  }

  stop() {
    this.watcher.disconnect();
    cancelAnimationFrame(this.frame);
    this.tip.remove();
    this.rostrum.frame.querySelectorAll('svg [data-tip]').forEach(shape => {
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = shape.dataset.tip;
      shape.prepend(title);
      delete shape.dataset.tip;
    });
    this.rostrum.plane.querySelectorAll('.rostrum-tip-source').forEach(source => source.classList.remove('rostrum-tip-source'));
  }

  underPointer() {
    const {x, y} = this.pointer;
    return {left: x - POINTER_REACH, right: x + POINTER_REACH, top: y - POINTER_REACH, bottom: y + POINTER_REACH};
  }

  /* the box a site's tip is about, read every time because the camera moves it */
  aboutOf(host) {
    const said = host.dataset.rostrumAbout, parts = (said || '').split(' ').map(Number);
    if (!said || !host.parentElement) return this.underPointer();
    if (parts.length !== 4 || parts.some(Number.isNaN)) {
      this.rostrum.warnOnce(`about:${said}`, 'popups', new Error(`data-rostrum-about="${said}" is not four numbers, the tip stands by the pointer`));
      return this.underPointer();
    }
    const box = host.parentElement.getBoundingClientRect(), left = box.left + box.width * parts[0], top = box.top + box.height * parts[1];
    return {left, top, right: left + box.width * parts[2], bottom: top + box.height * parts[3]};
  }

  place() {
    const {tip, tipAbout} = this, {options, camera} = this.rostrum;
    const frame = {left: FRAME_MARGIN, right: innerWidth - FRAME_MARGIN, top: Math.min(camera.top, options.dockTop), bottom: innerHeight - options.bottom};
    const at = besideBox(tipAbout(), {w: tip.offsetWidth, h: tip.offsetHeight}, this.pointer, frame, this.side), left = `${Math.round(at.left)}px`, top = `${Math.round(at.top)}px`;
    this.side = at.side;
    if (tip.style.left !== left) tip.style.left = left;
    if (tip.style.top !== top) tip.style.top = top;
  }

  follow() {
    if (this.tip.style.display !== 'none') this.place();
  }

  hideTip() {
    this.tipFrom = null;
    this.tipSays = null;
    if (this.tip.style.display !== 'none') this.tip.style.display = 'none';
  }

  mirror(host) {
    host.classList.add('rostrum-tip-source');
    if (!host.offsetWidth) {
      if (this.tipFrom === host) this.hideTip();
      return;
    }
    const {tip} = this;
    if (this.tipFrom !== host) this.side = '';
    this.tipFrom = host;
    this.tipAbout = () => this.aboutOf(host);
    // compares with the markup taken from the site, because a tip being written carries marks of its own
    const says = host.innerHTML;
    if (this.tipSays !== says) {
      this.tipSays = says;
      tip.innerHTML = says;
    }
    tip.style.display = 'block';
    this.place();
    // runs in this frame, waiting for the watcher would paint the tip once with all its words
    this.show(tip);
  }

  show(host) {
    const {listPopups, longPopups, focusPopups, tipClass} = this.selectors, ours = host.matches('[data-rostrum-popup]');
    const isTip = host.matches(`.${tipClass}`);
    if (isTip && host !== this.tip) {
      this.mirror(host);
      return;
    }
    const focuses = ours || isTip || (!!focusPopups && host.matches(focusPopups));
    if (!(host.offsetWidth > 0 && host.offsetHeight > 0)) {
      this.seen.delete(host);
      if (focuses) this.rostrum.focus.close(host);
      return;
    }
    const now = host.textContent, before = this.seen.get(host), long = !!longPopups && host.matches(longPopups), span = Math.max(140, Math.min(long ? 760 : 420, now.length * (long ? 0.6 : 3.4)));
    // what a tip is about stays sharp, a note a site shows on its own is about what the pointer stands on
    // a menu names what must stay readable while it is open with data-rostrum-sharp
    const kept = host.dataset.rostrumSharp && host.parentElement && host.parentElement.querySelector(host.dataset.rostrumSharp);
    const sharp = kept ? () => kept.getBoundingClientRect() : isTip ? () => this.tipAbout() : !ours && focuses && this.pointer.target ? () => this.pointer.target.getBoundingClientRect() : null;
    // the blur and the words share one duration
    if (focuses) this.rostrum.focus.open(host, span, sharp, isTip ? TIP_SHAPE : undefined);
    this.rostrum.focus.run();
    if (before === now) return;
    this.seen.set(host, now);
    // a list of options is written when it opens, typing in its search box must not rewrite it every time
    const list = ours || (!!listPopups && host.matches(listPopups));
    if (before !== undefined && list) return;
    this.writing.write(host, span);
    if (before === undefined && host.animate && !reducedMotion() && !focuses) {
      host.animate([{clipPath: 'inset(0 0 100% 0)'}, {clipPath: 'inset(0 0 0 0)'}], {duration: long ? 260 : 130, easing: 'cubic-bezier(.2,.8,.2,1)'});
    }
  }

  watch() {
    const selector = this.selector.replace('.rostrum-focus-inside,', '');
    let queue = new Set();
    this.frame = 0;
    this.watcher = new MutationObserver(records => {
      for (const record of records) {
        /** @type {any} */
        const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        const host = el && el.closest(selector);
        if (host) queue.add(host);
        // a tip can leave together with what it stood on
        if (record.removedNodes.length) {
          if (this.tipFrom && !this.tipFrom.isConnected) this.hideTip();
          this.rostrum.focus.run();
        }
        for (const added of record.addedNodes) {
          /** @type {any} */
          const node = added;
          if (node.nodeType !== 1) continue;
          if (node.matches(selector)) queue.add(node);
          else node.querySelectorAll(selector).forEach(found => queue.add(found));
        }
      }
      if (queue.size && !this.frame) {
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          const hosts = [...queue];
          queue = new Set();
          hosts.forEach(host => this.show(host));
        });
      }
    });
    this.watcher.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'style']});
  }

  /* the title of an SVG chart point shows as a tip of the engine, moving it to data-tip keeps the native tooltip away */
  pointTips() {
    const tip = document.createElement('div');
    this.tip = tip;
    tip.id = 'rostrumPointTip';
    tip.className = this.selectors.tipClass;
    tip.style.display = 'none';
    document.body.append(tip);
    this.rostrum.listen(window, 'mousemove', e => {
      const t = targetOf(e), ours = t.ownerSVGElement && (this.rostrum.frame.contains(t) || this.rostrum.maps.table.contains(t));
      this.pointer = {x: e.clientX, y: e.clientY, target: t.getBoundingClientRect ? t : null};
      // the handler of the site has already positioned its tip, the mirror follows
      if (this.tipFrom) {
        this.place();
        return;
      }
      const title = ours && t.querySelector(':scope>title');
      if (title) {
        t.dataset.tip = title.textContent;
        title.remove();
      }
      const text = ours && !e.buttons ? t.dataset.tip : '';
      if (!text) {
        this.hideTip();
        return;
      }
      // written only when the text changes, the same text on every mouse move would restart the writing and it would never finish
      if (tip.textContent !== text) tip.textContent = text;
      tip.style.display = 'block';
      this.tipAbout = () => t.getBoundingClientRect();
      this.place();
    });
  }
}
