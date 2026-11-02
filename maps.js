/* What shows where the camera is, the map of the whole table, the projection of the open tab and the carriage on the rail */
import {loosen} from './object.js';
import {ZONE_GAP} from './table.js';
import {esc} from './util.js';

const TAB_MAP_WIDTH = 300;
const MAP_SCALE = 10;
const HOVER_MS = 150;
// past this many elements a real copy of the tab costs a visible pause, the projection shows outlines
const COPY_MOST = 4000;

export class Maps {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    this.cells = '';
    this.scale = 1;
    this.origin = {x: 0, y: 0};
    this.items = [];
    this.built = 0;
    this.host = document.createElement('div');
    this.host.id = 'rostrumTabMap';
    this.host.setAttribute('aria-hidden', 'true');
    document.body.append(this.host);
    this.ownTable = !rostrum.options.tableMap;
    this.table = rostrum.options.tableMap || document.body.appendChild(document.createElement('div'));
    this.table.classList.add('rostrum-table-map');
    if (rostrum.options.rail) {
      this.mark = document.createElement('i');
      this.mark.id = 'rostrumRailMark';
      this.mark.setAttribute('aria-hidden', 'true');
      rostrum.options.rail.append(this.mark);
    }
    this.listen();
    this.applyShown();
    rostrum.listen(this.table, 'pointerenter', () => {
      this.tableSeen = true;
      this.renderReadout(rostrum.scene.view());
    });
    rostrum.listen(this.table, 'pointerleave', () => {
      this.tableSeen = false;
    });
  }

  get tableShown() {
    return this.rostrum.store.get('rostrumTableMap', true);
  }

  set tableShown(on) {
    this.rostrum.store.set('rostrumTableMap', on);
    this.applyShown();
  }

  get tabShown() {
    return this.rostrum.store.get('rostrumTabMap', true);
  }

  set tabShown(on) {
    this.rostrum.store.set('rostrumTabMap', on);
    this.applyShown();
  }

  applyShown() {
    const root = document.documentElement;
    root.toggleAttribute('data-rostrum-no-table-map', !this.tableShown);
    root.toggleAttribute('data-rostrum-no-tab-map', !this.tabShown);
  }

  stop() {
    clearTimeout(this.coming);
    clearTimeout(this.clearing);
    delete document.documentElement.dataset.rostrumNoTableMap;
    delete document.documentElement.dataset.rostrumNoTabMap;
    this.host.remove();
    if (this.mark) this.mark.remove();
    this.table.classList.remove('rostrum-table-map');
    if (this.ownTable) this.table.remove();
    else this.table.replaceChildren();
  }

  /* the map of the table is its real geometry at a tenth of the scale, with every ground, every known object and what the camera sees */
  renderTable() {
    const {rostrum} = this, {options, scene} = rostrum;
    let svg = this.table.querySelector('svg');
    if (!svg) {
      this.table.innerHTML = `<svg preserveAspectRatio="xMidYMid meet"><g id="rostrumMapCells"></g><rect id="rostrumMapView"></rect></svg>` +
        '<div class="rostrum-cam-read"><span>X <b id="rostrumCamX"></b></span><span>Y <b id="rostrumCamY"></b></span><span>H <b id="rostrumCamH"></b></span></div>';
      svg = this.table.querySelector('svg');
      // listens to the press, a click would be lost when the map repaints between press and release
      this.table.querySelector('#rostrumMapCells').addEventListener('pointerdown', e => {
        const tab = e.button === 0 && e.target.closest('[data-tab]');
        if (tab) {
          rostrum.trace('map', tab.dataset.tab);
          rostrum.navigate(tab.dataset.tab);
        }
      });
    }
    // cells grow with what lies on them, so the view box is worked out on every render
    const zones = [...rostrum.zones.values()], wide = Math.max(...zones.map(z => z.right)) + ZONE_GAP, tall = Math.max(...zones.map(z => z.bottom)) + ZONE_GAP, box = `-20 -20 ${wide / MAP_SCALE} ${tall / MAP_SCALE}`;
    if (svg.getAttribute('viewBox') !== box) svg.setAttribute('viewBox', box);
    const cells = options.tabs.map(tab => {
      const zone = rostrum.zoneOf(tab);
      const known = scene.emittersOf(tab).map(r => `<rect x="${r.x / MAP_SCALE}" y="${r.y / MAP_SCALE}" width="${r.w / MAP_SCALE}" height="${r.h / MAP_SCALE}"></rect>`).join('');
      return `<g data-tab="${esc(tab)}" class="rostrum-map-cell${tab === rostrum.tab ? ' rostrum-map-here' : ''}"><rect class="rostrum-map-strip" x="${zone.left / MAP_SCALE}" y="${zone.top / MAP_SCALE}" width="${(zone.right - zone.left - ZONE_GAP * 2) / MAP_SCALE}" height="${(zone.bottom - zone.top - ZONE_GAP * 2) / MAP_SCALE}"><title>${esc(options.titleOf(tab))}</title></rect>${known}</g>`;
    }).join('');
    if (this.cells !== cells) {
      this.cells = cells;
      this.table.querySelector('#rostrumMapCells').innerHTML = cells;
    }
  }

  renderReadout(cam) {
    this.renderCarriage();
    // a map nobody sees writes nothing, its figures and frame would be laid out and painted on every camera frame
    if (!this.tableSeen && !this.host.classList.contains('rostrum-shown')) return;
    const {rostrum} = this, $ = id => document.getElementById(id);
    const x = $('rostrumCamX');
    if (x) {
      x.textContent = String(Math.round(cam.x)).padStart(5, '0');
      $('rostrumCamY').textContent = String(Math.round(cam.y)).padStart(5, '0');
      $('rostrumCamH').textContent = String(Math.round(cam.h)).padStart(5, '0');
    }
    const {halfW, halfH} = rostrum.camera.viewBox(cam.h), width = halfW * 2, height = halfH * 2, view = $('rostrumMapView');
    if (view) {
      view.setAttribute('x', String((cam.x - width / 2) / MAP_SCALE));
      view.setAttribute('y', String((cam.y - height / 2) / MAP_SCALE));
      view.setAttribute('width', String(width / MAP_SCALE));
      view.setAttribute('height', String(height / MAP_SCALE));
    }
    const seen = $('rostrumTabView');
    if (seen) {
      const zone = rostrum.zoneOf(rostrum.tab);
      seen.style.cssText = `left:${(cam.x - zone.x - width / 2 - this.origin.x) * this.scale}px;top:${(cam.y - zone.y - height / 2 - this.origin.y) * this.scale}px;width:${width * this.scale}px;height:${height * this.scale}px`;
    }
  }

  /* the carriage on the rail travels with a flight and stands at the open tab otherwise, wherever the camera wandered */
  renderCarriage() {
    const {rostrum, mark} = this, {flight, tab} = rostrum;
    if (!mark) return;
    const rest = `${tab}|${innerWidth}`;
    // standing at its tab the carriage does not move, and reading where it should stand would lay the page out
    if (!flight && this.railRest === rest) return;
    this.railRest = flight ? '' : rest;
    const a = rostrum.tabButton(flight ? flight.from : tab), b = rostrum.tabButton(flight ? flight.to : tab), f = flight ? rostrum.camera.share : 0;
    if (!a || !b) return;
    const left = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f, w = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * f;
    mark.style.transform = `translate(${left}px,0) scaleX(${w / 100})`;
  }

  /* The projection of the open tab is a scaled down copy of it, built only while the pointer is over its place
     Pressing or dragging on it takes the camera there, a click on an object brings that object to the top of the frame */
  refresh(items) {
    this.items = items;
    if (this.host.classList.contains('rostrum-shown') && !this.host.classList.contains('rostrum-held') && performance.now() - this.built > 1000) this.build();
  }

  build() {
    const {rostrum} = this, section = rostrum.section;
    if (!section || !rostrum.reach) return;
    this.built = performance.now();
    const {reach} = rostrum, width = reach.x1 - reach.x0, height = Math.max(reach.y1 - reach.y0, section.offsetHeight, 400);
    const scale = Math.min(TAB_MAP_WIDTH / width, (innerHeight - 170) / height);
    this.scale = scale;
    this.origin = {x: reach.x0, y: reach.y0};
    const copy = document.createElement('div');
    copy.className = 'rostrum-tab-copy';
    copy.inert = true;
    copy.style.cssText = `width:${width}px;height:${height}px;transform:translate(${-reach.x0 * scale}px,${-reach.y0 * scale}px) scale(${scale})`;
    if (section.getElementsByTagName('*').length > COPY_MOST) {
      for (const item of this.items) {
        const at = rostrum.objectOf(item).world, box = document.createElement('div');
        box.className = 'rostrum-on-table';
        box.style.cssText = `left:${at.x}px;top:${at.y}px;width:${at.w}px;height:${at.h}px`;
        copy.append(box);
      }
    } else for (const child of section.children) copy.append(child.cloneNode(true));
    // a copy must not act as the original, so it loses ids, names (radio groups) and docked state
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    copy.querySelectorAll('[name]').forEach(el => el.removeAttribute('name'));
    copy.querySelectorAll('.rostrum-docked,.rostrum-pinned,.rostrum-lifted,.rostrum-menu-open').forEach(loosen);
    const from = section.querySelectorAll('canvas'), to = copy.querySelectorAll('canvas');
    to.forEach((canvas, i) => {
      if (from[i] && from[i].width && from[i].height) canvas.getContext('2d').drawImage(from[i], 0, 0);
    });
    const view = document.createElement('div');
    view.id = 'rostrumTabView';
    this.host.replaceChildren(copy, view);
    this.host.style.width = `${Math.round(width * scale)}px`;
    this.host.style.height = `${Math.round(height * scale)}px`;
    this.renderReadout(rostrum.scene.view());
  }

  listen() {
    const {host, rostrum} = this;
    let press = null;
    const toWorld = e => {
      const r = host.getBoundingClientRect();
      return {x: (e.clientX - r.left) / this.scale + this.origin.x, y: (e.clientY - r.top) / this.scale + this.origin.y};
    };
    const go = e => {
      const p = toWorld(e);
      const zone = rostrum.zoneOf(rostrum.tab);
      rostrum.camera.moveTo(zone.x + p.x, zone.y + p.y);
    };
    host.addEventListener('pointerenter', () => {
      clearTimeout(this.clearing);
      if (host.classList.contains('rostrum-shown')) return;
      // a pointer on its way somewhere else does not pay for a copy of the tab
      this.coming = setTimeout(() => {
        this.build();
        host.classList.add('rostrum-shown');
      }, HOVER_MS);
    });
    host.addEventListener('pointerleave', () => {
      clearTimeout(this.coming);
      if (press) return;
      host.classList.remove('rostrum-shown');
      this.clearing = setTimeout(() => {
        if (host.classList.contains('rostrum-shown')) return;
        host.replaceChildren();
        host.style.width = '';
        host.style.height = '';
      }, 220);
    });
    host.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      press = {x: e.clientX, y: e.clientY, moved: false};
      host.setPointerCapture(e.pointerId);
      host.classList.add('rostrum-held');
      e.preventDefault();
    });
    host.addEventListener('pointermove', e => {
      if (!press) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 3) press.moved = true;
      if (press.moved) go(e);
    });
    const finish = e => {
      if (!press) return;
      const {moved} = press;
      press = null;
      host.classList.remove('rostrum-held');
      const r = host.getBoundingClientRect(), inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) {
        host.dispatchEvent(new PointerEvent('pointerleave'));
        return;
      }
      if (moved) return;
      const p = toWorld(e), el = this.items.find(item => {
        const at = rostrum.objectOf(item).world;
        return p.x >= at.x && p.x <= at.x + at.w && p.y >= at.y && p.y <= at.y + at.h;
      });
      if (el) el.scrollIntoView({block: 'start'});
      else go(e);
    };
    host.addEventListener('pointerup', finish);
    host.addEventListener('pointercancel', finish);
  }
}
