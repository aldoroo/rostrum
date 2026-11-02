/* The menu of an object
   Its button stands at the top of the right rim and shows only when the pointer gets to that place
   The drawer opens only on a click on the button and stays until it is closed
   Both live on document.body, outside the object, so a zoomed object does not scale them and a loader that rewrites the object does not remove them */
import {esc, reducedMotion, targetOf} from './util.js';

const CONTROLS = 'button,a,input,select,textarea,label,summary';

const LINGER_MS = 320;
const IDLE_FRAMES = 30;

export class Tray {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.notch = document.createElement('button');
    this.notch.id = 'rostrumNotch';
    this.notch.type = 'button';
    this.notch.setAttribute('aria-label', rostrum.strings.objectMenu);
    this.drawer = document.createElement('div');
    this.drawer.id = 'rostrumTray';
    this.drawer.dataset.rostrumPopup = '';
    this.drawer.hidden = true;
    this.drawer.innerHTML = '<div class="rostrum-tray-body"></div>';
    document.body.append(this.notch, this.drawer);
    this.open = null;
    this.under = null;
    this.frame = 0;
    this.idle = 0;
    this.leaveTimer = 0;
    this.listen();
  }

  stop() {
    clearTimeout(this.leaveTimer);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.notch.remove();
    this.drawer.remove();
  }

  listen() {
    this.notch.addEventListener('click', () => {
      if (!this.under) return;
      if (this.open === this.under) this.close();
      else this.show(this.under);
    });
    this.drawer.addEventListener('click', e => this.act(e));
    this.rostrum.listen(window, 'pointermove', e => {
      if (!this.rostrum.carry.active && !this.rostrum.input.handBusy && !e.buttons) this.track(e);
    });
    this.rostrum.listen(window, 'pointerdown', e => {
      if (this.open && !(targetOf(e).closest && targetOf(e).closest('#rostrumTray,#rostrumNotch'))) this.closeAll();
    }, true);
    // a finger cannot hover over the place of the button, so a tap on an object brings its button
    this.rostrum.listen(window, 'click', e => {
      if (/** @type {PointerEvent} */ (e).pointerType !== 'touch' || this.open) return;
      const t = targetOf(e);
      if (!t.closest || t.closest(`#rostrumNotch,#rostrumTray,${CONTROLS}`)) return;
      const el = t.closest('.rostrum-on-table');
      if (el && this.rostrum.frame.contains(el) && this.rostrum.keyOf(el)) {
        this.under = this.rostrum.objectOf(el);
        this.notch.classList.add('rostrum-shown');
        this.run();
      } else this.forget();
    });
    this.rostrum.listen(window, 'keydown', e => {
      if (e.key === 'Escape' && this.open) this.closeAll();
      // the keyboard asks for the menu of the object the focus is in
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        const inside = document.activeElement && document.activeElement.closest('.rostrum-on-table');
        if (inside && this.rostrum.frame.contains(inside) && this.rostrum.keyOf(inside)) {
          e.preventDefault();
          this.show(this.rostrum.objectOf(inside));
        }
      }
    });
  }

  placeOf(el) {
    const r = el.getBoundingClientRect();
    return {left: Math.round(Math.min(r.right, innerWidth - this.notch.offsetWidth)), top: Math.round(Math.max(r.top + 10, Math.min(64, r.bottom - 54)))};
  }

  tick() {
    this.frame = 0;
    if (this.open && (!this.open.el.isConnected || !this.open.el.offsetWidth)) this.close();
    if (this.under && (!this.under.el.isConnected || !this.under.el.offsetWidth)) {
      this.forget();
    }
    if (this.under) {
      const {left, top} = this.placeOf(this.under.el), place = `${left}px ${top}px`;
      if (this.notch.dataset.place !== place) {
        this.notch.dataset.place = place;
        this.notch.style.left = `${left}px`;
        this.notch.style.top = `${top}px`;
        this.rostrum.focus.run();
      }
    }
    if (this.open) {
      const r = this.open.el.getBoundingClientRect(), w = this.drawer.offsetWidth, h = this.drawer.offsetHeight, out = r.right + 14 + w <= innerWidth - 8;
      const left = Math.round(out ? r.right + 14 : Math.max(8, r.right - w - 14)), top = Math.round(Math.max(8, Math.min(innerHeight - h - 8, r.top))), place = `${left}px ${top}px`;
      if (this.drawer.dataset.place !== place) {
        this.drawer.dataset.place = place;
        this.drawer.style.left = `${left}px`;
        this.drawer.style.top = `${top}px`;
        this.rostrum.focus.run();
      }
    }
    // after a while with no change stop asking for frames until run() is called again
    if ((this.under || this.open) && ++this.idle < IDLE_FRAMES) this.frame = requestAnimationFrame(() => this.tick());
  }

  run() {
    this.idle = 0;
    if (!this.frame && (this.under || this.open)) this.frame = requestAnimationFrame(() => this.tick());
  }

  /* the place of the menu lies across the top of the right rim, a little inside the object and a little outside it */
  placeUnder(e) {
    if (targetOf(e).closest(CONTROLS)) return null;
    const probe = document.elementFromPoint(e.clientX - 14, e.clientY), el = probe && probe.closest('.rostrum-on-table');
    if (!el || !this.rostrum.frame.contains(el) || !this.rostrum.keyOf(el)) return null;
    const {left, top} = this.placeOf(el);
    return e.clientX >= left - 14 && e.clientX <= left + 14 && e.clientY >= top - 6 && e.clientY <= top + 50 ? el : null;
  }

  track(e) {
    const t = targetOf(e);
    if (!t.closest) return;
    const onMenu = t.closest('#rostrumNotch,#rostrumTray'), el = onMenu ? null : this.placeUnder(e);
    if (onMenu || el) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = 0;
      if (el && (!this.under || el !== this.under.el)) {
        this.under = this.rostrum.objectOf(el);
        this.notch.classList.add('rostrum-shown');
        this.run();
      }
      return;
    }
    // an open drawer was asked for and stays, the button stays with it
    if (this.under && this.under !== this.open && !this.leaveTimer) {
      this.leaveTimer = setTimeout(() => {
        this.leaveTimer = 0;
        if (this.open) this.under = this.open;
        else this.forget();
      }, LINGER_MS);
    }
  }

  render() {
    const object = this.open, {rostrum} = this, {strings} = rostrum, key = object.key, pinned = !!object.pin, at = object.world, z = object.zoom;
    const size = `${Math.round(at.w)} × ${Math.round(at.h)}`, body = this.drawer.firstElementChild, reading = /** @type {HTMLElement | null} */ (body.querySelector('.rostrum-tray-size'));
    const resettable = !!(object.size || object.spot || pinned || object.arrangement.loose[key]);
    // giving a scale or a size here makes the object resettable, so the rows are rebuilt to add the reset row
    if (reading && reading.dataset.key === key && !!body.querySelector('[data-act="reset"]') === resettable) {
      if (reading.textContent !== size) reading.textContent = size;
      this.run();
      body.querySelector('[data-act="scale-reset"]').textContent = `${Math.round(z * 100)}%`;
      return;
    }
    const row = (act, label, pressed) => `<button type="button" data-act="${act}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${esc(label)}</button>`;
    const {workbench} = rostrum, title = object.title;
    body.innerHTML = `<div class="rostrum-tray-head">${title ? `<b>${esc(title)}</b>` : ''}<span class="rostrum-tray-size" data-key="${esc(key)}">${size}</span></div>` +
      row('move', strings.move) + row('size', strings.resize) +
      row('pin', pinned ? strings.unpin : strings.pin, pinned) +
      (rostrum.isDock(object.el) && !pinned && !object.spot ? row('along', object.goesAlong ? strings.dockOff : strings.dockOn, object.goesAlong) : '') +
      `<div class="rostrum-tray-scale"><span>${esc(strings.scale)}</span><button type="button" data-act="smaller" aria-label="${esc(strings.smaller)}">−</button><button type="button" data-act="scale-reset" aria-label="${esc(strings.scaleReset)}">${Math.round(z * 100)}%</button><button type="button" data-act="larger" aria-label="${esc(strings.larger)}">+</button></div>` +
      (workbench ? row('bench', workbench.holds(object) ? strings.fromBench : strings.toBench) : '') +
      rostrum.options.objectActions.filter(item => !item.when || item.when(object)).map(item => row(`custom:${item.id}`, item.label)).join('') +
      (resettable ? row('reset', strings.resetObject) : '');
  }

  refresh(object) {
    if (this.open === object) this.render();
  }

  show(object) {
    this.rostrum.adopt(this.rostrum.tabOf(object.el));
    if (this.open) this.open.setMenuOpen(false);
    this.open = object;
    this.under = object;
    object.setMenuOpen(true);
    this.notch.classList.add('rostrum-shown');
    this.notch.setAttribute('aria-expanded', 'true');
    this.drawer.firstElementChild.innerHTML = '';
    this.drawer.dataset.place = '';
    this.drawer.hidden = false;
    this.render();
    this.rostrum.trace('tray', object.key);
    this.run();
  }

  close() {
    if (!this.open) return;
    this.open.setMenuOpen(false);
    this.open = null;
    this.notch.setAttribute('aria-expanded', 'false');
    this.rostrum.focus.close(this.drawer);
    this.drawer.hidden = true;
  }

  forget() {
    clearTimeout(this.leaveTimer);
    this.leaveTimer = 0;
    this.under = null;
    this.notch.classList.remove('rostrum-shown');
  }

  closeAll() {
    this.close();
    this.forget();
  }

  act(e) {
    const button = targetOf(e).closest('button');
    if (!button || !this.open) return;
    const object = this.open, act = button.dataset.act, {rostrum} = this;
    if (act === 'smaller' || act === 'larger') {
      rostrum.carry.scale(object, object.zoom + (act === 'larger' ? 0.1 : -0.1));
      return;
    }
    if (act === 'scale-reset') {
      rostrum.carry.scale(object, 1);
      return;
    }
    if (act === 'pin') {
      object.togglePin();
      if (!reducedMotion()) object.el.animate([{filter: 'brightness(1.9)'}, {filter: 'brightness(1)'}], {duration: 520, easing: 'ease-out'});
      // the words of the row change under the same object, so the rows are built again
      this.drawer.firstElementChild.innerHTML = '';
      this.render();
      return;
    }
    if (act === 'along') {
      object.toggleAlong();
      this.drawer.firstElementChild.innerHTML = '';
      this.render();
      return;
    }
    this.closeAll();
    if (act === 'move') rostrum.carry.startMove(object, e.clientX, e.clientY);
    else if (act === 'size') rostrum.carry.startSize(object, e.clientX, e.clientY);
    else if (act === 'bench') rostrum.workbench.toggle(object);
    else if (act === 'reset') object.reset();
    else if (act.startsWith('custom:')) {
      rostrum.options.objectActions.find(item => `custom:${item.id}` === act).run(object);
    }
  }
}
