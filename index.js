/* A page as a camera moving over a table of objects, each with its own place, size, scale and menu
   Everything specific to a site comes in through the options of createRostrum */
import {Arrangement} from './arrangement.js';
import {BlackBox} from './blackbox.js';
import {Camera, CAMERA_F} from './camera.js';
import {Carry} from './carry.js';
import {Emitters} from './emitters.js';
import {fly} from './flight.js';
import {Focus} from './focus.js';
import {Fx} from './fx.js';
import {Input} from './input.js';
import {Lanes, lyingOver, measureUnit, reachOf} from './layout.js';
import {Lazy} from './lazy.js';
import {Maps} from './maps.js';
import {Neighbours} from './neighbours.js';
import {RostrumObject, release, SLIDE_MS} from './object.js';
import {Popups} from './popups.js';
import {Scene} from './scene.js';
import {Settings} from './settings.js';
import {linesOf, zonesOf} from './table.js';
import {Tray} from './tray.js';
import {Updates} from './updates.js';
import {coarse, createStore, reducedMotion, targetOf} from './util.js';
import {Workbench} from './workbench.js';
import {Writing} from './writing.js';

const COMPACT_SIDE = 12;
const COMPACT_GAP = 16;
const COMPACT_FOOT = 72;
const CALM_MS = 180;
// a tab whose data take longer than this after the camera has come to rest is drawn without them, its objects may still move when the data arrive
const HOLD_MOST_MS = 6000;
// outlines get this long before the frame that lays out the contents of the objects
const OUTLINES_MS = 170;
// during a flight the layout follows incoming content at this interval, the landing lays it out anyway
const SETTLE_AIR_MS = 300;

const STRINGS = {
  objectMenu: 'Object menu', move: 'Move', resize: 'Change size', pin: 'Hold in frame', unpin: 'Release from frame', dockOff: 'Stop going along', dockOn: 'Go along',
  scale: 'Scale', smaller: 'Smaller', larger: 'Larger', scaleReset: 'Scale 100%', toBench: 'To workbench',
  fromBench: 'Remove from workbench', resetObject: 'Reset object', settings: 'Settings',
  standard: 'Standard arrangement', previous: 'Previous arrangement', takeShot: 'Take a snapshot', shotName: 'Snapshot name',
  back: 'Go back', dropShot: 'Delete snapshot', flight: 'Flight', look: 'Look', workbench: 'Workbench', tableMap: 'Map of the table', tabMap: 'Map of the tab',
  benchEmpty: 'Empty. Objects come here from their menu',
};

/** @type {any} */
const DEFAULTS = {
  storage: 'rostrum.',
  sectionTag: 'section',
  left: 24,
  top: 24,
  bottom: 0,
  dockTop: 12,
  compactTop: 12,
  compactWidth: 768,
  unit: {},
  scene: true,
  chrome: {},
  limit: null,
  gap: 44,
  rail: null,
  head: null,
  tableMap: null,
  dock: '',
  accents: '',
  wheelIgnore: '',
  handIgnore: 'header,button,a,input,select,textarea,summary,label,option,[role="button"]',
  looks: [],
  switches: [],
  objectActions: [],
  material: {},
  workbench: null,
  currentLook: () => '',
  chooseLook: () => {},
  titleOf: tab => tab,
  navigate: null,
  redraw: () => {},
  afterLayout: () => {},
  surfaces: section => [...section.children].filter(el => el.offsetWidth && el.offsetHeight),
  plan: (tab, items) => items.map(el => ({el, lane: Number(el.dataset.rostrumLane) || 0, span: Number(el.dataset.rostrumSpan) || 2})),
  ownKey: el => el.dataset.rostrumName || el.id || '',
  tint: () => ({color: [0.52, 0.8, 1], strength: 0.62}),
  report: (name, error) => console.error(`${new Date().toISOString()} rostrum: ${name}`, error),
  deliverBlackBox: null,
};

const FX_DEFAULTS = {
  heads: 'h1,h2,h3,summary,th',
  reading: {cell: '[data-rostrum-reading]', value: ':scope>[data-value]', label: ':scope>[data-label]'},
  chartSkip: 'button',
  popups: '',
  focusPopups: '',
  listPopups: '',
  longPopups: '',
  tipClass: 'rostrum-tip',
};

/**
 * @typedef {object} FxOptions
 * @property {string} [heads] What is a heading, written out and remembered by its words
 * @property {{cell: string, value: string, label: string}} [reading] A figure, its cell and inside the cell its value and label
 * @property {string} [chartSkip] Pictures that are not charts and are not drawn
 * @property {string} [popups] What comes up over the table, its words are written out
 * @property {string} [focusPopups] Of those, what pulls focus to its words
 * @property {string} [listPopups] Of those, what is written only when it opens
 * @property {string} [longPopups] Of those, what takes longer to write
 * @property {string} [tipClass] The class of the tips on points of SVG charts
 */

/**
 * @typedef {object} RostrumOptions
 * @property {HTMLElement} frame The element that is the frame of the camera, it stops being a part of the page flow
 * @property {HTMLElement} plane The element that lies on the table and holds one child per tab, id t-NAME
 * @property {string[]} tabs Names of the tabs, the workbench included
 * @property {string} [start] The tab to open first
 * @property {Record<string, number[]>} [place] Where a tab lies on the table as [column, row], a tab left out takes the next free place of the first row
 * @property {string} [storage] Prefix in browser storage
 * @property {HTMLElement|null} [rail] Where the buttons of the tabs live, each with data-tab, the engine takes their clicks and marks the open one with the class active
 * @property {HTMLElement|null} [head] The head of the page that stays over a narrow screen, objects start under it
 * @property {HTMLElement|null} [tableMap] Where the map of the table goes, by default it is added to the page
 * @property {string|null} [workbench] The name of the workbench tab, without it there is no workbench
 * @property {(section: HTMLElement) => HTMLElement[]} [surfaces] What counts as an object in a tab
 * @property {(tab: string, items: HTMLElement[]) => {el: HTMLElement, lane: number, span: number}[]} [plan] The standard place of objects
 * @property {(el: HTMLElement) => string} [ownKey] The stable name of an object, its arrangement is remembered under it
 * @property {(el: Element) => {color: number[], strength: number, edge?: boolean}} [tint] The colour and strength of the light of an element, edge lights it from the left edge
 * @property {string} [accents] What inside objects is lit on its own
 * @property {string} [dock] The instrument of a tab that goes along when the camera moves down the tab
 * @property {(section: HTMLElement, rostrum: Rostrum) => void} [afterLayout] Called after objects took their places
 * @property {(tab: string) => void} [redraw] A size changed or a tab came into view, what is drawn should be drawn again
 * @property {(tab: string, how?: {walked?: boolean}) => void} [navigate] A map or a button asks for a tab, walked means the camera is already there, hand how on to open
 * @property {(tab: string) => string} [titleOf] The name of a tab in the map
 * @property {(name: string, error: any) => any} [report] Where errors go
 * @property {(last: any) => any} [deliverBlackBox] What to do with the report of a session that ended without closing
 * @property {{id: string, label: string}[]} [looks] Looks offered in the settings
 * @property {() => string} [currentLook] The id of the look in use
 * @property {(id: string) => void} [chooseLook] Called when a look is picked
 * @property {{id: string, label: string, when?: Function, run: Function}[]} [objectActions] More rows of the menu of an object
 * @property {{lamp?: number[], albedo?: number[]}} [material] Colour of the lamps and of the table
 * @property {Record<string, string>} [strings] The words of the menus
 * @property {FxOptions} [fx] What is a heading, a reading and a popup on this site
 * @property {string} [wheelIgnore] Where the wheel is left to the page
 * @property {number} [compactWidth] Below this width the page is one column, 768 by default
 * @property {{min?: number, max?: number, margin?: number}} [unit] Limits of the width of a column
 * @property {boolean} [scene] false leaves the background to the site with no WebGL table
 * @property {{viewfinder?: boolean, lens?: boolean, maps?: boolean, settings?: boolean}} [chrome] false takes a part of the frame away
 * @property {{id: string, label: string, get: () => boolean, set: (on: boolean) => void}[]} [switches] More switches of the site in the menu of the frame
 * @property {(x: number, y: number, rostrum: Rostrum) => {x: number, y: number}} [limit] Where the camera may go
 * @property {string} [handIgnore] Where a press is left to the page and a drag does not move the camera
 * @property {string} [sectionTag] The element a tab is made of
 * @property {number} [left] Where objects start in the frame, from its left
 * @property {number} [top] Where objects start in the frame, from its top
 * @property {number} [bottom] What the page keeps at the bottom of the frame, an object above it counts as in view
 * @property {number} [dockTop] Where the instrument of a tab stands when it goes along
 * @property {number} [compactTop] Where objects start on a narrow screen when there is no head
 * @property {number} [gap] The space between objects
 */

export class Rostrum {
  /** @param {RostrumOptions} options */
  constructor(options) {
    this.options = {...DEFAULTS, ...options, fx: {...FX_DEFAULTS, ...options.fx}};
    this.strings = {...STRINGS, ...options.strings};
    this.frame = this.options.frame;
    this.plane = this.options.plane;
    this.frame.dataset.rostrumFrame = '';
    this.plane.dataset.rostrumPlane = '';
    document.documentElement.dataset.rostrum = '';
    this.abort = new AbortController();
    this.store = createStore(this.options.storage, (...args) => this.report(...args));
    const {start, tabs} = this.options;
    if (start && !tabs.includes(start)) this.report('start', new Error(`the tab "${start}" is not among the tabs, the first one opens`));
    this.tab = start && tabs.includes(start) ? start : tabs[0];
    this.arrangements = new Map();
    this.warned = new Set();
    this.objects = new WeakMap();
    this.held = [];
    this.reaches = {};
    this.items = [];
    this.lastMoved = 0;
    this.flight = null;
    this.zones = zonesOf(this.options.tabs, this.options.place);
    this.watched = new WeakSet();
    this.holds = new Map();
    this.shapes = {};
    this.settling = 0;
    this.drawings = new Map();
    this.afterLanding = [];
    this.resized = false;
    this.chrome = [];
    this.focus = new Focus(this);
    this.emitters = new Emitters(this);
    this.neighbours = new Neighbours(this);
    this.camera = new Camera({
      zoneOf: tab => this.zoneOf(tab),
      tabNow: () => this.tab,
      viewport: () => ({width: innerWidth, height: innerHeight}),
      left: this.options.left,
      top: this.options.top,
      plane: this.plane,
      limit: (x, y) => this.limitCamera(x, y),
      onMoved: () => this.cameraMoved(),
      onFrame: now => this.scene.flush(now),
    });
    this.scene = new Scene({
      camera: this.camera,
      isLaid: tab => tab === this.tab || this.neighbours.inView.has(tab),
      rampOf: (owner, clock) => this.fx.rampOf(owner, clock),
      material: this.options.material,
      onDrawn: cam => this.maps.renderReadout(cam),
      scans: clock => this.updates.scans(clock),
      trace: (...args) => this.trace(...args),
      report: (...args) => this.report(...args),
    });
    this.updates = new Updates(this);
    this.lazy = new Lazy(this);
    this.box = this.options.deliverBlackBox ? new BlackBox({
      prefix: this.options.storage,
      context: () => ({gpu: this.scene.gpuName || '', tab: this.tab, size: [innerWidth, innerHeight]}),
      deliver: this.options.deliverBlackBox,
      report: (...args) => this.report(...args),
      listen: (...args) => this.listen(...args),
    }) : null;
    this.start();
  }

  start() {
    const {options} = this, chrome = {viewfinder: true, lens: true, maps: true, settings: true, ...options.chrome};
    for (const [id, name] of [['rostrumViewfinder', 'viewfinder'], ['rostrumLens', 'lens']]) {
      if (!chrome[name]) continue;
      const el = document.createElement('div');
      el.id = id;
      el.setAttribute('aria-hidden', 'true');
      document.body.append(el);
      this.chrome.push(el);
    }
    if (!chrome.maps) document.documentElement.dataset.rostrumNoMaps = '';
    if (this.box) this.box.start(() => `${this.scene.emitterCount} emitters, ${this.fx.seen.size} seen`);
    this.measure();
    this.workbench = options.workbench ? new Workbench(this, options.workbench) : null;
    this.maps = new Maps(this);
    this.settings = chrome.settings ? new Settings(this) : null;
    if (options.rail) {
      this.listen(options.rail, 'click', e => {
        const button = targetOf(e).closest('button[data-tab]');
        if (button) this.navigate(button.dataset.tab);
      });
    }
    this.maps.renderTable();
    this.sizes = new ResizeObserver(() => {
      this.resized = true;
      this.settleSoon();
    });
    // data came into an object, or an object was unhidden
    this.changes = new MutationObserver(() => this.settleSoon());
    this.changes.observe(this.plane, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});
    this.sees = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        // in a held tab the data and the final size are still coming, letDraw shows the object later
        if (entry.target.closest('.rostrum-held')) continue;
        this.fx.ignite(entry.target);
        this.sees.unobserve(entry.target);
      }
    // the margin fires a little before an object enters the frame, so its words are hidden before any of it shows
    }, {threshold: 0.01, rootMargin: '140px'});
    this.writing = new Writing();
    this.fx = new Fx(this, this.writing);
    this.popups = new Popups(this, this.writing);
    // Carry listens before Input and Tray, the press that puts an object down must reach it first and stops there
    this.carry = new Carry(this);
    this.input = new Input(this);
    this.tray = new Tray(this);
    this.listen(window, 'resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.measure();
        this.scene.resize();
        this.collect();
        this.camera.apply();
      }, 60);
    });
    if (options.scene) {
      try {
        this.scene.start();
      } catch (error) {
        this.report('scene.start', error);
      }
    }
    // a remembered arrangement may already need more room than a cell
    this.regrid();
    this.scene.setSeams(linesOf(this.zones));
    const first = this.groundOf(this.tab);
    if (first) first.classList.add('rostrum-open');
    this.markRail();
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.camera.land();
    });
    // a press on a tab lying next to the open one opens it, after whatever the press itself did
    // when the press itself already switched tabs, that tab stays open
    let tabBeforePress = this.tab;
    this.listen(this.frame, 'click', () => {
      tabBeforePress = this.tab;
    }, true);
    this.listen(this.frame, 'click', e => {
      const t = targetOf(e), lying = t.closest && t.closest('[data-rostrum-plane]>.rostrum-ready');
      if (lying && this.tab === tabBeforePress && !this.flight) this.adopt(this.tabOf(lying));
    });
    this.camera.placeAt(this.tab);
    this.camera.apply();
    this.collect();
    this.whenCalm().then(() => this.neighbours.readyAround());
  }

  /* listeners on things the engine does not own go through here, abort removes them all */
  listen(target, type, handler, options) {
    target.addEventListener(type, handler, {...(typeof options === 'boolean' ? {capture: options} : options), signal: this.abort.signal});
  }

  emit(name, detail) {
    this.frame.dispatchEvent(new CustomEvent(`rostrum:${name}`, {detail, bubbles: true}));
  }

  /* undoes everything the engine did to the page */
  destroy() {
    this.abort.abort();
    this.carry.stop();
    this.camera.stop();
    this.neighbours.stop();
    this.holds.clear();
    clearTimeout(this.restTimer);
    clearTimeout(this.resizeTimer);
    clearTimeout(this.settleTimer);
    this.lazy.stop();
    this.updates.stop();
    cancelAnimationFrame(this.settling);
    for (const timer of this.drawings.values()) clearTimeout(timer);
    this.sizes.disconnect();
    this.changes.disconnect();
    this.sees.disconnect();
    this.fx.stop();
    this.popups.stop();
    this.writing.stop();
    this.input.stop();
    this.scene.stop();
    if (this.box) this.box.stop();
    if (this.workbench) this.workbench.stop();
    this.maps.stop();
    this.tray.stop();
    if (this.settings) this.settings.stop();
    for (const el of this.chrome) el.remove();
    this.focus.stop();
    this.plane.querySelectorAll('.rostrum-on-table').forEach(release);
    for (const section of this.plane.children) {
      section.classList.remove('rostrum-open', 'rostrum-ready', 'rostrum-in-view', 'rostrum-held', 'rostrum-loaded');
      for (const name of ['left', 'top', 'width', 'height']) /** @type {HTMLElement} */ (section).style.removeProperty(name);
    }
    if (this.options.rail) this.options.rail.querySelectorAll('button[data-tab]').forEach(button => button.classList.remove('active'));
    this.plane.style.transform = '';
    delete this.frame.dataset.rostrumFrame;
    delete this.plane.dataset.rostrumPlane;
    const root = document.documentElement;
    delete root.dataset.rostrum;
    delete root.dataset.rostrumNoMaps;
    delete root.dataset.rostrumCompact;
  }

  report(name, error) {
    this.options.report(name, error);
  }

  warnOnce(key, name, error) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.report(name, error);
  }

  trace(event, detail) {
    if (this.box) this.box.trace(event, detail);
  }

  redraw(tab) {
    return this.options.redraw(tab);
  }

  /* a flight is a lot of work for a phone, so it defaults to off with a coarse pointer */
  get flightOn() {
    return this.store.get('rostrumFlight', !coarse());
  }

  set flightOn(on) {
    this.store.set('rostrumFlight', on);
  }

  zoneOf(tab) {
    const zone = this.zones.get(tab);
    if (zone) return zone;
    this.warnOnce(`zone:${tab}`, 'zone', new Error(`the tab "${tab}" is not among the tabs, it lies on the ground of the first one`));
    return this.zones.get(this.options.tabs[0]);
  }

  /* how far a tab reaches, from what was laid out and, for a tab not laid out yet, from what its arrangement remembers */
  reachOfTab(tab) {
    const seen = this.reaches[tab], reach = seen ? {...seen} : {x0: 0, y0: 0, x1: 0, y1: 0};
    for (const spot of Object.values(this.arrangement(tab).spots)) {
      reach.x0 = Math.min(reach.x0, spot.x);
      reach.y0 = Math.min(reach.y0, spot.y);
      reach.x1 = Math.max(reach.x1, spot.x + (spot.w || 0));
      reach.y1 = Math.max(reach.y1, spot.y + (spot.h || 0));
    }
    return reach;
  }

  /* A tab that reaches past its cell moves the following cells away
     This waits until the camera rests and nothing is being carried, then the open tab stays in the frame and the others slide to their new places */
  regrid() {
    const {options, camera} = this;
    if (this.compact || this.carry.active) return;
    if (this.flight || !this.isCalm) {
      if (!this.gridDue) {
        this.gridDue = true;
        this.whenCalm().then(() => {
          this.gridDue = false;
          this.regrid();
        });
      }
      return;
    }
    const next = zonesOf(options.tabs, options.place, Object.fromEntries(options.tabs.map(tab => [tab, this.reachOfTab(tab)])));
    const signature = zones => JSON.stringify([...zones.values()]);
    if (signature(next) === signature(this.zones)) return;
    const was = this.zones, moved = tab => ({x: next.get(tab).x - was.get(tab).x, y: next.get(tab).y - was.get(tab).y}), open = moved(this.tab);
    this.zones = next;
    const going = [];
    for (const tab of options.tabs) {
      const {x, y} = moved(tab), section = this.groundOf(tab);
      camera.shiftMemory(tab, x, y);
      this.scene.shiftEmitters(tab, x, y);
      const dx = x - open.x, dy = y - open.y;
      if (section && (dx || dy) && this.neighbours.inView.has(tab)) going.push({tab, section, dx, dy});
    }
    camera.shift(open.x, open.y);
    this.input.shift(open.x, open.y);
    camera.apply();
    this.scene.setSeams(linesOf(next));
    this.maps.renderTable();
    this.slideGrounds(going);
  }

  /* only transform animates, and the light moves in the same frame */
  slideGrounds(going) {
    cancelAnimationFrame(this.groundsFrame);
    if (!going.length || reducedMotion()) return;
    const started = performance.now();
    const step = now => {
      const t = Math.min(1, (now - started) / SLIDE_MS), left = (1 - t) ** 3;
      for (const {tab, section, dx, dy} of going) {
        const x = -dx * left, y = -dy * left;
        section.style.transform = t < 1 ? `translate(${x}px,${y}px)` : '';
        this.scene.setOffset(tab, t < 1 ? x : 0, t < 1 ? y : 0);
      }
      if (t < 1) this.groundsFrame = requestAnimationFrame(step);
    };
    step(started);
    this.groundsFrame = requestAnimationFrame(step);
  }

  sectionOf(tab) {
    return this.plane.querySelector(`:scope>#t-${CSS.escape(tab)}`);
  }

  /* the section of a tab, moved to its place on the table */
  groundOf(tab) {
    const section = this.sectionOf(tab);
    if (section) {
      const {x, y} = this.zoneOf(tab), left = `${x}px`, top = `${y}px`;
      if (section.style.left !== left) section.style.left = left;
      if (section.style.top !== top) section.style.top = top;
    }
    return section;
  }

  tabOf(el) {
    for (let n = el; n; n = n.parentElement) {
      if (n.parentElement === this.plane) return n.id.slice(2);
    }
    return this.tab;
  }

  get reach() {
    return this.reaches[this.tab] || null;
  }

  get section() {
    return this.sectionOf(this.tab);
  }

  tabButton(tab) {
    return this.options.rail ? this.options.rail.querySelector(`button[data-tab="${CSS.escape(tab)}"]`) : null;
  }

  markRail() {
    if (!this.options.rail) return;
    this.options.rail.querySelectorAll('button[data-tab]').forEach((/** @type {HTMLElement} */ button) => button.classList.toggle('active', button.dataset.tab === this.tab));
  }

  /* a narrow screen has its own arrangement, what was placed on a wide table could stand out of reach of one column */
  arrangement(tab) {
    const surface = this.compact ? `${tab}~narrow` : tab;
    if (!this.arrangements.has(surface)) this.arrangements.set(surface, new Arrangement(this.store, surface));
    return this.arrangements.get(surface);
  }

  objectOf(el) {
    let object = this.objects.get(el);
    if (!object) {
      object = new RostrumObject(this, el);
      this.objects.set(el, object);
    }
    return object;
  }

  ownKey(el) {
    return this.options.ownKey(el);
  }

  /* on the workbench the key of an object is made of its tab and its own name */
  keyOf(el) {
    const onBench = el.closest('[data-rostrum-key]');
    if (!onBench) return this.ownKey(el);
    const own = onBench === el ? '' : this.ownKey(el);
    return onBench.dataset.rostrumKey + (own ? `/${own}` : '');
  }

  isDock(el) {
    return !!this.options.dock && el.matches(this.options.dock);
  }

  /* True when the tab is open, lying in the frame or lending objects to the workbench
     A site keeps live data only for such tabs */
  isLive(tab) {
    return tab === this.tab || this.neighbours.inView.has(tab) || (!!this.workbench && this.workbench.shows(tab));
  }

  writeIn(el) {
    this.fx.writeIn(el);
  }

  /* the data of a tab or of some elements were requested again, their objects show that until the promise settles */
  updating(target, loaded) {
    this.updates.begin(target, loaded);
  }

  pointAt(el) {
    const r = el.getBoundingClientRect(), {camera, scene, options} = this, k = camera.scale, at = camera.worldOf(r.left, r.top);
    scene.flash({x: at.x, y: at.y, w: r.width * k, h: r.height * k}, options.tint(el).color);
  }

  /* objects of the tab stay unseen, their outlines too, until the data come or HOLD_MOST_MS after the camera rests, so they are drawn once at final size */
  holdDrawing(tab, loaded) {
    const section = this.groundOf(tab);
    if (!section) return;
    const hold = {};
    this.holds.set(tab, hold);
    section.classList.add('rostrum-held');
    const inPlace = Promise.resolve(loaded).then(() => this.lazy.drained()).then(() => true, error => {
      this.report('holdDrawing', error);
      return true;
    });
    const tooLong = this.whenCalm().then(() => new Promise(resolve => setTimeout(() => resolve(false), HOLD_MOST_MS)));
    Promise.race([inPlace, tooLong]).then(came => {
      if (this.holds.get(tab) === hold) this.letDraw(tab, came);
    });
  }

  /* outlines light first, then all contents appear in one long frame, so the layout of one object does not cut into the drawing of another */
  letDraw(tab, came) {
    this.holds.delete(tab);
    const section = this.sectionOf(tab), {flight, camera} = this;
    if (came) section.classList.add('rostrum-loaded');
    this.collect();
    const coming = this.seenFrom(flight && flight.to === tab ? camera.of(tab) : camera, tab);
    // outlines that are already up do not wait again
    const allUp = coming.every(el => this.fx.struck(el));
    for (const el of coming) this.fx.strike(el);
    this.scene.request();
    clearTimeout(this.drawings.get(tab));
    const draw = () => {
      this.drawings.delete(tab);
      for (const el of coming) if (el.isConnected) this.fx.ignite(el, true);
      section.classList.remove('rostrum-held');
      // what lies out of view lights up when the camera comes to it
      for (const rest of this.options.surfaces(section)) {
        if (this.fx.hasLit(rest)) continue;
        this.sees.unobserve(rest);
        this.sees.observe(rest);
      }
    };
    // during a flight only the outlines are lit, showing a whole tab under a tilted camera would cost frames
    if (flight) this.afterLanding.push(draw);
    else this.drawings.set(tab, setTimeout(draw, reducedMotion() || allUp ? 0 : OUTLINES_MS));
  }

  /* a map or a button asks for a tab, what happens is up to the site */
  navigate(tab, how) {
    if (this.options.navigate) this.options.navigate(tab, how);
    else if (tab === this.tab) this.goHome();
    else this.open(tab, undefined, how);
  }

  /* Opens a tab with a flight
     apply is what the site does when the tab comes in front
     walked means the camera is already there and nothing moves */
  open(tab, apply = () => {}, {walked = false} = {}) {
    const from = this.tab, show = () => this.camera.quietly(() => {
      this.present(tab);
      apply();
    });
    if (walked) {
      if (from === tab) return;
      show();
      this.collect();
      return;
    }
    this.carry.cancel();
    this.camera.stop();
    if (from === tab) {
      // stop left the camera between two poses, it still has to arrive
      this.camera.go();
      this.camera.quietly(apply);
    } else fly(this, from, tab, show);
  }

  /* brings the tab in front at once, workbench objects step over and the menus of the old tab close */
  present(tab) {
    this.tab = tab;
    if (this.workbench) this.workbench.present(tab);
    for (const name of this.options.tabs) {
      const section = name === tab ? this.groundOf(name) : this.sectionOf(name);
      if (section) section.classList.toggle('rostrum-open', name === tab);
    }
    this.markRail();
    this.neighbours.refresh();
    // what was held to the lens stays with the tab it was held on
    this.held = [];
    if (this.compact && this.options.rail) {
      const button = this.tabButton(tab);
      if (button) button.scrollIntoView({inline: 'center', block: 'nearest'});
    }
    this.tray.closeAll();
    if (this.settings) this.settings.toggle(false);
    this.emit('tab', {tab});
    this.whenCalm().then(() => this.neighbours.readyAround());
  }

  /* the tab becomes the open one, the camera stays where it is */
  adopt(tab) {
    if (tab !== this.tab) this.navigate(tab, {walked: true});
  }

  goHome() {
    this.camera.goHome(this.tab);
  }

  get isCalm() {
    return !this.flight && !this.camera.moving && performance.now() - this.lastMoved >= CALM_MS;
  }

  /* resolves when the camera has come to rest, rendering a tab takes long tasks that would show as jerks on the move */
  whenCalm() {
    return this.when(() => this.isCalm);
  }

  landed() {
    const waiting = this.afterLanding;
    this.afterLanding = [];
    for (const go of waiting) go();
  }

  /* resolves when rendering into a tab may run, at once at rest and between camera frames on the move, see lazy.js */
  turn() {
    return this.lazy.turn();
  }

  /* one piece of drawing in its turn, the newest work of a key replaces one still waiting */
  later(key, work) {
    this.lazy.later(key, work);
  }

  when(ready) {
    return new Promise(resolve => {
      const look = () => {
        if (this.abort.signal.aborted) return;
        if (ready()) resolve();
        else setTimeout(look, CALM_MS / 2);
      };
      look();
    });
  }

  cameraMoved() {
    this.lastMoved = performance.now();
    this.keepPlace();
    this.holdFrame();
    this.scene.request();
    this.tray.run();
    this.popups.follow();
    this.focus.run();
    this.neighbours.refresh();
    this.neighbours.watchWalk();
    if (!this.scene.gl) this.maps.renderReadout(this.scene.view());
    this.input.cameraMoved();
  }

  /* where the camera last rested on a tab is where it comes back to, even after it walked off over the edge */
  keepPlace() {
    clearTimeout(this.restTimer);
    if (this.flight) return;
    this.restTimer = setTimeout(() => {
      if (!this.flight && this.neighbours.groundUnderCamera() === this.tab) this.camera.remember(this.tab);
    }, CALM_MS);
  }

  /* a narrow screen is one column of the width of the screen, the camera lands with a small margin */
  measure() {
    const {options, camera} = this;
    this.compact = innerWidth < options.compactWidth;
    this.gap = this.compact ? COMPACT_GAP : options.gap;
    this.unit = this.compact ? innerWidth - COMPACT_SIDE * 2 : measureUnit(innerWidth, options.left, options.gap, options.unit);
    camera.left = this.compact ? COMPACT_SIDE : options.left;
    camera.top = !this.compact ? options.top : options.head ? options.head.getBoundingClientRect().bottom + 8 : options.compactTop;
    document.documentElement.toggleAttribute('data-rostrum-compact', this.compact);
  }

  /* On a narrow screen at working height the camera stays on the one column and between its ends, like a page
     Two fingers take it higher, and from there it moves freely */
  limitCamera(x, y) {
    const {camera} = this;
    if (this.options.limit) return this.options.limit(x, y, this);
    if (!this.compact || camera.goalH !== CAMERA_F) return {x, y};
    const home = camera.home(this.tab), bottom = this.reach ? this.reach.y1 : 0;
    return {x: home.x, y: Math.max(home.y, Math.min(Math.max(home.y, home.y + bottom + camera.top + COMPACT_FOOT - innerHeight), y))};
  }

  layout(tab = this.tab) {
    const section = this.groundOf(tab), {options} = this;
    if (!section) return [];
    const lanes = new Lanes(this.unit, this.gap, this.compact), items = options.surfaces(section), names = new Set();
    const steps = options.plan(tab, items).map(item => {
      const object = this.objectOf(item.el), state = object.write(item, lanes), {key} = object;
      if (!this.watched.has(item.el)) {
        this.watched.add(item.el);
        this.sizes.observe(item.el);
        this.sees.observe(item.el);
      }
      if (key && names.has(key)) this.warnOnce(key, 'layout', new Error(`two objects on the tab ${tab} are called "${key}", they share one place`));
      names.add(key);
      return {object, state};
    });
    steps.filter(({object, state}) => object.wantsWider(state)).forEach(({object, state}) => object.widen(state, lanes));
    for (const {object, state} of steps) object.measure(state);
    this.shapes[tab] = this.shapeOf(items);
    const placed = steps.map(({object, state}) => object.place(state, lanes));
    const over = new Set(lyingOver(placed));
    for (const p of placed) p.object.el.classList.toggle('rostrum-over', over.has(p));
    const height = `${lanes.height}px`, width = `${lanes.width(4)}px`;
    if (section.style.height !== height) section.style.height = height;
    if (section.style.width !== width) section.style.width = width;
    this.reaches[tab] = reachOf(placed, lanes.width(4));
    if (tab === this.tab) {
      this.items = items;
      this.held = placed.filter(p => p.object.key && p.object.pin).map(p => p.object);
      this.holdFrame();
    }
    options.afterLayout(section, this);
    return items;
  }

  /* Keeps what is held to the lens in place in the frame
     The instrument of a tab goes along when the camera moves down the tab, sideways it stays so it covers nothing there
     An instrument the user placed stays where it was put */
  holdFrame() {
    const section = this.section;
    if (!section) return;
    for (const object of this.held) object.holdToLens();
    if (!this.options.dock) return;
    /** @type {HTMLElement | null} */
    const plate = section.querySelector(`${this.options.dock}.rostrum-on-table`);
    if (!plate || plate.classList.contains('rostrum-pinned')) return;
    const {camera} = this, object = this.objectOf(plate), k = camera.scale;
    object.dockBy(!this.compact && k <= 1.25 && object.goesAlong ? Math.max(0, (this.options.dockTop - camera.screenOrigin().y) * k) / object.zoom : 0);
  }

  headroom() {
    /** @type {any} */
    const plate = !this.compact && this.options.dock && this.section && this.section.querySelector(`${this.options.dock}.rostrum-on-table`);
    return plate && this.objectOf(plate).goesAlong ? Math.max(this.camera.top, this.options.dockTop + plate.offsetHeight + 16) : this.camera.top;
  }

  shapeOf(items) {
    return items.map(el => `${el.offsetWidth}x${el.offsetHeight}`).join();
  }

  /* an object that grew pushes others away before paint, so nothing overlaps for a frame */
  settleSoon() {
    if (this.flight) {
      if (!this.settleTimer) {
        this.settleTimer = setTimeout(() => {
          this.settleTimer = 0;
          this.settleSoon();
        }, SETTLE_AIR_MS);
      }
      return;
    }
    if (!this.settling) this.settling = requestAnimationFrame(now => this.settle(now));
  }

  settle(now) {
    this.settling = 0;
    const {resized} = this;
    this.resized = false;
    const moved = resized || [this.tab, ...this.neighbours.inView].some(tab => {
      const section = this.sectionOf(tab);
      return section && this.shapeOf(this.options.surfaces(section)) !== this.shapes[tab];
    });
    if (!moved) return;
    this.collect();
    this.scene.flush(now);
  }

  /* reads the objects of the open tab and of tabs lying in view from the page into world coordinates */
  collect() {
    if (!this.section) return;
    this.collectTab(this.tab);
    for (const tab of this.neighbours.inView) this.collectTab(tab);
    this.regrid();
    this.tray.run();
    this.focus.run();
    this.maps.renderTable();
    this.maps.refresh(this.items);
    this.scene.request();
  }

  collectTab(tab) {
    if (!this.sectionOf(tab)) return;
    this.emitters.collect(tab, this.layout(tab));
  }

  seenFrom(pose, tab = this.tab) {
    const zone = this.zoneOf(tab), {halfW, halfH} = this.camera.viewBox(pose.h), section = this.sectionOf(tab);
    return (section ? this.options.surfaces(section) : []).filter(el => {
      const at = this.objectOf(el).world, x = zone.x + at.x, y = zone.y + at.y;
      return x < pose.x + halfW && x + at.w > pose.x - halfW && y < pose.y + halfH && y + at.h > pose.y - halfH;
    });
  }

  igniteAt(pose) {
    for (const el of this.seenFrom(pose)) this.fx.ignite(el);
  }
}

/** @param {RostrumOptions} options */
export function createRostrum(options) {
  return new Rostrum(options);
}
