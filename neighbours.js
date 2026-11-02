/* The tabs lying around the open one
   They show as soon as the camera gets close and get ready while it rests
   When the middle of the frame stands on the ground of one of them it becomes the open tab and the camera does not move */
import {ZONE_GAP} from './table.js';

// how close the camera comes before a tab shows, how far it goes before it is gone again
const NEAR_COME = 160;
const NEAR_LEAVE = 500;
// at most this many tabs lie in view besides the open one, enough for any site at the greatest camera height
const MOST_NEAR = 12;
// a camera that only passes over the edge of a ground does not open that tab
const WALK_MS = 140;
const READY_WAIT_MS = 1500;
const READY_RETRY_MS = 300;

export class Neighbours {
  /** @param {import('./index.js').Rostrum} rostrum */
  constructor(rostrum) {
    this.rostrum = rostrum;
    // inView holds the tabs lying in the frame besides the open one
    // ready holds the tabs laid out and displayed, so the camera can go there without a pause
    this.inView = new Set();
    this.ready = new Set();
    this.drawnOnce = new Set();
    this.readying = 0;
    this.walkingTo = null;
    this.walkTimer = 0;
  }

  stop() {
    clearTimeout(this.walkTimer);
    clearTimeout(this.retryTimer);
    if (this.readying) cancelIdleCallback(this.readying);
  }

  /* The tabs to show, one appears when the camera gets close and goes only when the camera is further away
     A flight shows its two ends, the tabs between them are seen only as light */
  wanted() {
    const {rostrum} = this, {camera, options, flight} = rostrum;
    if (flight) return new Set([flight.from, flight.to]);
    if (rostrum.compact) return new Set();
    const {halfW, halfH} = camera.viewBox(), found = [];
    for (const tab of options.tabs) {
      if (tab === options.workbench) continue;
      const zone = rostrum.zoneOf(tab), reach = rostrum.reaches[tab], left = zone.x + (reach ? reach.x0 : 0), top = zone.y + (reach ? reach.y0 : 0);
      const right = reach ? zone.x + reach.x1 : zone.right - ZONE_GAP, bottom = reach ? zone.y + reach.y1 : zone.bottom - ZONE_GAP;
      const margin = this.inView.has(tab) ? NEAR_LEAVE : NEAR_COME;
      if (camera.x + halfW + margin < left || camera.x - halfW - margin > right || camera.y + halfH + margin < top || camera.y - halfH - margin > bottom) continue;
      found.push([Math.abs((zone.left + zone.right) / 2 - camera.x) + Math.abs((zone.top + zone.bottom) / 2 - camera.y), tab]);
    }
    found.sort((a, b) => a[0] - b[0]);
    return new Set(found.slice(0, MOST_NEAR).map(([, tab]) => tab));
  }

  refresh() {
    const {rostrum} = this, wanted = this.wanted();
    for (const tab of this.inView) {
      if (wanted.has(tab) && tab !== rostrum.tab) continue;
      this.inView.delete(tab);
      const left = rostrum.sectionOf(tab);
      if (left) left.classList.remove('rostrum-in-view');
      rostrum.emit('away', {tab});
    }
    for (const tab of wanted) {
      if (tab === rostrum.tab || this.inView.has(tab)) continue;
      const section = rostrum.groundOf(tab);
      if (!section) continue;
      this.inView.add(tab);
      this.ready.add(tab);
      section.classList.add('rostrum-ready', 'rostrum-in-view');
      rostrum.collectTab(tab);
      rostrum.maps.renderTable();
      rostrum.scene.request();
      // a tab in view is redrawn only the first time, opening it redraws it anyway
      if (!this.drawnOnce.has(tab)) {
        this.drawnOnce.add(tab);
        rostrum.holdDrawing(tab, rostrum.whenCalm().then(() => {
          if (this.inView.has(tab)) return rostrum.redraw(tab);
          this.drawnOnce.delete(tab);
          return undefined;
        }));
      }
    }
  }

  /* showing a section costs a layout, so tabs around the open one get ready one at a time during idle time while the camera rests */
  readyAround() {
    const {rostrum} = this;
    if (this.readying || rostrum.compact) return;
    const here = rostrum.zoneOf(rostrum.tab), around = rostrum.options.tabs.filter(tab => {
      const zone = rostrum.zoneOf(tab);
      return tab !== rostrum.tab && tab !== rostrum.options.workbench && Math.abs(zone.column - here.column) <= 1 && Math.abs(zone.row - here.row) <= 1;
    });
    for (const tab of this.ready) {
      if (around.includes(tab) || this.inView.has(tab) || tab === rostrum.tab) continue;
      this.ready.delete(tab);
      const section = rostrum.sectionOf(tab);
      if (section) section.classList.remove('rostrum-ready');
    }
    const next = around.find(tab => !this.ready.has(tab));
    if (next === undefined) return;
    this.readying = requestIdleCallback(() => {
      this.readying = 0;
      if (!rostrum.isCalm) {
        rostrum.whenCalm().then(() => this.readyAround());
        return;
      }
      // a tab being drawn gets every frame
      if (rostrum.lazy.busy || rostrum.holds.size || rostrum.drawings.size) {
        this.retryTimer = setTimeout(() => this.readyAround(), READY_RETRY_MS);
        return;
      }
      const section = rostrum.groundOf(next);
      if (section) {
        this.ready.add(next);
        section.classList.add('rostrum-ready');
        rostrum.collectTab(next);
      }
      this.readyAround();
    }, {timeout: READY_WAIT_MS});
  }

  /* which tab's ground is under the middle of the frame, the open tab wins while its objects reach there */
  groundUnderCamera() {
    const {rostrum} = this, {camera, tab} = rostrum, zone = rostrum.zoneOf(tab), reach = rostrum.reaches[tab];
    if (reach && camera.x >= zone.x + reach.x0 - ZONE_GAP && camera.x <= zone.x + reach.x1 + ZONE_GAP && camera.y >= zone.y + reach.y0 - ZONE_GAP && camera.y <= zone.y + reach.y1 + ZONE_GAP) return tab;
    for (const [name, at] of rostrum.zones) {
      if (camera.x >= at.left && camera.x < at.right && camera.y >= at.top && camera.y < at.bottom) return name;
    }
    return tab;
  }

  watchWalk() {
    const {rostrum} = this;
    if (rostrum.compact || rostrum.flight || rostrum.carry.active) return;
    const tab = this.groundUnderCamera();
    if (tab === rostrum.tab) {
      clearTimeout(this.walkTimer);
      this.walkingTo = null;
      return;
    }
    if (tab === this.walkingTo) return;
    this.walkingTo = tab;
    clearTimeout(this.walkTimer);
    this.walkTimer = setTimeout(() => {
      this.walkingTo = null;
      if (!rostrum.flight && this.groundUnderCamera() === tab) rostrum.adopt(tab);
    }, WALK_MS);
  }
}
